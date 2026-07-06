#include "Subprocess.hpp"
#include <iostream>
#include <sstream>
#include <cstring>

#ifndef _WIN32
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#else
#include <windows.h>
#include <stdio.h>
#endif

namespace lehra::utils {

int Subprocess::run(const std::vector<std::string>& cmd, LogCallback onLog) {
    if (cmd.empty()) return -1;

#ifndef _WIN32
    int pipefd[2];
    if (pipe(pipefd) == -1) {
        if (onLog) onLog("Failed to create pipe for subprocess.");
        return -1;
    }

    pid_t pid = fork();
    if (pid == -1) {
        close(pipefd[0]);
        close(pipefd[1]);
        if (onLog) onLog("Failed to fork subprocess.");
        return -1;
    }

    if (pid == 0) {
        // Child process
        close(pipefd[0]);
        // Redirect both stdout and stderr to the write end of the pipe
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);

        std::vector<char*> argv;
        argv.reserve(cmd.size() + 1);
        for (const auto& arg : cmd) {
            argv.push_back(const_cast<char*>(arg.c_str()));
        }
        argv.push_back(nullptr);

        execvp(argv[0], argv.data());
        // If execvp returns, it failed
        std::cerr << "execvp failed: " << strerror(errno) << std::endl;
        _exit(127);
    } else {
        // Parent process
        close(pipefd[1]);
        
        char buffer[4096];
        ssize_t bytesRead = 0;
        std::string lineBuffer;

        while ((bytesRead = read(pipefd[0], buffer, sizeof(buffer) - 1)) > 0) {
            buffer[bytesRead] = '\0';
            for (ssize_t i = 0; i < bytesRead; ++i) {
                char c = buffer[i];
                // Handle both \n and \r (tqdm uses \r for inline progress bar updates)
                if (c == '\n' || c == '\r') {
                    if (!lineBuffer.empty()) {
                        if (onLog) onLog(lineBuffer);
                        lineBuffer.clear();
                    }
                } else {
                    lineBuffer += c;
                }
            }
        }
        if (!lineBuffer.empty() && onLog) {
            onLog(lineBuffer);
        }

        close(pipefd[0]);

        int status = 0;
        waitpid(pid, &status, 0);
        if (WIFEXITED(status)) {
            return WEXITSTATUS(status);
        }
        return -1;
    }
#else
    // Windows implementation using _popen for local dev environment
    std::string cmdStr;
    for (size_t i = 0; i < cmd.size(); ++i) {
        if (i > 0) cmdStr += " ";
        // Simple quoting for spaces
        if (cmd[i].find(' ') != std::string::npos) {
            cmdStr += "\"" + cmd[i] + "\"";
        } else {
            cmdStr += cmd[i];
        }
    }
    cmdStr += " 2>&1"; // combine stderr into stdout

    FILE* fp = _popen(cmdStr.c_str(), "r");
    if (!fp) {
        if (onLog) onLog("Failed to execute _popen on Windows.");
        return -1;
    }

    char buffer[1024];
    std::string lineBuffer;
    while (fgets(buffer, sizeof(buffer), fp) != nullptr) {
        size_t len = strlen(buffer);
        for (size_t i = 0; i < len; ++i) {
            char c = buffer[i];
            if (c == '\n' || c == '\r') {
                if (!lineBuffer.empty()) {
                    if (onLog) onLog(lineBuffer);
                    lineBuffer.clear();
                }
            } else {
                lineBuffer += c;
            }
        }
    }
    if (!lineBuffer.empty() && onLog) {
        onLog(lineBuffer);
    }

    int exitCode = _pclose(fp);
    return exitCode;
#endif
}

} // namespace lehra::utils
