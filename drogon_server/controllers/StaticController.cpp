#include "StaticController.hpp"
#include "../utils/Security.hpp"
#include <drogon/HttpResponse.h>
#include <filesystem>
#include <algorithm>
#include <set>

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
    // max-age=0: a deploy must reach visitors on their next load.
    serveSafeFile(indexFile, indexFile.parent_path(), 0, {}, callback);
}

void StaticController::getRootIndex(const drogon::HttpRequestPtr& req,
                                    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;
    std::filesystem::path indexFile = std::filesystem::current_path() / "index.html";
    // max-age=0: a deploy must reach visitors on their next load.
    serveSafeFile(indexFile, indexFile.parent_path(), 0, {}, callback);
}

void StaticController::getCatchAll(const drogon::HttpRequestPtr& req,
                                   std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;

    // Only the website itself is public: these root files and public/
    // (assets/, separator/ and _next/ have their own routes). Everything else
    // in the app directory — sources, config, binaries, uploads — is not.
    static const std::set<std::string> kRootFiles = {"sw.js", "manifest.json", "favicon.ico", "robots.txt"};
    // Client-side routes handled by initNavigation() in public/js/core/navigation.js.
    static const std::set<std::string> kSpaRoutes = {"lehra", "hindustani", "carnatic", "notation", "practice", "games", "account"};

    std::string path = req->path();
    std::string rel = path.empty() ? "" : (path[0] == '/' ? path.substr(1) : path);
    while (!rel.empty() && rel.back() == '/') rel.pop_back();
    std::filesystem::path baseDir = std::filesystem::current_path();

    if (kSpaRoutes.count(rel)) {
        serveSafeFile(baseDir / "index.html", baseDir, 0, {}, callback);
        return;
    }
    if (kRootFiles.count(rel)) {
        serveSafeFile(baseDir / rel, baseDir, 0, {}, callback);
        return;
    }
    if (rel.compare(0, 7, "public/") == 0) {
        // max-age=0: ES modules are imported without version query strings,
        // so they must revalidate or a deploy could mix old and new modules.
        serveSafeFile(baseDir / rel, baseDir / "public", 0, {}, callback);
        return;
    }

    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setStatusCode(drogon::k404NotFound);
    utils::addCorsHeaders(resp);
    callback(resp);
}

} // namespace lehra::controllers
