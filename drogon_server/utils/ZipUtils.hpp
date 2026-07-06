#pragma once

#include <filesystem>

namespace lehra::utils {

/**
 * @brief High-speed ZIP archiver for MP3 stems.
 * 
 * Since MP3 files are already compressed audio, applying DEFLATE yields 0% compression gain.
 * We implement a standard uncompressed (STORE method 0) ZIP archiver using zlib CRC32.
 * This executes in milliseconds with zero external system utilities or dependencies.
 */
class ZipUtils {
public:
    /**
     * @brief Package all files in a directory into a ZIP archive.
     * @param sourceDir Directory containing files (e.g. vocals.mp3, drums.mp3).
     * @param zipPath Output destination path for the ZIP archive.
     * @return true if successful, false otherwise.
     */
    static bool createStemsZip(const std::filesystem::path& sourceDir, const std::filesystem::path& zipPath);
};

} // namespace lehra::utils
