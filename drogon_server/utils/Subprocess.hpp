#pragma once

#include <string>
#include <vector>
#include <functional>

namespace lehra::utils {

/**
 * @brief Cross-platform Subprocess execution utility with line-by-line streaming callback.
 * 
 * Avoids shell evaluation vulnerabilities where possible and streams child stdout/stderr
 * in real-time to track Demucs milestone progress without blocking Drogon I/O loops.
 */
class Subprocess {
public:
    using LogCallback = std::function<void(const std::string& line)>;

    /**
     * @brief Run a command line synchronously and stream output lines.
     * @param cmd Command executable and arguments.
     * @param onLog Callback invoked for each line of stdout/stderr.
     * @return Exit status code of the process (0 for success).
     */
    static int run(const std::vector<std::string>& cmd, LogCallback onLog = nullptr);
};

} // namespace lehra::utils
