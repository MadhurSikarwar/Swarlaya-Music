#include "AudioController.hpp"
#include "../services/AudioProcessorService.hpp"
#include "../utils/FileLockManager.hpp"
#include "../utils/Security.hpp"
#include <drogon/HttpResponse.h>
#include <cmath>
#include <thread>
#include <filesystem>

namespace lehra::controllers {

namespace {

constexpr float BASE_HZ = 146.83f;

void sendJsonError(int code, const std::string& msg, std::function<void(const drogon::HttpResponsePtr&)>& cb) {
    Json::Value json;
    json["error"] = msg;
    auto resp = drogon::HttpResponse::newHttpJsonResponse(json);
    resp->setStatusCode(static_cast<drogon::HttpStatusCode>(code));
    utils::addCorsHeaders(resp);
    cb(resp);
}

void sendFileResp(const std::filesystem::path& path, const std::string& mime, int maxAge, std::function<void(const drogon::HttpResponsePtr&)>& cb) {
    auto resp = drogon::HttpResponse::newFileResponse(path.string());
    resp->addHeader("Content-Type", mime);
    utils::addCorsHeaders(resp);
    utils::addCacheHeaders(resp, maxAge);
    cb(resp);
}

bool handleOptions(const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>& cb) {
    if (req->method() == drogon::Options) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k204NoContent);
        utils::addCorsHeaders(resp);
        cb(resp);
        return true;
    }
    return false;
}

} // anonymous namespace

void AudioController::getAudio(const drogon::HttpRequestPtr& req,
                               std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;

    std::string filename = req->getParameter("file");
    if (!utils::isValidAudioFilename(filename)) {
        return sendJsonError(400, "Invalid or missing filename", callback);
    }

    float hz = BASE_HZ;
    float start = 0.0f;
    float end = 0.0f;
    float stretch = 1.0f;
    try {
        if (!req->getParameter("hz").empty()) hz = std::stof(req->getParameter("hz"));
        if (!req->getParameter("start").empty()) start = std::stof(req->getParameter("start"));
        if (!req->getParameter("end").empty()) end = std::stof(req->getParameter("end"));
        if (!req->getParameter("stretch").empty()) stretch = std::stof(req->getParameter("stretch"));
    } catch (...) {
        return sendJsonError(400, "Invalid numerical parameter", callback);
    }

    std::filesystem::path assetsDir = std::filesystem::current_path() / "assets";
    std::filesystem::path assetPath = assetsDir / (filename + ".aac");
    if (!utils::isPathSafe(assetPath, assetsDir) || !std::filesystem::exists(assetPath)) {
        return sendJsonError(404, "Audio file not found: " + filename, callback);
    }

    auto& audioSvc = services::AudioProcessorService::instance();
    std::string cacheKey = audioSvc.computeCacheKey(filename, hz, start, end, stretch);
    std::filesystem::path cacheDir = std::filesystem::current_path() / "audio_cache";
    std::filesystem::path cachePath = cacheDir / cacheKey;

    std::error_code ec;
    if (std::filesystem::exists(cachePath, ec) && std::filesystem::file_size(cachePath, ec) >= 1000) {
        return sendFileResp(cachePath, "audio/ogg", 86400, callback);
    }

    // Cache miss — dispatch generation to detached background thread so Drogon I/O loop never blocks
    std::thread([assetPath, cachePath, hz, start, end, stretch, cb = std::move(callback)]() mutable {
        auto mtx = utils::FileLockManager::instance().getFileMutex(cachePath);
        std::lock_guard<std::mutex> lock(*mtx);

        std::error_code err;
        if (std::filesystem::exists(cachePath, err) && std::filesystem::file_size(cachePath, err) < 1000) {
            std::filesystem::remove(cachePath, err);
        }

        if (!std::filesystem::exists(cachePath, err)) {
            bool success = services::AudioProcessorService::instance().generateAudioCache(
                assetPath, cachePath, hz, start, end, stretch, BASE_HZ
            );
            if (!success) {
                return sendJsonError(500, "Audio processing failed", cb);
            }
        }
        sendFileResp(cachePath, "audio/ogg", 86400, cb);
    }).detach();
}

void AudioController::getTanpura(const drogon::HttpRequestPtr& req,
                                 std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;

    float hz = BASE_HZ;
    try {
        if (!req->getParameter("hz").empty()) hz = std::stof(req->getParameter("hz"));
    } catch (...) {
        return sendJsonError(400, "Invalid numerical parameter", callback);
    }

    std::filesystem::path assetsDir = std::filesystem::current_path() / "assets";
    std::filesystem::path assetPath = assetsDir / "tanpura_06_01.wav";
    if (!std::filesystem::exists(assetPath)) {
        return sendJsonError(404, "Tanpura base file not found", callback);
    }

    float n_semitones = 12.0f * std::log2(hz / BASE_HZ);
    if (std::abs(n_semitones) < 0.05f) {
        return sendFileResp(assetPath, "audio/wav", 86400, callback);
    }

    auto& audioSvc = services::AudioProcessorService::instance();
    std::string cacheKey = audioSvc.computeCacheKey("tanpura_06_01", hz, 0.0f, 0.0f, 1.0f);
    std::filesystem::path cacheDir = std::filesystem::current_path() / "audio_cache";
    std::filesystem::path cachePath = cacheDir / cacheKey;

    std::error_code ec;
    if (std::filesystem::exists(cachePath, ec) && std::filesystem::file_size(cachePath, ec) >= 1000) {
        return sendFileResp(cachePath, "audio/ogg", 86400, callback);
    }

    std::thread([assetPath, cachePath, hz, cb = std::move(callback)]() mutable {
        auto mtx = utils::FileLockManager::instance().getFileMutex(cachePath);
        std::lock_guard<std::mutex> lock(*mtx);

        std::error_code err;
        if (!std::filesystem::exists(cachePath, err)) {
            bool success = services::AudioProcessorService::instance().generateAudioCache(
                assetPath, cachePath, hz, 0.0f, 0.0f, 1.0f, BASE_HZ
            );
            if (!success) {
                return sendJsonError(500, "Tanpura processing failed", cb);
            }
        }
        sendFileResp(cachePath, "audio/ogg", 86400, cb);
    }).detach();
}

void AudioController::getTanpuraString(const drogon::HttpRequestPtr& req,
                                       std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;

    std::string style = req->getParameter("style");
    if (style.empty()) style = "1";
    std::string string_id = req->getParameter("string");
    if (string_id.empty()) string_id = "10";

    if (style != "1" && style != "2") return sendJsonError(400, "Invalid tanpura style", callback);
    if (string_id != "10" && string_id != "20" && string_id != "40") return sendJsonError(400, "Invalid tanpura string", callback);

    float hz = BASE_HZ;
    float tuning_offset = 0.0f;
    try {
        if (!req->getParameter("hz").empty()) hz = std::stof(req->getParameter("hz"));
        if (!req->getParameter("tuning").empty()) tuning_offset = std::stof(req->getParameter("tuning"));
    } catch (...) {
        return sendJsonError(400, "Invalid numerical parameter", callback);
    }

    std::string filename = "tn" + style + "str" + string_id;
    std::filesystem::path assetsDir = std::filesystem::current_path() / "assets";
    std::filesystem::path assetPath = assetsDir / (filename + ".wav");
    if (!std::filesystem::exists(assetPath)) {
        return sendJsonError(404, "Tanpura string file not found: " + filename, callback);
    }

    float target_hz = (string_id == "10") ? (hz * std::pow(2.0f, tuning_offset / 12.0f)) : hz;
    float fake_target_hz = target_hz * (BASE_HZ / 207.65f);

    auto& audioSvc = services::AudioProcessorService::instance();
    std::string cacheKey = audioSvc.computeCacheKey(filename, target_hz, 0.0f, 0.0f, 1.0f);
    std::filesystem::path cacheDir = std::filesystem::current_path() / "audio_cache";
    std::filesystem::path cachePath = cacheDir / cacheKey;

    std::error_code ec;
    if (std::filesystem::exists(cachePath, ec) && std::filesystem::file_size(cachePath, ec) >= 1000) {
        return sendFileResp(cachePath, "audio/ogg", 86400, callback);
    }

    std::thread([assetPath, cachePath, fake_target_hz, cb = std::move(callback)]() mutable {
        auto mtx = utils::FileLockManager::instance().getFileMutex(cachePath);
        std::lock_guard<std::mutex> lock(*mtx);

        std::error_code err;
        if (!std::filesystem::exists(cachePath, err)) {
            bool success = services::AudioProcessorService::instance().generateAudioCache(
                assetPath, cachePath, fake_target_hz, 0.0f, 0.0f, 1.0f, BASE_HZ
            );
            if (!success) {
                return sendJsonError(500, "Tanpura string processing failed", cb);
            }
        }
        sendFileResp(cachePath, "audio/ogg", 86400, cb);
    }).detach();
}

void AudioController::getStatus(const drogon::HttpRequestPtr& req,
                                std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;

    Json::Value json;
    json["status"] = "ok";
    json["base_hz"] = BASE_HZ;
    json["assets"] = "/app/assets";

    auto resp = drogon::HttpResponse::newHttpJsonResponse(json);
    utils::addCorsHeaders(resp);
    callback(resp);
}

} // namespace lehra::controllers
