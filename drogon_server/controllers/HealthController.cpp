#include "HealthController.hpp"
#include "../utils/Security.hpp"
#include <drogon/HttpResponse.h>

namespace lehra::controllers {

void HealthController::getStatus(const drogon::HttpRequestPtr& req,
                                 std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    if (req->method() == drogon::Options) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k204NoContent);
        utils::addCorsHeaders(resp);
        callback(resp);
        return;
    }

    Json::Value json;
    json["status"] = "ok";
    auto resp = drogon::HttpResponse::newHttpJsonResponse(json);
    utils::addCorsHeaders(resp);
    callback(resp);
}

} // namespace lehra::controllers
