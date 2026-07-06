#pragma once

#include <string>
#include <mutex>
#include <shared_mutex>
#include <unordered_map>
#include <memory>
#include <vector>
#include <functional>
#include <filesystem>

namespace lehra::utils {

/**
 * @brief Sharded Mutex Pool for Per-File Locking without Global Contention.
 * 
 * In a high-throughput production audio server, a single global lock around
 * cache file locks causes severe thread contention. Here we use 64 lock shards
 * indexed by path hash. Each shard maintains active file mutexes via std::shared_ptr.
 */
class FileLockManager {
public:
    static FileLockManager& instance() {
        static FileLockManager instance_;
        return instance_;
    }

    /**
     * @brief Get or create a mutex specific to a file path.
     * @param path The filesystem path to lock.
     * @return A shared_ptr to the file's mutex. The caller should lock this mutex using std::unique_lock.
     */
    std::shared_ptr<std::mutex> getFileMutex(const std::filesystem::path& path) {
        std::string pathStr = path.generic_string();
        size_t shardIdx = std::hash<std::string>{}(pathStr) % SHARDS_COUNT;

        std::lock_guard<std::mutex> shardLock(shardMutexes_[shardIdx]);
        auto& map = shardMaps_[shardIdx];
        
        auto it = map.find(pathStr);
        if (it != map.end()) {
            if (auto sp = it->second.lock()) {
                return sp;
            }
        }

        auto sp = std::make_shared<std::mutex>();
        map[pathStr] = sp;
        return sp;
    }

    /**
     * @brief Try to acquire a non-blocking lock on a file mutex.
     * Useful for LRU cache cleaners to check if a file is currently being written or served.
     */
    bool tryLockFile(const std::filesystem::path& path, std::unique_lock<std::mutex>& outLock) {
        auto mtx = getFileMutex(path);
        outLock = std::unique_lock<std::mutex>(*mtx, std::try_to_lock);
        return outLock.owns_lock();
    }

    /**
     * @brief Prune expired weak_ptrs from shard maps to prevent unbounded map growth over time.
     */
    void pruneUnusedLocks() {
        for (size_t i = 0; i < SHARDS_COUNT; ++i) {
            std::lock_guard<std::mutex> shardLock(shardMutexes_[i]);
            auto& map = shardMaps_[i];
            for (auto it = map.begin(); it != map.end(); ) {
                if (it->second.expired()) {
                    it = map.erase(it);
                } else {
                    ++it;
                }
            }
        }
    }

private:
    FileLockManager() = default;
    ~FileLockManager() = default;
    FileLockManager(const FileLockManager&) = delete;
    FileLockManager& operator=(const FileLockManager&) = delete;

    static constexpr size_t SHARDS_COUNT = 64;
    std::mutex shardMutexes_[SHARDS_COUNT];
    std::unordered_map<std::string, std::weak_ptr<std::mutex>> shardMaps_[SHARDS_COUNT];
};

} // namespace lehra::utils
