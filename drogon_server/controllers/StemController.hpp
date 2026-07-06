#pragma once

#include <drogon/HttpController.h>
#include <string>

namespace lehra::controllers {

class StemController : public drogon::HttpController<StemController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(StemController::separate, "/api/separate", drogon::Post, drogon::Options);
        ADD_METHOD_TO(StemController::getJobStatus, "/api/job_status/{1}", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StemController::getStem, "/api/stems/{1}/{2}", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StemController::getStemsPeaks, "/api/stems_peaks/{1}", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StemController::downloadStems, "/api/download/{1}", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StemController::cleanupJob, "/api/cleanup/{1}", drogon::Delete, drogon::Options);
    METHOD_LIST_END

    void separate(const drogon::HttpRequestPtr& req,
                  std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void getJobStatus(const drogon::HttpRequestPtr& req,
                      std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                      const std::string& jobId);

    void getStem(const drogon::HttpRequestPtr& req,
                 std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                 const std::string& jobId,
                 const std::string& stemName);

    void getStemsPeaks(const drogon::HttpRequestPtr& req,
                       std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                       const std::string& jobId);

    void downloadStems(const drogon::HttpRequestPtr& req,
                       std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                       const std::string& jobId);

    void cleanupJob(const drogon::HttpRequestPtr& req,
                    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
                    const std::string& jobId);
};

} // namespace lehra::controllers
