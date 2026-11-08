# The Audio Lab service. Build from the webapp/ folder:
#   docker build -f audio_lab/Dockerfile -t swaralaya-audio .
#   docker run -p 8100:8100 swaralaya-audio
# Add reference matching and drum separation with build arguments:
#   --build-arg WITH_MATCHERING=1   --build-arg WITH_DEMUCS=1   (Demucs adds PyTorch: a large image)
FROM python:3.12-slim

ARG WITH_MATCHERING=0
ARG WITH_DEMUCS=0

# ffmpeg (with libx264 and libmp3lame), and fonts for titles: DejaVu as a fallback and Lohit for Devanagari
# (Cinzel, the site's heading font, ships in audio_lab/fonts)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 fonts-dejavu-core fonts-lohit-deva \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY audio_lab/requirements.txt /srv/audio_lab/requirements.txt
RUN pip install --no-cache-dir -r audio_lab/requirements.txt \
    && if [ "$WITH_MATCHERING" = "1" ]; then pip install --no-cache-dir "matchering>=2.0.6"; fi \
    && if [ "$WITH_DEMUCS" = "1" ]; then \
         pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
         && pip install --no-cache-dir demucs==4.0.1; \
       fi

COPY audio_lab/ /srv/audio_lab/
# The site's tanpura recording, for the optional tanpura bed
COPY assets/tanpura_06_01.wav /srv/assets/tanpura_06_01.wav
ENV AUDIO_LAB_TANPURA=/srv/assets/tanpura_06_01.wav

# Uploads and results live here and are deleted after AUDIO_LAB_TTL_HOURS (24 by default)
ENV AUDIO_LAB_DATA=/data
RUN useradd -m -u 1001 appuser && mkdir -p /data && chown -R appuser:appuser /data /srv
USER appuser
VOLUME ["/data"]

EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/api/master/health').status==200 else 1)"
CMD ["python", "-m", "uvicorn", "audio_lab.server:app", "--host", "0.0.0.0", "--port", "8100"]
