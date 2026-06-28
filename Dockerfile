# Stage 1: Build C++ sidecar
FROM python:3.11-slim as builder
RUN apt-get update && apt-get install -y --no-install-recommends g++ libsoundtouch-dev
WORKDIR /build
COPY cpp_sidecar /build/cpp_sidecar
RUN g++ -O3 -std=c++17 -pthread cpp_sidecar/main.cpp -lsoundtouch -o peaks_server

# Stage 2: Final runtime
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies (ffmpeg and libsndfile for librosa/audioread, libsoundtouch for C++ sidecar)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 mailcap libsoundtouch1 && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/peaks_server /app/cpp_sidecar/peaks_server

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Copy the rest of the application
COPY . /app/
RUN chmod +x /app/startup.sh

# Expose port (will be overridden by $PORT on Render/Railway)
EXPOSE 3000

# Run the application with Gunicorn via startup script
CMD ["/app/startup.sh"]
