#include "JobWorkerPool.hpp"
#include "../models/JobStore.hpp"
#include "../utils/Subprocess.hpp"
#include "../utils/ZipUtils.hpp"
#include <drogon/HttpClient.h>
#include <drogon/HttpRequest.h>
#include <drogon/HttpResponse.h>
#include <drogon/drogon.h>
#include <iostream>
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

void JobWorkerPool::enqueueJob(const std::string& jobId, const std::filesystem::path& inputPath) {
    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        queue_.emplace_back(jobId, inputPath);
    }
    cv_.notify_one();
}

void JobWorkerPool::workerLoop() {
    while (running_) {
        std::pair<std::string, std::filesystem::path> task;
        {
            std::unique_lock<std::mutex> lock(queueMutex_);
            cv_.wait(lock, [this] { return !queue_.empty() || !running_; });
            if (!running_ && queue_.empty()) return;
            task = std::move(queue_.front());
            queue_.pop_front();
        }
        try {
            processJob(task.first, task.second);
        } catch (const std::exception& e) {
            LOG_ERROR << "[JobWorkerPool] Unhandled exception in job " << task.first << ": " << e.what();
            models::JobStore::instance().setJobError(task.first, e.what());
            if (std::filesystem::exists(task.second)) {
                std::error_code ec;
                std::filesystem::remove(task.second, ec);
            }
        }
    }
}

void JobWorkerPool::processJob(const std::string& jobId, const std::filesystem::path& inputPath) {
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
        "--shifts", "1", "--overlap", "0.25",
        inputPath.string()
    };

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
                        store.appendJobLog(jobId, "Isolating vocals and drums...");
                    if (pct >= 80 && milestones.insert(80).second)
                        store.appendJobLog(jobId, "Extracting bass, guitar, and piano stems...");
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
    const std::vector<std::string> expectedStems = {
        "vocals.mp3", "drums.mp3", "bass.mp3", "guitar.mp3", "piano.mp3", "other.mp3"
    };

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

    // Compute Waveform Peaks via C++ sidecar or fallback
    std::filesystem::path peaksPath = outDir / "peaks.json";
    bool peaksSuccess = false;
    try {
        auto client = drogon::HttpClient::newHttpClient("http://127.0.0.1:3001");
        auto req = drogon::HttpRequest::newHttpRequest();
        req->setPath("/peaks");
        req->setMethod(drogon::Post);
        req->setContentTypeCode(drogon::CT_APPLICATION_JSON);

        Json::Value reqJson;
        Json::Value filesArray(Json::arrayValue);
        for (const auto& stem : expectedStems) {
            std::filesystem::path stemFile = outDir / stem;
            if (std::filesystem::exists(stemFile)) {
                filesArray.append(std::filesystem::absolute(stemFile).string());
            }
        }
        reqJson["files"] = filesArray;
        reqJson["resolution"] = 800;
        req->setBody(reqJson.toStyledString());

        auto resp = client->sendRequest(req, 30.0);
        if (resp.first == drogon::ReqResult::Ok && resp.second && resp.second->getStatusCode() == 200) {
            std::ofstream pf(peaksPath);
            pf << resp.second->getBody();
            pf.close();
            peaksSuccess = true;
            LOG_INFO << "[JobWorkerPool] Peaks generated via sidecar for job " << jobId;
        }
    } catch (...) {
        LOG_WARN << "[JobWorkerPool] Sidecar HTTP call failed for job " << jobId;
    }

    if (!peaksSuccess) {
        LOG_WARN << "[JobWorkerPool] Falling back to Python librosa peaks script for job " << jobId;
        std::vector<std::string> fallbackCmd = {
            "python3", "pitch_shift_fallback.py",
            "--mode", "peaks",
            "--dir", outDir.string()
        };
        utils::Subprocess::run(fallbackCmd);
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

} // namespace lehra::services
