# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Builds Drogon (from source) and the Lehra Studio server. This stage is
# discarded after the build.
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    cmake \
    make \
    git \
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

# ── Build Drogon from source (pinned to stable v1.9.6) ───────────────────────
# Drogon is not in Debian's official repos, so we must build it ourselves.
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

# ── Build the Lehra Studio server ────────────────────────────────────────────
COPY drogon_server/ ./drogon_server/
RUN cd drogon_server && mkdir -p build && cd build \
    && cmake .. -DCMAKE_BUILD_TYPE=Release \
    && make -j$(nproc)


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean production image — only runtime .so files, no compilers or headers.
FROM python:3.11-slim AS runtime

# ffmpeg: Demucs decodes uploads with it. The rest are Drogon's shared
# libraries (standard Debian packages, no versioned names).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libjsoncpp-dev \
    libssl-dev \
    zlib1g-dev \
    libbrotli-dev \
    libsqlite3-0 \
    libc-ares2 \
    libuuid1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python only runs Demucs, on the CPU — install the CPU-only PyTorch build
# first (the default CUDA wheels add several GB to the image for nothing).
RUN pip install --upgrade pip && \
    pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 \
        --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Server binary and the Drogon shared libraries it links against
COPY --from=builder /build/drogon_server/build/lehra_server /app/lehra_server
COPY --from=builder /usr/local/lib/libdrogon.so* /usr/local/lib/
COPY --from=builder /usr/local/lib/libtrantor.so* /usr/local/lib/
RUN ldconfig

# Only what the server serves (see StaticController) plus its config
COPY index.html sw.js manifest.json favicon.ico robots.txt /app/
COPY public/ /app/public/
COPY assets/ /app/assets/
COPY drogon_server/config.json /app/config.json

# ── Security: run as a non-root user ─────────────────────────────────────────
RUN useradd -m -u 1001 appuser && \
    mkdir -p /app/uploads/stems && \
    chown -R appuser:appuser /app

USER appuser

# Port is overridden by $PORT on Render
EXPOSE 3000

CMD ["/app/lehra_server"]
