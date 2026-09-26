#include "JobWorkerPool.hpp"
#include "../models/JobStore.hpp"
#include "../utils/Subprocess.hpp"
#include "../utils/ZipUtils.hpp"
#include "../utils/Security.hpp"
#include "../utils/Peaks.hpp"
#include <drogon/drogon.h>
#include <json/json.h>
#include <fstream>
#include <set>
#include <algorithm>

namespace lehra::services {

void JobWorkerPool::start(size_t numWorkers) {
    if (running_.exchange(true)) return;
    workers_.reserve(numWorkers);
    for (size_t i = 0; i < numWorkers; ++i) {
        workers_.emplace_back(&JobWorkerPool::workerLoop, this);
    }
    LOG_INFO << "[JobWorkerPool] Started with " << numWorkers << " workers.";
}

void JobWorkerPool::stop() {
    if (!running_.exchange(false)) return;
    cv_.notify_all();
    for (auto& w : workers_) {
        if (w.joinable()) {
            w.join();
        }
    }
    workers_.clear();
    LOG_INFO << "[JobWorkerPool] Stopped.";
}

void JobWorkerPool::enqueueJob(const std::string& jobId, const std::filesystem::path& inputPath, bool twoStems) {
    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        queue_.push_back(Task{jobId, inputPath, twoStems});
    }
    cv_.notify_one();
}

void JobWorkerPool::workerLoop() {
    while (running_) {
        Task task;
        {
            std::unique_lock<std::mutex> lock(queueMutex_);
            cv_.wait(lock, [this] { return !queue_.empty() || !running_; });
            if (!running_ && queue_.empty()) return;
            task = std::move(queue_.front());
            queue_.pop_front();
        }
        try {
            processJob(task);
        } catch (const std::exception& e) {
            LOG_ERROR << "[JobWorkerPool] Unhandled exception in job " << task.jobId << ": " << e.what();
            models::JobStore::instance().setJobError(task.jobId, e.what());
            if (std::filesystem::exists(task.inputPath)) {
                std::error_code ec;
                std::filesystem::remove(task.inputPath, ec);
            }
        }
    }
}

void JobWorkerPool::processJob(const Task& task) {
    const std::string& jobId = task.jobId;
    const std::filesystem::path& inputPath = task.inputPath;
    auto& store = models::JobStore::instance();
    store.updateJobStatus(jobId, models::JobStatus::Processing);
    store.updateJobProgress(jobId, 10);
    store.appendJobLog(jobId, "Initializing AI Stem Separation engine...");

    std::filesystem::path stemsDir = std::filesystem::current_path() / "uploads" / "stems";
    std::filesystem::path outDir = stemsDir / ("out_" + jobId);
    std::error_code ec;
    std::filesystem::create_directories(outDir, ec);

    std::vector<std::string> cmd = {
        "python3", "-m", "demucs",
        "--out", stemsDir.string(),
        "-n", "htdemucs_6s",
        "--float32", "--mp3",
        "--shifts", "1", "--overlap", "0.25"
    };
    if (task.twoStems) {
        // Same model, but only vocals + the sum of everything else get
        // written (and encoded), which is what makes it faster.
        cmd.push_back("--two-stems");
        cmd.push_back("vocals");
    }
    cmd.push_back(inputPath.string());

    std::set<int> milestones;
    auto onLog = [&](const std::string& line) {
        if (line.empty()) return;
        if (line.find('%') != std::string::npos && line.find('|') != std::string::npos) {
            try {
                size_t pctPos = line.find('%');
                size_t spacePos = line.rfind(' ', pctPos);
                if (spacePos != std::string::npos && pctPos > spacePos) {
                    std::string pctStr = line.substr(spacePos + 1, pctPos - spacePos - 1);
                    int pct = std::stoi(pctStr);
                    pct = std::min(95, std::max(10, pct));
                    store.updateJobProgress(jobId, pct);

                    if (pct >= 10 && milestones.insert(10).second)
                        store.appendJobLog(jobId, "Loading htdemucs_6s model weights...");
                    if (pct >= 20 && milestones.insert(20).second)
                        store.appendJobLog(jobId, "Model loaded. Analyzing spectral frequencies...");
                    if (pct >= 35 && milestones.insert(35).second)
                        store.appendJobLog(jobId, "Applying Hybrid Transformer layers...");
                    if (pct >= 50 && milestones.insert(50).second)
                        store.appendJobLog(jobId, "Separating harmonic and percussive components...");
                    if (pct >= 65 && milestones.insert(65).second)
                        store.appendJobLog(jobId, task.twoStems ? "Isolating the vocals..." : "Isolating vocals and drums...");
                    if (pct >= 80 && milestones.insert(80).second)
                        store.appendJobLog(jobId, task.twoStems ? "Mixing the accompaniment (everything but the vocals)..."
                                                                : "Extracting bass, guitar, and piano stems...");
                    if (pct >= 90 && milestones.insert(90).second)
                        store.appendJobLog(jobId, "Finalizing audio rendering and saving outputs...");
                }
            } catch (...) {
                // Ignore parsing errors on malformed tqdm lines
            }
        } else {
            store.appendJobLog(jobId, line);
        }
    };

    LOG_INFO << "[JobWorkerPool] Running Demucs for job " << jobId;
    int exitCode = utils::Subprocess::run(cmd, onLog);

    if (exitCode != 0) {
        std::string err = "Demucs failed with exit code " + std::to_string(exitCode);
        LOG_ERROR << "[JobWorkerPool] " << err;
        store.setJobError(jobId, err);
        if (std::filesystem::exists(inputPath)) {
            std::filesystem::remove(inputPath, ec);
        }
        return;
    }

    store.updateJobProgress(jobId, 99);

    // Demucs outputs to <stemsDir>/htdemucs_6s/<inputStem>/<stem>.mp3
    std::filesystem::path modelOutDir = stemsDir / "htdemucs_6s" / inputPath.stem();
    const std::vector<std::string> expectedStems = task.twoStems
        ? std::vector<std::string>{"vocals.mp3", "no_vocals.mp3"}
        : std::vector<std::string>{"vocals.mp3", "drums.mp3", "bass.mp3", "guitar.mp3", "piano.mp3", "other.mp3"};

    if (std::filesystem::exists(modelOutDir)) {
        for (const auto& stem : expectedStems) {
            std::filesystem::path src = modelOutDir / stem;
            std::filesystem::path dst = outDir / stem;
            if (std::filesystem::exists(src)) {
                std::filesystem::rename(src, dst, ec);
            }
        }
        std::filesystem::remove_all(stemsDir / "htdemucs_6s", ec);
    }

    // Build ZIP archive
    std::filesystem::path zipPath = stemsDir / (jobId + "_stems.zip");
    utils::ZipUtils::createStemsZip(outDir, zipPath);

    // Waveform peaks for the separator's multitrack view.
    std::filesystem::path peaksPath = outDir / "peaks.json";
    {
        std::vector<std::pair<std::string, std::vector<float>>> stemPeaks;
        for (const auto& stem : expectedStems) {
            const std::filesystem::path stemFile = outDir / stem;
            if (std::filesystem::exists(stemFile, ec)) {
                stemPeaks.emplace_back(stemFile.stem().string(), utils::computeMp3Peaks(stemFile.string(), 800));
            }
        }
        std::ofstream peaksOut(peaksPath, std::ios::trunc);
        peaksOut << utils::peaksToJson(stemPeaks);
    }

    store.setJobPaths(jobId, outDir, zipPath, peaksPath);
    store.updateJobStatus(jobId, models::JobStatus::Completed);
    store.updateJobProgress(jobId, 100);
    store.appendJobLog(jobId, "Stem separation and analysis complete!");

    if (std::filesystem::exists(inputPath)) {
        std::filesystem::remove(inputPath, ec);
    }
    LOG_INFO << "[JobWorkerPool] Job " << jobId << " successfully completed.";
}

void JobWorkerPool::sweepExpired(std::chrono::seconds maxAge) {
    namespace fs = std::filesystem;
    auto& store = models::JobStore::instance();

    // Forget finished jobs past their lifetime (their files go below).
    for (const auto& id : store.finishedJobsOlderThan(maxAge)) {
        store.deleteJob(id);
    }

    // Delete old uploads and results by age on disk. That also catches files
    // left behind by a restart (the job store lives in memory). Files of jobs
    // that are still queued or running are never touched.
    const auto cutoff = fs::file_time_type::clock::now() - maxAge;
    const fs::path uploadsDir = fs::current_path() / "uploads";
    std::vector<fs::path> expired;
    for (const fs::path& dir : {uploadsDir, uploadsDir / "stems"}) {
        std::error_code ec;
        for (fs::directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
            // Entries are named after their job: <id>.<ext>, out_<id>, <id>_stems.zip
            std::string name = it->path().filename().string();
            if (name.rfind("out_", 0) == 0) name = name.substr(4);
            const std::string id = name.substr(0, 36);
            if (!utils::isValidJobId(id)) continue;  // e.g. stems/ itself, Demucs' temp dir

            auto job = store.getJob(id);
            if (job && (job->status == models::JobStatus::Queued ||
                        job->status == models::JobStatus::Processing)) continue;

            std::error_code tec;
            const auto modified = fs::last_write_time(it->path(), tec);
            if (!tec && modified < cutoff) expired.push_back(it->path());
        }
    }
    for (const auto& p : expired) {
        std::error_code ec;
        fs::remove_all(p, ec);
    }
    if (!expired.empty()) {
        LOG_INFO << "[JobWorkerPool] Removed " << expired.size() << " expired upload/result entries.";
    }
}

} // namespace lehra::services
