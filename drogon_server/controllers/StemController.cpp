#include "StemController.hpp"
#include "../models/JobStore.hpp"
#include "../services/JobWorkerPool.hpp"
#include "../utils/Security.hpp"
#include <drogon/HttpResponse.h>
#include <drogon/MultiPart.h>
#include <filesystem>
#include <fstream>
#include <algorithm>
#include <set>

namespace lehra::controllers {

namespace {

const std::set<std::string> ALLOWED_UPLOAD_EXTENSIONS = {
    ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a",
    ".mp4", ".mkv", ".mov", ".webm", ".avi", ".wma",
    ".aiff", ".alac", ""
};

void sendJsonError(int code, const std::string& msg, std::function<void(const drogon::HttpResponsePtr&)>& cb) {
    Json::Value json;
    json["error"] = msg;
    auto resp = drogon::HttpResponse::newHttpJsonResponse(json);
    resp->setStatusCode(static_cast<drogon::HttpStatusCode>(code));
    utils::addCorsHeaders(resp);
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

std::string toLower(const std::string& str) {
    std::string res = str;
    std::transform(res.begin(), res.end(), res.begin(), [](unsigned char c){ return std::tolower(c); });
    return res;
}

} // anonymous namespace

void StemController::separate(const drogon::HttpRequestPtr& req,
                              std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (handleOptions(req, callback)) return;

    drogon::MultiPartParser fileUpload;
    if (fileUpload.parse(req) != 0 || fileUpload.getFiles().empty()) {
        return sendJsonError(400, "No file uploaded", callback);
    }

    auto& file = fileUpload.getFiles()[0];
    std::string origName = file.getFileName();
    std::filesystem::path origPath(origName);
    std::string ext = toLower(origPath.extension().string());

    if (ALLOWED_UPLOAD_EXTENSIONS.find(ext) == ALLOWED_UPLOAD_EXTENSIONS.end()) {
        return sendJsonError(400, "Unsupported file extension: " + ext, callback);
    }

    std::string jobId = models::JobStore::instance().createJob();
    std::filesystem::path uploadsDir = std::filesystem::current_path() / "uploads";
    std::error_code ec;
    std::filesystem::create_directories(uploadsDir, ec);

    std::filesystem::path uploadPath = uploadsDir / (jobId + ext);
    std::ofstream out(uploadPath, std::ios::binary | std::ios::trunc);
    if (!out.is_open()) {
        models::JobStore::instance().deleteJob(jobId);
        return sendJsonError(500, "Failed to save uploaded file on server", callback);
    }
    const auto& fileContent = file.fileContent();
    out.write(fileContent.data(), static_cast<std::streamsize>(fileContent.size()));
    out.close();

    services::JobWorkerPool::instance().enqueueJob(jobId, uploadPath);

    Json::Value res;
    res["job_id"] = jobId;
    res["status"] = "queued";
    auto resp = drogon::HttpResponse::newHttpJsonResponse(res);
    resp->setStatusCode(drogon::k202Accepted);
    utils::addCorsHeaders(resp);
    callback(resp);
}

void StemController::getJobStatus(const drogon::HttpRequestPtr& req,
                                  std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                                  const std::string& jobId) {
    if (handleOptions(req, callback)) return;
    if (!utils::isValidJobId(jobId)) {
        return sendJsonError(400, "Invalid job ID format", callback);
    }

    auto job = models::JobStore::instance().getJob(jobId);
    if (!job) {
        return sendJsonError(404, "Job not found", callback);
    }

    auto resp = drogon::HttpResponse::newHttpJsonResponse(job->toJson());
    utils::addCorsHeaders(resp);
    callback(resp);
}

void StemController::getStem(const drogon::HttpRequestPtr& req,
                             std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                             const std::string& jobId,
                             const std::string& stemName) {
    if (handleOptions(req, callback)) return;
    if (!utils::isValidJobId(jobId)) {
        return sendJsonError(400, "Invalid job ID format", callback);
    }
    if (utils::ALLOWED_STEMS.find(stemName) == utils::ALLOWED_STEMS.end()) {
        return sendJsonError(400, "Invalid stem name", callback);
    }

    std::filesystem::path stemsDir = std::filesystem::current_path() / "uploads" / "stems";
    std::filesystem::path stemPath = stemsDir / ("out_" + jobId) / stemName;

    if (!utils::isPathSafe(stemPath, stemsDir) || !std::filesystem::exists(stemPath)) {
        return sendJsonError(404, "Stem file not found", callback);
    }

    auto resp = drogon::HttpResponse::newFileResponse(stemPath.string());
    resp->addHeader("Content-Type", "audio/mpeg");
    utils::addCorsHeaders(resp);
    utils::addCacheHeaders(resp, 3600);
    callback(resp);
}

void StemController::getStemsPeaks(const drogon::HttpRequestPtr& req,
                                   std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                                   const std::string& jobId) {
    if (handleOptions(req, callback)) return;
    if (!utils::isValidJobId(jobId)) {
        return sendJsonError(400, "Invalid job ID format", callback);
    }

    auto job = models::JobStore::instance().getJob(jobId);
    if (!job || job->status != models::JobStatus::Completed) {
        return sendJsonError(404, "Job not ready or not found", callback);
    }

    std::filesystem::path peaksPath = job->peaks_path;
    if (peaksPath.empty() || !std::filesystem::exists(peaksPath)) {
        return sendJsonError(404, "Peaks not available", callback);
    }

    auto resp = drogon::HttpResponse::newFileResponse(peaksPath.string());
    resp->addHeader("Content-Type", "application/json");
    utils::addCorsHeaders(resp);
    utils::addCacheHeaders(resp, 3600);
    callback(resp);
}

void StemController::downloadStems(const drogon::HttpRequestPtr& req,
                                   std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                                   const std::string& jobId) {
    if (handleOptions(req, callback)) return;
    if (!utils::isValidJobId(jobId)) {
        return sendJsonError(400, "Invalid job ID format", callback);
    }

    std::filesystem::path stemsDir = std::filesystem::current_path() / "uploads" / "stems";
    std::filesystem::path zipPath = stemsDir / (jobId + "_stems.zip");

    if (!utils::isPathSafe(zipPath, stemsDir) || !std::filesystem::exists(zipPath)) {
        return sendJsonError(404, "Zip archive not found", callback);
    }

    auto resp = drogon::HttpResponse::newFileResponse(zipPath.string(), jobId + "_stems.zip");
    resp->addHeader("Content-Type", "application/zip");
    resp->addHeader("Content-Disposition", "attachment; filename=\"" + jobId + "_stems.zip\"");
    utils::addCorsHeaders(resp);
    callback(resp);
}

void StemController::cleanupJob(const drogon::HttpRequestPtr& req,
                                std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                                const std::string& jobId) {
    if (handleOptions(req, callback)) return;
    if (!utils::isValidJobId(jobId)) {
        return sendJsonError(400, "Invalid job ID format", callback);
    }

    std::error_code ec;
    std::filesystem::path stemsDir = std::filesystem::current_path() / "uploads" / "stems";
    std::filesystem::path outDir = stemsDir / ("out_" + jobId);
    std::filesystem::path zipPath = stemsDir / (jobId + "_stems.zip");

    if (std::filesystem::exists(outDir, ec)) {
        std::filesystem::remove_all(outDir, ec);
    }
    if (std::filesystem::exists(zipPath, ec)) {
        std::filesystem::remove(zipPath, ec);
    }

    std::filesystem::path uploadsDir = std::filesystem::current_path() / "uploads";
    for (const auto& ext : ALLOWED_UPLOAD_EXTENSIONS) {
        std::filesystem::path inputPath = uploadsDir / (jobId + ext);
        if (std::filesystem::exists(inputPath, ec)) {
            std::filesystem::remove(inputPath, ec);
        }
    }

    models::JobStore::instance().deleteJob(jobId);

    Json::Value res;
    res["status"] = "cleaned";
    auto resp = drogon::HttpResponse::newHttpJsonResponse(res);
    utils::addCorsHeaders(resp);
    callback(resp);
}

} // namespace lehra::controllers
