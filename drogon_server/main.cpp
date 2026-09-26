#include <drogon/drogon.h>
#include "services/JobWorkerPool.hpp"
#include <chrono>
#include <filesystem>
#include <iostream>
#include <cstdlib>

int main(int argc, char* argv[]) {
    try {
        std::cout << "===================================================================\n";
        std::cout << "  LEHRA STUDIO — HIGH-PERFORMANCE C++ DROGON BACKEND\n";
        std::cout << "  Initializing directories, worker pools, and LRU cache engines...\n";
        std::cout << "===================================================================\n";

        // Ensure runtime directories exist
        std::error_code ec;
        std::filesystem::create_directories("uploads/stems", ec);
        std::filesystem::create_directories("assets", ec);

        // One Demucs separation at a time: each needs several GB of RAM.
        lehra::services::JobWorkerPool::instance().start(1);

        // Load Drogon configuration from config.json if available
        if (std::filesystem::exists("drogon_server/config.json")) {
            drogon::app().loadConfigFile("drogon_server/config.json");
        } else if (std::filesystem::exists("config.json")) {
            drogon::app().loadConfigFile("config.json");
        } else {
            LOG_WARN << "config.json not found! Using fallback configuration (4 I/O threads).";
            drogon::app().setThreadNum(4);
            drogon::app().setClientMaxBodySize(100ULL * 1024ULL * 1024ULL);
        }

        // Determine listener port from $PORT environment variable or default to 3000
        int port = 3000;
        if (const char* envPort = std::getenv("PORT")) {
            try {
                port = std::stoi(envPort);
                LOG_INFO << "Overriding listener port from environment $PORT: " << port;
            } catch (...) {
                LOG_WARN << "Invalid $PORT environment variable (" << envPort << "), using default 3000.";
            }
        }
        drogon::app().addListener("0.0.0.0", port);

        drogon::app().registerBeginningAdvice([port]() {
            LOG_INFO << "Lehra Studio Drogon server successfully started and listening on 0.0.0.0:" << port;
        });

        // Stem-separation uploads and results are deleted an hour after the
        // job was created (checked every 10 minutes).
        drogon::app().getLoop()->runEvery(10 * 60, [] {
            lehra::services::JobWorkerPool::instance().sweepExpired(std::chrono::hours(1));
        });

        // Run HTTP server event loop (blocks until shutdown signal)
        drogon::app().run();

        LOG_INFO << "Server shutting down. Stopping background services...";
        lehra::services::JobWorkerPool::instance().stop();
        LOG_INFO << "Shutdown complete. Goodbye!";
    } catch (const std::exception& e) {
        std::cerr << "FATAL ERROR: Unhandled exception in main: " << e.what() << std::endl;
        return 1;
    }
    return 0;
}
