#include "JobStore.hpp"
#include <mutex>
#include <shared_mutex>
#include <random>
#include <cstdio>

namespace lehra::models {

Json::Value Job::toJson() const {
    Json::Value val;
    val["job_id"] = id;
    switch (status) {
        case JobStatus::Queued: val["status"] = "queued"; break;
        case JobStatus::Processing: val["status"] = "processing"; break;
        case JobStatus::Completed: val["status"] = "completed"; break;
        case JobStatus::Error: val["status"] = "error"; break;
    }
    val["progress"] = progress;
    val["error"] = error.empty() ? "" : error;

    Json::Value logsArray(Json::arrayValue);
    for (const auto& l : logs) {
        logsArray.append(l);
    }
    val["logs"] = logsArray;
    return val;
}

std::string JobStore::createJob() {
    static thread_local std::mt19937_64 rng(std::random_device{}());
    static thread_local std::uniform_int_distribution<uint64_t> dist;
    uint64_t h1 = dist(rng);
    uint64_t h2 = dist(rng);

    char uuidStr[37];
    snprintf(uuidStr, sizeof(uuidStr),
             "%08x-%04x-4%03x-%04x-%012llx",
             static_cast<uint32_t>(h1 >> 32),
             static_cast<uint32_t>((h1 >> 16) & 0xffff),
             static_cast<uint32_t>((h1 & 0x0fff)),
             static_cast<uint32_t>(((h2 >> 48) & 0x3fff) | 0x8000),
             static_cast<unsigned long long>(h2 & 0xffffffffffffULL));

    std::string id(uuidStr);

    std::unique_lock<std::shared_mutex> lock(mutex_);
    Job job;
    job.id = id;
    job.status = JobStatus::Queued;
    job.progress = 0;
    jobs_[id] = std::move(job);
    return id;
}

bool JobStore::updateJobStatus(const std::string& id, JobStatus status) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    auto it = jobs_.find(id);
    if (it == jobs_.end()) return false;
    it->second.status = status;
    return true;
}

bool JobStore::updateJobProgress(const std::string& id, int progress) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    auto it = jobs_.find(id);
    if (it == jobs_.end()) return false;
    it->second.progress = progress;
    return true;
}

bool JobStore::appendJobLog(const std::string& id, const std::string& logLine) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    auto it = jobs_.find(id);
    if (it == jobs_.end()) return false;
    it->second.logs.push_back(logLine);
    return true;
}

bool JobStore::setJobError(const std::string& id, const std::string& errorMsg) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    auto it = jobs_.find(id);
    if (it == jobs_.end()) return false;
    it->second.status = JobStatus::Error;
    it->second.error = errorMsg;
    return true;
}

bool JobStore::setJobPaths(const std::string& id, 
                           const std::filesystem::path& outDir, 
                           const std::filesystem::path& zip, 
                           const std::filesystem::path& peaks) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    auto it = jobs_.find(id);
    if (it == jobs_.end()) return false;
    it->second.output_dir = outDir;
    it->second.zip_path = zip;
    it->second.peaks_path = peaks;
    return true;
}

std::optional<Job> JobStore::getJob(const std::string& id) const {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    auto it = jobs_.find(id);
    if (it == jobs_.end()) return std::nullopt;
    return it->second;
}

bool JobStore::deleteJob(const std::string& id) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    return jobs_.erase(id) > 0;
}

} // namespace lehra::models
