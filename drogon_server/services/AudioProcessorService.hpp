#pragma once

#include <string>
#include <filesystem>
#include <thread>
#include <atomic>
#include <functional>

namespace lehra::services {

/**
 * @brief Manages audio asset pitch-shifting and LRU cache maintenance.
 * 
 * Coordinates SHA-256 cache key generation, non-blocking cache lookups,
 * background audio processing via sidecar/fallback, and periodic LRU cache cleaning.
 */
class AudioProcessorService {
public:
    static AudioProcessorService& instance() {
        static AudioProcessorService instance_;
        return instance_;
    }

    void start();
    void stop();

    /**
     * @brief Compute the deterministic cache filename for an audio request.
     */
    std::string computeCacheKey(const std::string& filename, float hz, float start, float end, float stretch) const;

    /**
     * @brief Generate the pitch-shifted audio file synchronously (should be run in a thread pool).
     * @return true if successful and file exists, false otherwise.
     */
    bool generateAudioCache(const std::filesystem::path& inputAssetPath,
                            const std::filesystem::path& outputCachePath,
                            float pitchHz,
                            float start,
                            float end,
                            float stretch,
                            float baseHz = 146.83f);

private:
    AudioProcessorService() = default;
    ~AudioProcessorService() { stop(); }
    AudioProcessorService(const AudioProcessorService&) = delete;
    AudioProcessorService& operator=(const AudioProcessorService&) = delete;

    void cacheCleanerLoop();
    void pruneCache();

    static constexpr uintmax_t MAX_CACHE_SIZE_BYTES = 500ULL * 1024ULL * 1024ULL; // 500 MB
    std::thread cleanerThread_;
    std::atomic<bool> running_{false};
};

} // namespace lehra::services
