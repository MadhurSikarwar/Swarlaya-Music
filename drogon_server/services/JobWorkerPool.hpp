#pragma once

#include <string>
#include <filesystem>
#include <vector>
#include <deque>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <utility>

namespace lehra::services {

/**
 * @brief Bounded 2-Thread Worker Pool for Demucs AI Stem Separation.
 * 
 * Replaces Python's unbounded thread creation + semaphore pattern.
 * By using a fixed-size worker queue, we eliminate thread overhead and guarantee
 * deterministic memory/CPU scheduling without risking resource exhaustion.
 */
class JobWorkerPool {
public:
    static JobWorkerPool& instance() {
        static JobWorkerPool instance_;
        return instance_;
    }

    void start(size_t numWorkers = 2);
    void stop();
    void enqueueJob(const std::string& jobId, const std::filesystem::path& inputPath);

private:
    JobWorkerPool() = default;
    ~JobWorkerPool() { stop(); }
    JobWorkerPool(const JobWorkerPool&) = delete;
    JobWorkerPool& operator=(const JobWorkerPool&) = delete;

    void workerLoop();
    void processJob(const std::string& jobId, const std::filesystem::path& inputPath);

    std::vector<std::thread> workers_;
    std::deque<std::pair<std::string, std::filesystem::path>> queue_;
    std::mutex queueMutex_;
    std::condition_variable cv_;
    std::atomic<bool> running_{false};
};

} // namespace lehra::services
