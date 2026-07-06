#include "StaticController.hpp"
#include "../utils/Security.hpp"
#include <drogon/HttpResponse.h>
#include <filesystem>
#include <algorithm>

namespace lehra::controllers {

namespace {

void setCustomMimeIfMissing(const drogon::HttpResponsePtr& resp, const std::filesystem::path& p) {
    if (!resp) return;
    std::string ext = p.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c){ return std::tolower(c); });
    if (ext == ".aac") resp->addHeader("Content-Type", "audio/aac");
    else if (ext == ".ogg") resp->addHeader("Content-Type", "audio/ogg");
    else if (ext == ".wav") resp->addHeader("Content-Type", "audio/wav");
    else if (ext == ".mp3") resp->addHeader("Content-Type", "audio/mpeg");
    else if (ext == ".html") resp->addHeader("Content-Type", "text/html");
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

void serveSafeFile(const std::filesystem::path& targetPath,
                   const std::filesystem::path& baseDir,
                   int maxAge,
                   const std::filesystem::path& fallbackPath,
                   std::function<void(const drogon::HttpResponsePtr&)>& cb) {
    std::error_code ec;
    if (utils::isPathSafe(targetPath, baseDir) && 
        std::filesystem::exists(targetPath, ec) && 
        std::filesystem::is_regular_file(targetPath, ec)) {
        
        auto resp = drogon::HttpResponse::newFileResponse(targetPath.string());
        setCustomMimeIfMissing(resp, targetPath);
        utils::addCorsHeaders(resp);
        utils::addCacheHeaders(resp, maxAge);
        cb(resp);
        return;
    }

    if (!fallbackPath.empty() && std::filesystem::exists(fallbackPath, ec)) {
        auto resp = drogon::HttpResponse::newFileResponse(fallbackPath.string());
        resp->addHeader("Content-Type", "text/html");
        utils::addCorsHeaders(resp);
        utils::addCacheHeaders(resp, 3600);
        cb(resp);
        return;
    }

    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setStatusCode(drogon::k404NotFound);
    utils::addCorsHeaders(resp);
    cb(resp);
}

} // anonymous namespace

void StaticController::getAssets(const drogon::HttpRequestPtr& req,
                                 std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;
    std::string path = req->path();
    std::string rel = (path.length() >= 8) ? path.substr(8) : "";
    std::filesystem::path baseDir = std::filesystem::current_path() / "assets";
    serveSafeFile(baseDir / rel, baseDir, 86400, {}, callback);
}

void StaticController::getNext(const drogon::HttpRequestPtr& req,
                               std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;
    std::string path = req->path();
    std::string rel = (path.length() >= 7) ? path.substr(7) : "";
    std::filesystem::path baseDir = std::filesystem::current_path() / "public" / "separator" / "_next";
    serveSafeFile(baseDir / rel, baseDir, 31536000, {}, callback);
}

void StaticController::getSeparator(const drogon::HttpRequestPtr& req,
                                    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;
    std::string path = req->path();
    std::string rel = (path.length() >= 11) ? path.substr(11) : "";
    std::filesystem::path baseDir = std::filesystem::current_path() / "public" / "separator";
    serveSafeFile(baseDir / rel, baseDir, 86400, baseDir / "index.html", callback);
}

void StaticController::getSeparatorRoot(const drogon::HttpRequestPtr& req,
                                        std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;
    std::filesystem::path indexFile = std::filesystem::current_path() / "public" / "separator" / "index.html";
    serveSafeFile(indexFile, indexFile.parent_path(), 3600, {}, callback);
}

void StaticController::getRoot(const drogon::HttpRequestPtr& req,
                               std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;
    std::filesystem::path indexFile = std::filesystem::current_path() / "index.html";
    serveSafeFile(indexFile, indexFile.parent_path(), 3600, {}, callback);
}

void StaticController::getRootIndex(const drogon::HttpRequestPtr& req,
                                    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;
    std::filesystem::path indexFile = std::filesystem::current_path() / "index.html";
    serveSafeFile(indexFile, indexFile.parent_path(), 3600, {}, callback);
}

void StaticController::getCatchAll(const drogon::HttpRequestPtr& req,
                                   std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;

    std::string path = req->path();
    if (path.compare(0, 5, "/api/") == 0) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k404NotFound);
        utils::addCorsHeaders(resp);
        callback(resp);
        return;
    }

    std::string rel = path.empty() ? "" : (path[0] == '/' ? path.substr(1) : path);
    std::filesystem::path baseDir = std::filesystem::current_path();
    std::filesystem::path target = baseDir / rel;
    std::filesystem::path fallback = baseDir / "index.html";

    serveSafeFile(target, baseDir, 3600, fallback, callback);
}

} // namespace lehra::controllers
