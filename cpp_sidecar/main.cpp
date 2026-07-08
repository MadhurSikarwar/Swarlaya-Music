/**
 * Lehra Studio — C++ Peaks Sidecar
 * ===================================
 * Computes waveform peaks for all stems in PARALLEL using a bounded thread pool.
 * Called by Flask via POST /peaks — returns JSON peaks in ~300ms vs ~15s Python.
 *
 * Dependencies (single-header, downloaded at build time):
 *   - cpp-httplib  : HTTP server (no OpenSSL needed for plain HTTP)
 *   - nlohmann/json: JSON parse/emit
 *   - dr_mp3       : MP3 decoder (dr_libs, MIT license)
 *
 * Build (Linux / Docker):
 *   g++ -O3 -std=c++17 -pthread main.cpp -lsoundtouch -o peaks_server
 *
 * Protocol:
 *   POST /peaks
 *     Body:   {"files": ["/abs/path/vocals.mp3", ...], "resolution": 800}
 *     Result: {"vocals": [0.1, 0.32, ...], "drums": [...], ...}
 *
 *   GET /health
 *     Result: {"status":"ok","service":"lehra-peaks-sidecar"}
 *
 * Security:
 *   - Binds to 127.0.0.1 only (not 0.0.0.0) — internal service only.
 *   - File paths validated against ALLOWED_PATH_PREFIXES before opening.
 *   - Port read from SIDECAR_PORT env var, defaulting to 3001.
 */

#define DR_MP3_IMPLEMENTATION
#include "dr_mp3.h"

#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"

#if __has_include(<soundtouch/SoundTouch.h>)
#include <soundtouch/SoundTouch.h>
#elif __has_include(<SoundTouch.h>)
#include <SoundTouch.h>
#else
#include "SoundTouch.h"
#endif

// Use thread-pool mode; plain HTTP only (no OpenSSL dep)
#include "httplib.h"

#include "json.hpp"

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <csignal>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <functional>
#include <future>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using json = nlohmann::json;
using namespace soundtouch;

#include <cstdint>
#include <cstdlib>  // getenv

// ── Global server pointer for graceful shutdown ───────────────────────────────
static httplib::Server* g_svr = nullptr;

// ── Signal handler ────────────────────────────────────────────────────────────
static void handle_signal(int sig) {
    fprintf(stdout, "\n[sidecar] Received signal %d, shutting down gracefully...\n", sig);
    fflush(stdout);
    if (g_svr) {
        g_svr->stop();
    }
}

// ── Allowed base directories for file access ──────────────────────────────────
// SECURITY: Only files under these prefixes may be opened by the sidecar.
// This prevents a malicious caller from reading arbitrary host files.
static const std::vector<std::string> ALLOWED_PATH_PREFIXES = {
    "/tmp/",
    "/app/audio_cache/",
    "/app/uploads/",
    "/var/folders/"   // macOS tmp dirs during local dev
};

static bool is_path_allowed(const std::string& path) {
    // Reject any path containing ".." traversal components
    if (path.find("..") != std::string::npos) {
        return false;
    }
    for (const auto& prefix : ALLOWED_PATH_PREFIXES) {
        if (path.substr(0, prefix.size()) == prefix) {
            return true;
        }
    }
    return false;
}

// ── Bounded Thread Pool ───────────────────────────────────────────────────────
/**
 * A simple fixed-size thread pool to replace unbounded std::async(launch::async).
 * Caps the number of simultaneously running audio decode threads to hardware_concurrency,
 * preventing thread exhaustion and memory spikes on large /peaks requests.
 */
class ThreadPool {
public:
    explicit ThreadPool(size_t n_threads) : stopping_(false) {
        for (size_t i = 0; i < n_threads; ++i) {
            workers_.emplace_back([this] {
                while (true) {
                    std::function<void()> task;
                    {
                        std::unique_lock<std::mutex> lock(mutex_);
                        cv_.wait(lock, [this] { return stopping_ || !tasks_.empty(); });
                        if (stopping_ && tasks_.empty()) return;
                        task = std::move(tasks_.front());
                        tasks_.pop_front();
                    }
                    task();
                }
            });
        }
    }

    ~ThreadPool() {
        {
            std::unique_lock<std::mutex> lock(mutex_);
            stopping_ = true;
        }
        cv_.notify_all();
        for (auto& w : workers_) w.join();
    }

    template<typename F, typename... Args>
    auto enqueue(F&& f, Args&&... args) -> std::future<std::invoke_result_t<F, Args...>> {
        using ReturnType = std::invoke_result_t<F, Args...>;
        auto task = std::make_shared<std::packaged_task<ReturnType()>>(
            std::bind(std::forward<F>(f), std::forward<Args>(args)...)
        );
        std::future<ReturnType> result = task->get_future();
        {
            std::unique_lock<std::mutex> lock(mutex_);
            if (stopping_) throw std::runtime_error("ThreadPool is stopped");
            tasks_.emplace_back([task]() { (*task)(); });
        }
        cv_.notify_one();
        return result;
    }

private:
    std::vector<std::thread> workers_;
    std::deque<std::function<void()>> tasks_;
    std::mutex mutex_;
    std::condition_variable cv_;
    bool stopping_;
};

// Global thread pool — sized to hardware concurrency (min 2, max 8)
static std::unique_ptr<ThreadPool> g_pool;

// ── Pitch & Time Stretching (SoundTouch) ────────────────────────────────────
static bool process_audio_file(const std::string& in_path, const std::string& out_path, float pitch_semitones, float tempo) {
    // SECURITY: Validate paths before opening
    if (!is_path_allowed(in_path) || !is_path_allowed(out_path)) {
        fprintf(stderr, "[sidecar] Blocked disallowed path: in=%s out=%s\n", in_path.c_str(), out_path.c_str());
        return false;
    }

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

    st.putSamples(pSampleData, static_cast<unsigned int>(totalPCMFrameCount));
    drwav_free(pSampleData, nullptr);

    // Read back processed samples
    std::vector<float> outBuffer;
    outBuffer.reserve(static_cast<size_t>(totalPCMFrameCount * 2 * channels)); // rough estimate

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

    // Write 16-bit PCM WAV
    drwav_data_format format;
    format.container = drwav_container_riff;
    format.format = DR_WAVE_FORMAT_PCM;
    format.channels = channels;
    format.sampleRate = sampleRate;
    format.bitsPerSample = 16;

    drwav wav;
    if (!drwav_init_file_write(&wav, out_path.c_str(), &format, nullptr)) {
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

    drwav_write_pcm_frames(&wav, outBuffer.size() / channels, pcm16.data());
    drwav_uninit(&wav);
    return true;
}

// ── Peak Computation ──────────────────────────────────────────────────────────
/**
 * Decode an MP3 file to float PCM, mix to mono, then downsample into
 * 'resolution' amplitude values via max(|sample|) per chunk.
 * Returns a normalized [0..1] vector, or empty on decode failure.
 */
static std::vector<float> compute_stem_peaks(const std::string& filepath, int resolution) {
    // SECURITY: Validate path before opening
    if (!is_path_allowed(filepath)) {
        fprintf(stderr, "[sidecar] Blocked disallowed path in /peaks: %s\n", filepath.c_str());
        return {};
    }

    drmp3 mp3;
    drmp3_config cfg{};
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
        pcm.clear();
        pcm.shrink_to_fit();
    } else {
        mono = std::move(pcm);
    }

    // ── Compute peaks ────────────────────────────────────────────────────────
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
    // ── Read port from environment, default 3001 ──────────────────────────────
    int port = 3001;
    const char* port_env = std::getenv("SIDECAR_PORT");
    if (port_env) {
        try { port = std::stoi(port_env); } catch (...) {}
    }

    // ── Initialize bounded thread pool ────────────────────────────────────────
    const size_t n_threads = std::max(2u, std::min(8u, std::thread::hardware_concurrency()));
    g_pool = std::make_unique<ThreadPool>(n_threads);

    httplib::Server svr;
    g_svr = &svr;

    // ── Register SIGTERM / SIGINT handlers for graceful shutdown ──────────────
    std::signal(SIGTERM, handle_signal);
    std::signal(SIGINT,  handle_signal);

    // ── POST /peaks ──────────────────────────────────────────────────────────
    svr.Post("/peaks", [](const httplib::Request& req, httplib::Response& res) {
        try {
            const auto body       = json::parse(req.body);
            const auto files      = body.at("files").get<std::vector<std::string>>();
            const int  resolution = body.value("resolution", 800);

            // SECURITY: Validate all paths before processing
            for (const auto& fp : files) {
                if (!is_path_allowed(fp)) {
                    res.status = 403;
                    res.set_content(
                        json{{"error", "Path not allowed: " + fp}}.dump(),
                        "application/json"
                    );
                    return;
                }
            }

            using Pair   = std::pair<std::string, std::vector<float>>;
            using Future = std::future<Pair>;

            // FIX: Use bounded thread pool instead of unbounded std::async
            std::vector<Future> futures;
            futures.reserve(files.size());

            for (const std::string& filepath : files) {
                futures.push_back(
                    g_pool->enqueue([filepath, resolution]() -> Pair {
                        return { stem_name_from_path(filepath),
                                 compute_stem_peaks(filepath, resolution) };
                    })
                );
            }

            // Wait for all tasks to finish and collect results
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

            // SECURITY: Validate both input and output paths
            if (!is_path_allowed(input) || !is_path_allowed(output)) {
                res.status = 403;
                res.set_content(
                    json{{"error", "Path not allowed"}}.dump(),
                    "application/json"
                );
                return;
            }

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

    fprintf(stdout, "[sidecar] Lehra C++ Peaks Sidecar listening on 127.0.0.1:%d\n", port);
    fprintf(stdout, "[sidecar] Thread pool: %zu worker threads\n",
            std::max(2u, std::min(8u, std::thread::hardware_concurrency())));
    fprintf(stdout, "[sidecar] Graceful shutdown: SIGTERM/SIGINT registered\n");
    fflush(stdout);

    // FIX: Bind to 127.0.0.1 only — internal service, not publicly accessible
    svr.listen("127.0.0.1", port);

    g_svr = nullptr;
    fprintf(stdout, "[sidecar] Server stopped cleanly.\n");
    return 0;
}
