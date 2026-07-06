#include "Security.hpp"
#include <regex>
#include <algorithm>

namespace lehra::utils {

const std::set<std::string> ALLOWED_STEMS = {
    "vocals.mp3", "drums.mp3", "bass.mp3", 
    "guitar.mp3", "piano.mp3", "other.mp3"
};

bool isValidJobId(const std::string& id) {
    static const std::regex uuidRegex(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
        std::regex_constants::optimize
    );
    return std::regex_match(id, uuidRegex);
}

bool isPathSafe(const std::filesystem::path& target, const std::filesystem::path& base) {
    try {
        std::error_code ec;
        auto canonicalTarget = std::filesystem::weakly_canonical(target, ec);
        if (ec) return false;
        auto canonicalBase = std::filesystem::weakly_canonical(base, ec);
        if (ec) return false;

        std::string targetStr = canonicalTarget.generic_string();
        std::string baseStr = canonicalBase.generic_string();

        // Ensure target starts exactly with base directory path
        if (targetStr.length() < baseStr.length()) return false;
        if (targetStr.compare(0, baseStr.length(), baseStr) != 0) return false;
        
        // Ensure boundary is a directory separator or exact match
        if (targetStr.length() > baseStr.length() && 
            baseStr.back() != '/' && targetStr[baseStr.length()] != '/') {
            return false;
        }

        return true;
    } catch (...) {
        return false;
    }
}

bool isValidAudioFilename(const std::string& filename) {
    if (filename.empty()) return false;
    if (filename.find("..") != std::string::npos) return false;
    if (filename.find('/') != std::string::npos) return false;
    if (filename.find('\\') != std::string::npos) return false;
    return true;
}

void addCorsHeaders(const drogon::HttpResponsePtr& resp) {
    if (!resp) return;
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    resp->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

void addCacheHeaders(const drogon::HttpResponsePtr& resp, int maxAgeSeconds) {
    if (!resp) return;
    resp->addHeader("Cache-Control", "public, max-age=" + std::to_string(maxAgeSeconds));
}

} // namespace lehra::utils
