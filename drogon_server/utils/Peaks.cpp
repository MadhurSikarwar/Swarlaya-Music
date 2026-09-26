// Waveform peaks for the stem separator's multitrack view (previously a
// separate sidecar process with a Python fallback).
#define DR_MP3_IMPLEMENTATION
#include "dr_mp3.h"
#include "Peaks.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace lehra::utils {

std::vector<float> computeMp3Peaks(const std::string& path, int resolution) {
    if (resolution <= 0) return {};

    drmp3 mp3;
    if (!drmp3_init_file(&mp3, path.c_str(), nullptr)) return {};
    const drmp3_uint64 frames = drmp3_get_pcm_frame_count(&mp3);
    const drmp3_uint32 channels = mp3.channels;
    if (frames == 0 || channels == 0) {
        drmp3_uninit(&mp3);
        return {};
    }
    std::vector<float> pcm(static_cast<size_t>(frames) * channels);
    const size_t n = static_cast<size_t>(drmp3_read_pcm_frames_f32(&mp3, frames, pcm.data()));
    drmp3_uninit(&mp3);

    const size_t chunk = std::max<size_t>(1, n / static_cast<size_t>(resolution));
    std::vector<float> peaks;
    peaks.reserve(static_cast<size_t>(resolution));
    for (size_t i = 0; i < n && peaks.size() < static_cast<size_t>(resolution); i += chunk) {
        const size_t end = std::min(i + chunk, n);
        float mx = 0.0f;
        for (size_t f = i; f < end; ++f) {
            float sum = 0.0f;
            for (drmp3_uint32 c = 0; c < channels; ++c) sum += pcm[f * channels + c];
            mx = std::max(mx, std::fabs(sum / static_cast<float>(channels)));
        }
        peaks.push_back(mx);
    }

    const float top = peaks.empty() ? 0.0f : *std::max_element(peaks.begin(), peaks.end());
    if (top > 0.0f) {
        for (auto& p : peaks) p = std::round(p / top * 10000.0f) / 10000.0f;
    }
    return peaks;
}

std::string peaksToJson(const std::vector<std::pair<std::string, std::vector<float>>>& stems) {
    // Stem names are fixed identifiers (vocals, drums, ...), so no escaping needed.
    std::string out = "{";
    char num[32];
    for (size_t s = 0; s < stems.size(); ++s) {
        if (s) out += ',';
        out += '"';
        out += stems[s].first;
        out += "\":[";
        const auto& values = stems[s].second;
        for (size_t i = 0; i < values.size(); ++i) {
            if (i) out += ',';
            std::snprintf(num, sizeof num, "%.4f", static_cast<double>(values[i]));
            out += num;
        }
        out += ']';
    }
    out += '}';
    return out;
}

} // namespace lehra::utils
