# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Build SoundTouch from source (static), then compile C++ sidecar and Drogon backend.
# This stage is discarded after build — dev tools NEVER appear in the runtime image.
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    cmake \
    make \
    git \
    wget \
    pkg-config \
    libdrogon-dev \
    libjsoncpp-dev \
    uuid-dev \
    libssl-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# ── Build SoundTouch from source (static library) ────────────────────────────
# This guarantees -lsoundtouch and its headers exist regardless of distro quirks.
RUN wget -q https://codeberg.org/soundtouch/soundtouch/archive/2.3.2.tar.gz -O soundtouch.tar.gz \
    && tar -xzf soundtouch.tar.gz \
    && cd soundtouch \
    && mkdir build_st \
    && cd build_st \
    && cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
    && make -j$(nproc) \
    && make install \
    && cd /build \
    && rm -rf soundtouch soundtouch.tar.gz

# ── Build the C++ sidecar ─────────────────────────────────────────────────────
COPY cpp_sidecar/ ./cpp_sidecar/

RUN g++ -O3 -std=c++17 -pthread \
    -I/usr/local/include/soundtouch \
    -I/usr/local/include \
    cpp_sidecar/main.cpp \
    /usr/local/lib/libSoundTouch.a \
    -o peaks_server

# ── Build Drogon C++ server ───────────────────────────────────────────────────
COPY drogon_server/ ./drogon_server/
RUN cd drogon_server && mkdir -p build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release && \
    make -j$(nproc)


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean production image — no build compilers, smaller attack surface, smaller size.
FROM python:3.11-slim AS runtime

# Install runtime dependencies only (no -dev packages needed since sidecar is statically linked)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libjsoncpp25 \
    libssl3 \
    zlib1g \
    libdrogon-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies before copying app code (better layer caching)
COPY requirements.txt /app/
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy compiled C++ binaries from builder stage
COPY --from=builder /build/peaks_server /app/peaks_server
COPY --from=builder /build/drogon_server/build/lehra_server /app/lehra_server

# Copy application source
COPY . /app/
COPY drogon_server/config.json /app/config.json

# Make startup script executable
RUN chmod +x /app/startup.sh

# ── Security: Run as non-root user ───────────────────────────────────────────
# Principle of least privilege — neither Drogon nor the C++ sidecar run as root.
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

# Pre-create writable directories with correct ownership
RUN mkdir -p /app/audio_cache /app/uploads/stems /app/assets && \
    chown -R appuser:appuser /app/audio_cache /app/uploads

USER appuser

# Expose port (will be overridden by $PORT on Render/Railway)
EXPOSE 3000

# Run the application via startup script
CMD ["/app/startup.sh"]
