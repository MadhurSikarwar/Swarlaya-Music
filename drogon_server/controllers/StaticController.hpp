#pragma once

#include <drogon/HttpController.h>

namespace lehra::controllers {

class StaticController : public drogon::HttpController<StaticController> {
public:
    // ADD_METHOD_TO only builds a regex for {placeholders}: any other path is
    // an exact, literal match ("/.*" would only match the URL "/.*"). The
    // prefix routes therefore use ADD_METHOD_VIA_REGEX. Regex routes are
    // tried in registration order across all controllers, so the catch-all
    // leaves /api/ alone and StemController's routes are always reached.
    METHOD_LIST_BEGIN
        ADD_METHOD_VIA_REGEX(StaticController::getAssets, "/assets/.*", drogon::Get, drogon::Options);
        ADD_METHOD_VIA_REGEX(StaticController::getNext, "/_next/.*", drogon::Get, drogon::Options);
        ADD_METHOD_VIA_REGEX(StaticController::getSeparator, "/separator/.*", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getSeparatorRoot, "/separator", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getRoot, "/", drogon::Get, drogon::Options);
        ADD_METHOD_TO(StaticController::getRootIndex, "/index.html", drogon::Get, drogon::Options);
        ADD_METHOD_VIA_REGEX(StaticController::getCatchAll, "/(?!api/).*", drogon::Get, drogon::Options);
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
