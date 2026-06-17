"""
Lehra Studio — Python Flask Backend Server
==========================================
Serves the webapp and handles server-side pitch shifting using librosa.
This completely eliminates the buzzing caused by browser-side phase vocoders (Tone.js PitchShift).

Architecture:
  - All pitch shifting is done server-side using librosa (PSOLA-based, artifact-free)
  - The browser plays audio at playbackRate=1.0 (or close to it for tempo)
  - No Tone.js, no Web Audio PitchShift nodes on the client
  - Cached pitch-shifted files are stored in audio_cache/

Audio flow:
  1. Client picks raag + scale (Hz)
  2. GET /api/audio?file=<name>&hz=<pitchHz>
  3. Server reads .aac from ../assets/
  4. If pitch == D (146.83 Hz), returns original (no processing)
  5. Otherwise, loads with librosa, pitch-shifts, writes to cache as WAV
  6. Returns WAV with correct Content-Type and CORS headers
  7. Client decodes once and uses AudioBufferSourceNode at playbackRate for tempo only
"""

import os
import hashlib
import pathlib
import logging
import math
import threading
import time
import numpy as np
import librosa
import soundfile as sf
from flask import Flask, send_file, request, jsonify, send_from_directory, Response

# ── Paths ───────────────────────────────────────────────────────
BASE_DIR   = pathlib.Path(__file__).parent.resolve()   # .../webapp/
ASSETS_DIR = BASE_DIR / 'assets'                       # .../webapp/assets/
CACHE_DIR  = BASE_DIR / 'audio_cache'                 # .../webapp/audio_cache/
CACHE_DIR.mkdir(exist_ok=True)

# ── Constants ───────────────────────────────────────────────────
BASE_HZ    = 146.83   # D — the pitch all recordings were made at
SAMPLE_RATE = 44100

# (FFmpeg is required in system PATH for librosa/audioread to decode AAC files)
# In Docker, this is installed via `apt-get install ffmpeg`.

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__, static_folder=None)

# ── Pitch Processing ─────────────────────────────────────────────
def get_cache_path(filename: str, pitch_hz: float, start: float, end: float, stretch: float) -> pathlib.Path:
    """Generate a deterministic cache file path for a given file+pitch+loop combo."""
    key = f"{filename}|{pitch_hz:.6f}|{start:.3f}|{end:.3f}|{stretch:.4f}"
    h = hashlib.sha256(key.encode()).hexdigest()[:12]
    safe_name = filename.replace(' ', '_').replace('/', '_')
    return CACHE_DIR / f"{safe_name}_{h}.wav"

# ── File Locking & Cache Management ─────────────────────────────
file_locks = {}
locks_lock = threading.Lock()

def get_file_lock(filepath: pathlib.Path) -> threading.Lock:
    with locks_lock:
        path_str = str(filepath)
        if path_str not in file_locks:
            file_locks[path_str] = threading.Lock()
        return file_locks[path_str]

def cleanup_cache_thread():
    """Background thread to keep audio_cache under 500MB (cleans to 400MB)."""
    while True:
        try:
            total_size = sum(f.stat().st_size for f in CACHE_DIR.glob('*.wav') if f.is_file())
            if total_size > 500 * 1024 * 1024: # 500 MB
                log.info(f"Cache size ({total_size / 1024 / 1024:.1f} MB) exceeded 500MB. Cleaning up...")
                files = sorted(CACHE_DIR.glob('*.wav'), key=lambda x: x.stat().st_atime)
                
                for f in files:
                    try:
                        sz = f.stat().st_size
                        f.unlink()
                        total_size -= sz
                        log.debug(f"Deleted cache file: {f.name}")
                        if total_size < 400 * 1024 * 1024: # 400 MB
                            break
                    except Exception as e:
                        log.warning(f"Failed to delete {f}: {e}")
                log.info(f"Cleanup finished. New size: {total_size / 1024 / 1024:.1f} MB")
        except Exception as e:
            log.error(f"Cache cleanup error: {e}", exc_info=True)
        
        time.sleep(60) # check every minute

# Start cleanup thread
threading.Thread(target=cleanup_cache_thread, daemon=True).start()



def pitch_shift_file(input_path: pathlib.Path, output_path: pathlib.Path, pitch_hz: float, start: float, end: float, stretch: float):
    """
    Extract segment, time-stretch to target tempo, and pitch-shift to the target pitch.
    """
    n_semitones = 12 * math.log2(pitch_hz / BASE_HZ)
    duration = end - start if end > 0 else None
    log.info(f"Processing {input_path.name}: start={start:.2f}s, dur={duration}, stretch={stretch:.3f}x, pitch={n_semitones:.3f} semitones")

    # Load only the required segment
    y, sr = librosa.load(str(input_path), sr=SAMPLE_RATE, mono=True, offset=start, duration=duration)

    # 1. Time Stretch (Tempo)
    if abs(stretch - 1.0) > 0.005:
        log.info(f"  -> Time stretching by {stretch:.3f}x")
        y = librosa.effects.time_stretch(y, rate=stretch)

    # 2. Pitch Shift (Scale)
    if abs(n_semitones) < 0.05:
        log.info("  -> D original, no pitch shift")
    else:
        log.info(f"  -> Pitch shifting by {n_semitones:.3f} semitones")
        y = librosa.effects.pitch_shift(
            y,
            sr=sr,
            n_steps=n_semitones,
            bins_per_octave=12,
            res_type='soxr_qq'   # lower RAM footprint for 512MB servers, soxr replaces resampy
        )

    log.info(f"  -> Processing complete, {len(y)/sr:.2f}s of audio")

    sf.write(str(output_path), y, sr, subtype='PCM_16')
    log.info(f"  -> Saved to cache: {output_path.name}")


# ── API Routes ───────────────────────────────────────────────────
@app.route('/api/audio')
def serve_audio():
    filename = request.args.get('file', '').strip()
    try:
        pitch_hz = float(request.args.get('hz', BASE_HZ))
        start = float(request.args.get('start', 0.0))
        end = float(request.args.get('end', 0.0))
        stretch = float(request.args.get('stretch', 1.0))
    except ValueError:
        return jsonify({'error': 'Invalid numerical parameter'}), 400

    if pitch_hz <= 0 or stretch <= 0:
        return jsonify({'error': 'hz and stretch must be positive'}), 400

    # Security: prevent path traversal
    if not filename or '..' in filename or '/' in filename or '\\' in filename:
        return jsonify({'error': 'Invalid filename'}), 400

    input_path = ASSETS_DIR / f"{filename}.aac"
    if not input_path.exists():
        log.warning(f"Audio file not found: {input_path}")
        return jsonify({'error': f'File not found: {filename}'}), 404

    cache_path = get_cache_path(filename, pitch_hz, start, end, stretch)

    lock = get_file_lock(cache_path)
    with lock:
        # Recovery check: if file exists but is corrupted (e.g. 0 bytes), remove it
        if cache_path.exists() and cache_path.stat().st_size < 1000:
            log.warning(f"Corrupted cache file found (size < 1000 bytes): {cache_path}. Deleting.")
            cache_path.unlink()

        if not cache_path.exists():
            try:
                pitch_shift_file(input_path, cache_path, pitch_hz, start, end, stretch)
            except Exception as e:
                log.error(f"Pitch shift failed: {e}", exc_info=True)
                return jsonify({'error': 'Audio processing failed', 'detail': str(e)}), 500

    response = send_file(cache_path, mimetype='audio/wav')
    response.headers['Cache-Control'] = 'public, max-age=86400'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@app.route('/api/tanpura')
def serve_tanpura():
    try:
        pitch_hz = float(request.args.get('hz', BASE_HZ))
    except ValueError:
        return jsonify({'error': 'Invalid numerical parameter'}), 400

    if pitch_hz <= 0:
        return jsonify({'error': 'hz must be positive'}), 400

    input_path = ASSETS_DIR / "tanpura_06_01.wav"
    if not input_path.exists():
        log.warning(f"Tanpura file not found: {input_path}")
        return jsonify({'error': 'Tanpura file not found'}), 404

    n_semitones = 12 * math.log2(pitch_hz / BASE_HZ)
    
    # If practically no pitch shift needed, return the original file
    if abs(n_semitones) < 0.05:
        response = send_file(input_path, mimetype='audio/wav')
        response.headers['Cache-Control'] = 'public, max-age=86400'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    cache_path = get_cache_path("tanpura_06_01", pitch_hz, 0.0, 0.0, 1.0)
    lock = get_file_lock(cache_path)

    with lock:
        if cache_path.exists() and cache_path.stat().st_size < 1000:
            log.warning(f"Corrupted tanpura cache file found: {cache_path}. Deleting.")
            cache_path.unlink()

        if not cache_path.exists():
            try:
                log.info(f"Processing tanpura: pitch={n_semitones:.3f} semitones")
                y, sr = librosa.load(str(input_path), sr=SAMPLE_RATE, mono=True)
                y = librosa.effects.pitch_shift(
                    y,
                    sr=sr,
                    n_steps=n_semitones,
                    bins_per_octave=12,
                    res_type='soxr_hq'
                )
                sf.write(str(cache_path), y, sr, subtype='PCM_16')
                log.info(f"  -> Saved to cache: {cache_path.name}")
            except Exception as e:
                log.error(f"Tanpura pitch shift failed: {e}", exc_info=True)
                return jsonify({'error': 'Audio processing failed', 'detail': str(e)}), 500

    response = send_file(cache_path, mimetype='audio/wav')
    response.headers['Cache-Control'] = 'public, max-age=86400'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


@app.route('/api/status')
def status():
    return jsonify({'status': 'ok', 'base_hz': BASE_HZ, 'assets': str(ASSETS_DIR)})


# ── Static File Serving ──────────────────────────────────────────
@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(ASSETS_DIR, filename)


@app.route('/')
@app.route('/index.html')
def serve_index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    file_path = BASE_DIR / filename
    if file_path.is_file():
        return send_from_directory(BASE_DIR, filename)
    return send_from_directory(BASE_DIR, 'index.html')


# ── Run ──────────────────────────────────────────────────────────
if __name__ == '__main__':
    log.info("=" * 60)
    log.info("  Lehra Studio — Python Backend Server")
    log.info(f"  Webapp dir : {BASE_DIR}")
    log.info(f"  Assets dir : {ASSETS_DIR}")
    log.info(f"  Cache dir  : {CACHE_DIR}")
    port = int(os.environ.get('PORT', 3000))
    log.info(f"  Open: http://localhost:{port}")
    log.info("=" * 60)
    app.run(debug=False, host='0.0.0.0', port=port, threaded=True)
