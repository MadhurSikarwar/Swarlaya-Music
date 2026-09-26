#pragma once

#include <drogon/HttpController.h>

namespace lehra::controllers {

// Liveness endpoints (Render's healthCheckPath is /health).
class HealthController : public drogon::HttpController<HealthController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(HealthController::getStatus, "/api/status", drogon::Get, drogon::Options);
        ADD_METHOD_TO(HealthController::getStatus, "/health", drogon::Get, drogon::Options);
        ADD_METHOD_TO(HealthController::getStatus, "/api/health", drogon::Get, drogon::Options);
    METHOD_LIST_END

    void getStatus(const drogon::HttpRequestPtr& req,
                   std::function<void(const drogon::HttpResponsePtr&)>&& callback);
};

} // namespace lehra::controllers
