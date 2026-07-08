#pragma once

#include <drogon/HttpController.h>

namespace lehra::controllers {

class AudioController : public drogon::HttpController<AudioController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(AudioController::getAudio, "/api/audio", drogon::Get, drogon::Options);
        ADD_METHOD_TO(AudioController::getTanpura, "/api/tanpura", drogon::Get, drogon::Options);
        ADD_METHOD_TO(AudioController::getTanpuraString, "/api/tanpura_string", drogon::Get, drogon::Options);
        ADD_METHOD_TO(AudioController::getStatus, "/api/status", drogon::Get, drogon::Options);
        ADD_METHOD_TO(AudioController::getStatus, "/health", drogon::Get, drogon::Options);
        ADD_METHOD_TO(AudioController::getStatus, "/api/health", drogon::Get, drogon::Options);
    METHOD_LIST_END

    void getAudio(const drogon::HttpRequestPtr& req,
                  std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void getTanpura(const drogon::HttpRequestPtr& req,
                    std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void getTanpuraString(const drogon::HttpRequestPtr& req,
                          std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void getStatus(const drogon::HttpRequestPtr& req,
                   std::function<void(const drogon::HttpResponsePtr&)>&& callback);
};

} // namespace lehra::controllers
