/**
 * Lehra Studio — C++ Peaks Sidecar
 * ===================================
 * Computes waveform peaks for all stems in PARALLEL using true OS threads.
 * Called by Flask via POST /peaks — returns JSON peaks in ~300ms vs ~15s Python.
 *
 * Dependencies (single-header, downloaded at build time):
 *   - cpp-httplib  : HTTP server (no OpenSSL needed for plain HTTP)
 *   - nlohmann/json: JSON parse/emit
 *   - dr_mp3       : MP3 decoder (dr_libs, MIT license)
 *
 * Build (Linux / Docker):
 *   g++ -O3 -std=c++17 -pthread main.cpp -o peaks_server
 *
 * Protocol:
 *   POST /peaks
 *     Body:   {"files": ["/abs/path/vocals.mp3", ...], "resolution": 800}
 *     Result: {"vocals": [0.1, 0.32, ...], "drums": [...], ...}
 *
 *   GET /health
 *     Result: {"status":"ok","service":"lehra-peaks-sidecar"}
 */

#define DR_MP3_IMPLEMENTATION
#include "dr_mp3.h"

#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"

#include <SoundTouch.h>

// Use thread-pool mode; plain HTTP only (no OpenSSL dep)
#include "httplib.h"

#include "json.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <future>
#include <stdexcept>
#include <string>
#include <vector>

using json = nlohmann::json;
using namespace soundtouch;

// ── Pitch & Time Stretching (SoundTouch) ────────────────────────────────────
static bool process_audio_file(const std::string& in_path, const std::string& out_path, float pitch_semitones, float tempo) {
    unsigned int channels;
    unsigned int sampleRate;
    drwav_uint64 totalPCMFrameCount;
    
    // Read WAV
    float* pSampleData = drwav_open_file_and_read_pcm_frames_f32(in_path.c_str(), &channels, &sampleRate, &totalPCMFrameCount, nullptr);
    if (pSampleData == nullptr) {
        fprintf(stderr, "[sidecar] Failed to open input WAV: %s\n", in_path.c_str());
        return false;
    }

    SoundTouch st;
    st.setSampleRate(sampleRate);
    st.setChannels(channels);
    
    // Tempo (1.0 = normal, <1.0 slower, >1.0 faster)
    st.setTempo(tempo);
    
    // Pitch shift in semitones
    st.setPitchSemiTones(pitch_semitones);

    st.putSamples(pSampleData, totalPCMFrameCount);
    drwav_free(pSampleData, nullptr);

    // Read back processed samples
    std::vector<float> outBuffer;
    outBuffer.reserve(totalPCMFrameCount * 2 * channels); // rough estimate
    
    float temp[4096 * 2]; // up to stereo
    unsigned int numSamples = 0;
    do {
        numSamples = st.receiveSamples(temp, 4096);
        outBuffer.insert(outBuffer.end(), temp, temp + (numSamples * channels));
    } while (numSamples != 0);

    // Flush remaining
    st.flush();
    do {
        numSamples = st.receiveSamples(temp, 4096);
        outBuffer.insert(outBuffer.end(), temp, temp + (numSamples * channels));
    } while (numSamples != 0);

    // Write 16-bit PCM WAV (which is what Flask currently expects for cache)
    drwav_data_format format;
    format.container = drwav_container_riff;
    format.format = DR_WAVE_FORMAT_PCM;
    format.channels = channels;
    format.sampleRate = sampleRate;
    format.bitsPerSample = 16;

    drwav* pWav = drwav_open_file_write(out_path.c_str(), &format, nullptr);
    if (pWav == nullptr) {
        fprintf(stderr, "[sidecar] Failed to open output WAV: %s\n", out_path.c_str());
        return false;
    }
    
    // Convert float to 16-bit PCM for writing
    std::vector<int16_t> pcm16(outBuffer.size());
    for (size_t i = 0; i < outBuffer.size(); ++i) {
        float sample = outBuffer[i];
        if (sample > 1.0f) sample = 1.0f;
        if (sample < -1.0f) sample = -1.0f;
        pcm16[i] = static_cast<int16_t>(sample * 32767.0f);
    }

    drwav_write_pcm_frames(pWav, outBuffer.size() / channels, pcm16.data());
    drwav_close(pWav);
    return true;
}

// ── Peak Computation ──────────────────────────────────────────────────────────
/**
 * Decode an MP3 file to float PCM, mix to mono, then downsample into
 * 'resolution' amplitude values via max(|sample|) per chunk.
 * Returns a normalized [0..1] vector, or empty on decode failure.
 */
static std::vector<float> compute_stem_peaks(const std::string& filepath, int resolution) {
    drmp3 mp3;
    drmp3_config cfg{};
    // Force 2-channel (stereo) so we always know the layout
    if (!drmp3_init_file(&mp3, filepath.c_str(), nullptr)) {
        fprintf(stderr, "[sidecar] Failed to open MP3: %s\n", filepath.c_str());
        return {};
    }

    const drmp3_uint64 total_frames = drmp3_get_pcm_frame_count(&mp3);
    if (total_frames == 0) {
        drmp3_uninit(&mp3);
        return {};
    }

    const uint32_t ch = mp3.channels;
    std::vector<float> pcm(static_cast<size_t>(total_frames) * ch);
    drmp3_read_pcm_frames_f32(&mp3, total_frames, pcm.data());
    drmp3_uninit(&mp3);

    // ── Mix to mono ──────────────────────────────────────────────────────────
    std::vector<float> mono;
    if (ch == 2) {
        mono.resize(static_cast<size_t>(total_frames));
        for (drmp3_uint64 i = 0; i < total_frames; ++i) {
            mono[i] = (pcm[i * 2] + pcm[i * 2 + 1]) * 0.5f;
        }
        pcm.clear(); // free stereo buffer immediately
        pcm.shrink_to_fit();
    } else {
        mono = std::move(pcm);
    }

    // ── Compute peaks ────────────────────────────────────────────────────────
    // Divide samples into 'resolution' equal chunks; take max(|x|) per chunk.
    const size_t n     = mono.size();
    const size_t chunk = std::max((size_t)1, n / (size_t)resolution);
    std::vector<float> peaks;
    peaks.reserve(resolution);

    for (size_t i = 0; i < n && static_cast<int>(peaks.size()) < resolution; i += chunk) {
        float mx = 0.0f;
        const size_t end = std::min(i + chunk, n);
        for (size_t j = i; j < end; ++j) {
            const float a = std::abs(mono[j]);
            if (a > mx) mx = a;
        }
        peaks.push_back(mx);
    }

    // ── Normalize to [0..1] with 4 decimal precision ─────────────────────────
    const float global_max = peaks.empty()
        ? 1.0f
        : *std::max_element(peaks.begin(), peaks.end());

    if (global_max > 0.0f) {
        for (auto& p : peaks) {
            p = std::round(p / global_max * 10000.0f) / 10000.0f;
        }
    }

    return peaks;
}

// ── Utility ───────────────────────────────────────────────────────────────────
/** "/app/stems/out_xyz/vocals.mp3" → "vocals" */
static std::string stem_name_from_path(const std::string& path) {
    const size_t slash = path.rfind('/');
    std::string base   = (slash != std::string::npos) ? path.substr(slash + 1) : path;
    const size_t dot   = base.rfind('.');
    return (dot != std::string::npos) ? base.substr(0, dot) : base;
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main() {
    httplib::Server svr;

    // ── POST /peaks ──────────────────────────────────────────────────────────
    svr.Post("/peaks", [](const httplib::Request& req, httplib::Response& res) {
        try {
            const auto body       = json::parse(req.body);
            // capture by value so each lambda owns its string
            const auto files      = body.at("files").get<std::vector<std::string>>();
            const int  resolution = body.value("resolution", 800);

            // Launch one async task per stem — each runs on its own OS thread.
            // 6 stems → 6 threads → all decoded simultaneously (no GIL, no waiting).
            using Pair   = std::pair<std::string, std::vector<float>>;
            using Future = std::future<Pair>;

            std::vector<Future> futures;
            futures.reserve(files.size());

            for (const std::string& filepath : files) {
                futures.push_back(
                    std::async(std::launch::async, [filepath, resolution]() -> Pair {
                        return { stem_name_from_path(filepath),
                                 compute_stem_peaks(filepath, resolution) };
                    })
                );
            }

            // Wait for all threads to finish and collect results
            json result = json::object();
            for (auto& f : futures) {
                auto [name, peaks] = f.get();
                result[name] = std::move(peaks);
            }

            res.set_content(result.dump(), "application/json");
            fprintf(stdout, "[sidecar] Peaks computed for %zu stems\n", files.size());

        } catch (const std::exception& e) {
            fprintf(stderr, "[sidecar] /peaks error: %s\n", e.what());
            res.status = 500;
            res.set_content(
                json{{"error", std::string(e.what())}}.dump(),
                "application/json"
            );
        }
    });

    // ── POST /process_audio ──────────────────────────────────────────────────
    svr.Post("/process_audio", [](const httplib::Request& req, httplib::Response& res) {
        try {
            const auto body = json::parse(req.body);
            std::string input  = body.at("input").get<std::string>();
            std::string output = body.at("output").get<std::string>();
            float pitch_semitones = body.value("pitch_semitones", 0.0f);
            float stretch = body.value("stretch", 1.0f);

            bool success = process_audio_file(input, output, pitch_semitones, stretch);
            if (success) {
                res.set_content(R"({"status":"ok"})", "application/json");
                fprintf(stdout, "[sidecar] Processed audio: %s\n", input.c_str());
            } else {
                res.status = 500;
                res.set_content(R"({"error":"Audio processing failed"})", "application/json");
            }
        } catch (const std::exception& e) {
            fprintf(stderr, "[sidecar] /process_audio error: %s\n", e.what());
            res.status = 500;
            res.set_content(json{{"error", std::string(e.what())}}.dump(), "application/json");
        }
    });

    // ── GET /health ──────────────────────────────────────────────────────────
    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(
            R"({"status":"ok","service":"lehra-peaks-sidecar"})",
            "application/json"
        );
    });

    fprintf(stdout, "[sidecar] Lehra C++ Peaks Sidecar listening on 0.0.0.0:3001\n");
    fprintf(stdout, "[sidecar] Parallel mode: std::async per stem (one OS thread per stem)\n");
    fflush(stdout);

    svr.listen("0.0.0.0", 3001);
    return 0;
}
