#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <shared_mutex>
#include <optional>
#include <filesystem>
#include <json/json.h>

namespace lehra::models {

enum class JobStatus { Queued, Processing, Completed, Error };

struct Job {
    std::string id;
    JobStatus status = JobStatus::Queued;
    int progress = 0;
    std::string error;
    std::vector<std::string> logs;
    std::filesystem::path output_dir;
    std::filesystem::path zip_path;
    std::filesystem::path peaks_path;

    Json::Value toJson() const;
};

/**
 * @brief Thread-safe in-memory job store using reader-writer lock (std::shared_mutex).
 * 
 * Allows concurrent readers (/api/job_status) without blocking while worker threads
 * update progress and logs during stem separation.
 */
class JobStore {
public:
    static JobStore& instance() {
        static JobStore instance_;
        return instance_;
    }

    std::string createJob();
    bool updateJobStatus(const std::string& id, JobStatus status);
    bool updateJobProgress(const std::string& id, int progress);
    bool appendJobLog(const std::string& id, const std::string& logLine);
    bool setJobError(const std::string& id, const std::string& errorMsg);
    bool setJobPaths(const std::string& id, 
                     const std::filesystem::path& outDir, 
                     const std::filesystem::path& zip, 
                     const std::filesystem::path& peaks);

    std::optional<Job> getJob(const std::string& id) const;
    bool deleteJob(const std::string& id);

private:
    JobStore() = default;
    ~JobStore() = default;
    JobStore(const JobStore&) = delete;
    JobStore& operator=(const JobStore&) = delete;

    std::unordered_map<std::string, Job> jobs_;
    mutable std::shared_mutex mutex_;
};

} // namespace lehra::models
