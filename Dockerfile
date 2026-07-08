# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Builds SoundTouch (static) and Drogon (from source), then compiles the C++ sidecar
# and Drogon backend. This stage is discarded after build.
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    cmake \
    make \
    git \
    wget \
    pkg-config \
    libjsoncpp-dev \
    uuid-dev \
    libssl-dev \
    zlib1g-dev \
    libbrotli-dev \
    libsqlite3-dev \
    libc-ares-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# ── Build SoundTouch from source (static library) ────────────────────────────
RUN wget -q https://codeberg.org/soundtouch/soundtouch/archive/2.3.2.tar.gz -O soundtouch.tar.gz \
    && tar -xzf soundtouch.tar.gz \
    && cd soundtouch \
    && mkdir build_st && cd build_st \
    && cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    && make -j$(nproc) \
    && make install \
    && cd /build \
    && rm -rf soundtouch soundtouch.tar.gz

# ── Build Drogon from source (pinned to stable v1.9.6) ───────────────────────
# Drogon is not in Debian's official repos, so we must build it ourselves.
# Pin to v1.9.6 — stable tag that matches the sync HttpClient API used in this project.
RUN git clone --branch v1.9.6 --depth=1 --recurse-submodules \
        https://github.com/drogonframework/drogon.git /build/drogon_src \
    && cd /build/drogon_src \
    && mkdir build && cd build \
    && cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_EXAMPLES=OFF \
        -DBUILD_CTL=OFF \
    && make -j$(nproc) \
    && make install \
    && rm -rf /build/drogon_src

# ── Build the C++ sidecar ─────────────────────────────────────────────────────
COPY cpp_sidecar/ ./cpp_sidecar/

RUN g++ -O3 -std=c++17 -pthread \
    -I/usr/local/include/soundtouch \
    -I/usr/local/include \
    cpp_sidecar/main.cpp \
    /usr/local/lib/libSoundTouch.a \
    -o peaks_server

# ── Build Drogon application server ──────────────────────────────────────────
COPY drogon_server/ ./drogon_server/
RUN cd drogon_server && mkdir -p build && cd build \
    && cmake .. -DCMAKE_BUILD_TYPE=Release \
    && make


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean production image — only runtime .so files, no compilers or headers.
FROM python:3.11-slim AS runtime

# Install only runtime shared libraries (standard Debian packages, no versioned names)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    libsndfile1 \
    libjsoncpp-dev \
    libssl-dev \
    zlib1g-dev \
    libbrotli-dev \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies before copying app code (better layer caching)
COPY requirements.txt /app/
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy compiled C++ binaries from builder stage
COPY --from=builder /build/peaks_server /app/peaks_server
COPY --from=builder /build/drogon_server/build/lehra_server /app/lehra_server

# Copy Drogon shared libraries from builder (since they're not in Debian repos)
COPY --from=builder /usr/local/lib/libdrogon.so* /usr/local/lib/
COPY --from=builder /usr/local/lib/libtrantor.so* /usr/local/lib/
RUN ldconfig

# Copy application source
COPY . /app/
COPY drogon_server/config.json /app/config.json

# Make startup script executable
RUN chmod +x /app/startup.sh

# ── Security: Run as non-root user ───────────────────────────────────────────
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

# Pre-create writable directories with correct ownership
RUN mkdir -p /app/audio_cache /app/uploads/stems /app/assets && \
    chown -R appuser:appuser /app/audio_cache /app/uploads

USER appuser

# Expose port (will be overridden by $PORT on Render)
EXPOSE 3000

# Run the application via startup script
CMD ["/app/startup.sh"]
