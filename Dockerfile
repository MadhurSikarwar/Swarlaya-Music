# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Compile the C++ sidecar and Drogon high-performance backend with full build toolchain.
# This stage is discarded after build — dev tools NEVER appear in the runtime image.
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    cmake \
    make \
    libsoundtouch-dev \
    libdrogon-dev \
    libjsoncpp-dev \
    uuid-dev \
    libssl-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy only the C++ sidecar source files needed for compilation
COPY cpp_sidecar/ ./cpp_sidecar/

# Build the sidecar binary — statically link soundtouch where possible
RUN g++ -O3 -std=c++17 -pthread cpp_sidecar/main.cpp -lsoundtouch -o peaks_server

# Copy Drogon C++ server source and build release binary
COPY drogon_server/ ./drogon_server/
RUN cd drogon_server && mkdir -p build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release && \
    make -j$(nproc)


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean production image — no build compilers, smaller attack surface, smaller size.
FROM python:3.11-slim AS runtime

# Install runtime dependencies (ffmpeg for audio decode, libsndfile for soundfile,
# shared libraries for Drogon C++ server and SoundTouch sidecar)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libsoundtouch1 \
    libjsoncpp-dev \
    uuid-dev \
    libssl-dev \
    zlib1g-dev \
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
