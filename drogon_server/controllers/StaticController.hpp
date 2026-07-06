#pragma once

#include <drogon/HttpController.h>

namespace lehra::controllers {

class StaticController : public drogon::HttpController<StaticController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(StaticController::getAssets, "/assets/.*", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getNext, "/_next/.*", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getSeparator, "/separator/.*", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getSeparatorRoot, "/separator", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getRoot, "/", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getRootIndex, "/index.html", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getCatchAll, "/.*", drogon::Get, drogon::Options);
    METHOD_LIST_END

    void getAssets(const drogon::HttpRequestPtr& req,
                   std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void getNext(const drogon::HttpRequestPtr& req,
                 std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void getSeparator(const drogon::HttpRequestPtr& req,
                      std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void getSeparatorRoot(const drogon::HttpRequestPtr& req,
                          std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void getRoot(const drogon::HttpRequestPtr& req,
                 std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void getRootIndex(const drogon::HttpRequestPtr& req,
                      std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void getCatchAll(const drogon::HttpRequestPtr& req,
                     std::function<void(const drogon::HttpResponsePtr&)>&& callback);
};

} // namespace lehra::controllers
