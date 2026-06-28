FROM python:3.11-slim

# Install ffmpeg and libsndfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . /app/
RUN chmod +x /app/startup.sh

# Expose port (will be overridden by $PORT on Render/Railway)
EXPOSE 3000

# Run the application with Gunicorn via startup script
CMD ["/app/startup.sh"]
