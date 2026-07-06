#pragma once

#include <string>
#include <filesystem>
#include <set>
#include <drogon/HttpResponse.h>

namespace lehra::utils {

// Strict UUID4 regex validation
bool isValidJobId(const std::string& id);

// Ensure target path resolves strictly within base directory (prevents path traversal)
bool isPathSafe(const std::filesystem::path& target, const std::filesystem::path& base);

// Validate audio filename param (no "..", "/", "\")
bool isValidAudioFilename(const std::string& filename);

// Allowed stem file names for Demucs extraction
extern const std::set<std::string> ALLOWED_STEMS;

// HTTP Response modification helpers for uniform CORS and Cache-Control
void addCorsHeaders(const drogon::HttpResponsePtr& resp);
void addCacheHeaders(const drogon::HttpResponsePtr& resp, int maxAgeSeconds);

} // namespace lehra::utils
