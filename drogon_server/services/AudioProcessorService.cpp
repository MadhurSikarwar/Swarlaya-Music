#include "AudioProcessorService.hpp"
#include "../utils/FileLockManager.hpp"
#include "../utils/Subprocess.hpp"
#include <openssl/sha.h>
#include <drogon/drogon.h>
#include <cstdio>
#include <cstring>
#include <vector>
#include <chrono>
#include <algorithm>

namespace lehra::services {

void AudioProcessorService::start() {
    if (running_.exchange(true)) return;
    cleanerThread_ = std::thread(&AudioProcessorService::cacheCleanerLoop, this);
    LOG_INFO << "[AudioProcessorService] Started LRU cache cleaner thread.";
}

void AudioProcessorService::stop() {
    if (!running_.exchange(false)) return;
    if (cleanerThread_.joinable()) {
        cleanerThread_.join();
    }
    LOG_INFO << "[AudioProcessorService] Stopped.";
}

std::string AudioProcessorService::computeCacheKey(const std::string& filename, float hz, float start, float end, float stretch) const {
    char keyBuf[512];
    snprintf(keyBuf, sizeof(keyBuf), "%s|%.6f|%.3f|%.3f|%.4f", filename.c_str(), hz, start, end, stretch);

    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(keyBuf), strlen(keyBuf), hash);

    char hexBuf[13];
    for (int i = 0; i < 6; ++i) {
        snprintf(hexBuf + (i * 2), 3, "%02x", hash[i]);
    }
    hexBuf[12] = '\0';

    std::string safeName = filename;
    for (char& c : safeName) {
        if (c == ' ' || c == '/' || c == '\\') c = '_';
    }

    return safeName + "_" + std::string(hexBuf) + ".ogg";
}

bool AudioProcessorService::generateAudioCache(const std::filesystem::path& inputAssetPath,
                                               const std::filesystem::path& outputCachePath,
                                               float pitchHz,
                                               float start,
                                               float end,
                                               float stretch,
                                               float baseHz) {
    std::error_code ec;
    std::filesystem::create_directories(outputCachePath.parent_path(), ec);

    std::vector<std::string> cmd = {
        "python3", "pitch_shift_fallback.py",
        "--process",
        "--in", inputAssetPath.string(),
        "--out", outputCachePath.string(),
        "--hz", std::to_string(pitchHz),
        "--start", std::to_string(start),
        "--end", std::to_string(end),
        "--stretch", std::to_string(stretch),
        "--base-hz", std::to_string(baseHz)
    };

    LOG_INFO << "[AudioProcessorService] Generating audio cache: " << outputCachePath.filename().string();
    int res = utils::Subprocess::run(cmd);

    if (res == 0 && std::filesystem::exists(outputCachePath, ec) && std::filesystem::file_size(outputCachePath, ec) >= 1000) {
        return true;
    }

    LOG_ERROR << "[AudioProcessorService] Audio generation failed for " << outputCachePath.string();
    if (std::filesystem::exists(outputCachePath, ec)) {
        std::filesystem::remove(outputCachePath, ec);
    }
    return false;
}

void AudioProcessorService::cacheCleanerLoop() {
    while (running_) {
        for (int i = 0; i < 60 && running_; ++i) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        if (!running_) break;
        try {
            pruneCache();
            utils::FileLockManager::instance().pruneUnusedLocks();
        } catch (const std::exception& e) {
            LOG_ERROR << "[AudioProcessorService] Error during cache prune: " << e.what();
        }
    }
}

void AudioProcessorService::pruneCache() {
    std::filesystem::path cacheDir = std::filesystem::current_path() / "audio_cache";
    std::error_code ec;
    if (!std::filesystem::exists(cacheDir, ec)) return;

    uintmax_t totalSize = 0;
    std::vector<std::filesystem::directory_entry> files;

    for (const auto& entry : std::filesystem::directory_iterator(cacheDir, ec)) {
        if (entry.is_regular_file(ec) && entry.path().extension() == ".ogg") {
            totalSize += entry.file_size(ec);
            files.push_back(entry);
        }
    }

    if (totalSize <= MAX_CACHE_SIZE_BYTES) return;

    LOG_INFO << "[AudioProcessorService] Cache size (" << (totalSize / 1024 / 1024) 
             << " MB) exceeded 500 MB. Pruning LRU files...";

    // Sort oldest access/modification time first
    std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) {
        std::error_code err;
        return a.last_write_time(err) < b.last_write_time(err);
    });

    uintmax_t targetSize = 400ULL * 1024ULL * 1024ULL; // Prune down to 400 MB
    for (const auto& f : files) {
        if (totalSize <= targetSize) break;

        std::unique_lock<std::mutex> lock;
        if (utils::FileLockManager::instance().tryLockFile(f.path(), lock)) {
            uintmax_t sz = f.file_size(ec);
            if (std::filesystem::remove(f.path(), ec)) {
                totalSize -= sz;
                LOG_DEBUG << "[AudioProcessorService] Pruned cache file: " << f.path().filename().string();
            }
        } else {
            LOG_DEBUG << "[AudioProcessorService] Skipped locked active file during pruning: " << f.path().filename().string();
        }
    }
}

} // namespace lehra::services
