#pragma once

#include <string>
#include <utility>
#include <vector>

namespace lehra::utils {

/// Decode an MP3, mix it to mono and reduce it to `resolution` values of
/// max(|sample|) per equal-length chunk, normalised to [0, 1] and rounded to
/// 4 decimals. Returns an empty vector if the file can't be decoded.
std::vector<float> computeMp3Peaks(const std::string& path, int resolution);

/// {"<name>":[p0,p1,...],...} with 4-decimal values — the separator page's peaks.json.
std::string peaksToJson(const std::vector<std::pair<std::string, std::vector<float>>>& stems);

} // namespace lehra::utils
