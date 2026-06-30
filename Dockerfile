# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Compile the C++ sidecar with full build toolchain.
# This stage is discarded after build — dev tools NEVER appear in the runtime image.
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    libsoundtouch-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy only the C++ sidecar source files needed for compilation
COPY cpp_sidecar/ ./cpp_sidecar/

# Build the sidecar binary — statically link soundtouch where possible
RUN g++ -O3 -std=c++17 -pthread cpp_sidecar/main.cpp -lsoundtouch -o peaks_server


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean production image — no build tools, smaller attack surface, smaller size.
FROM python:3.11-slim AS runtime

# Install only runtime dependencies (ffmpeg for audio decode, libsndfile for soundfile,
# libsoundtouch runtime lib for the compiled sidecar binary)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libsoundtouch1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies before copying app code (better layer caching)
COPY requirements.txt /app/
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy compiled sidecar binary from builder stage
COPY --from=builder /build/peaks_server /app/peaks_server

# Copy application source
COPY . /app/

# Copy and make startup script executable
RUN chmod +x /app/startup.sh

# ── Security: Run as non-root user ───────────────────────────────────────────
# Principle of least privilege — neither Flask nor the C++ sidecar should run as root.
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

# Pre-create writable directories with correct ownership
RUN mkdir -p /app/audio_cache /app/uploads && \
    chown -R appuser:appuser /app/audio_cache /app/uploads

USER appuser

# Expose port (will be overridden by $PORT on Render/Railway)
EXPOSE 3000

# Run the application with Gunicorn via startup script
CMD ["/app/startup.sh"]
