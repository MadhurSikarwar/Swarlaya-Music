import pathlib

server_code = """
# ── Stem Separation Route (Mock Implementation) ───────────────────
from werkzeug.utils import secure_filename
import shutil

UPLOAD_FOLDER = BASE_DIR / 'uploads'
UPLOAD_FOLDER.mkdir(exist_ok=True)
STEMS_FOLDER = BASE_DIR / 'audio_cache' / 'stems'
STEMS_FOLDER.mkdir(parents=True, exist_ok=True)

@app.route('/api/separate', methods=['POST'])
def separate_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file part'}), 400
        
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    filename = secure_filename(file.filename)
    file_path = UPLOAD_FOLDER / filename
    file.save(str(file_path))
    
    # Generate unique output dir name
    file_hash = hashlib.md5(file_path.read_bytes()).hexdigest()[:8]
    out_dir_name = f"{filename}_{file_hash}"
    out_path = STEMS_FOLDER / out_dir_name
    out_path.mkdir(parents=True, exist_ok=True)
    
    # MOCK IMPLEMENTATION:
    # Since running Spleeter/Demucs requires heavy GPU/RAM and specific Python versions
    # not available on Render free tier, we will mock the separation by just copying
    # the original file to simulate 4 stems.
    log.info(f"Mock separating stems for {filename}...")
    
    try:
        shutil.copy(file_path, out_path / "vocals.wav")
        shutil.copy(file_path, out_path / "drums.wav")
        shutil.copy(file_path, out_path / "bass.wav")
        shutil.copy(file_path, out_path / "other.wav")
    except Exception as e:
        log.error(f"Mock separation error: {e}", exc_info=True)
        return jsonify({'error': 'Stem separation failed', 'detail': str(e)}), 500
            
    # Map the output files to URLs
    stems = {
        'vocals': f"/api/stems/{out_dir_name}/vocals.wav",
        'drums': f"/api/stems/{out_dir_name}/drums.wav",
        'bass': f"/api/stems/{out_dir_name}/bass.wav",
        'other': f"/api/stems/{out_dir_name}/other.wav"
    }
    
    return jsonify({'stems': stems})

@app.route('/api/stems/<path:filename>')
def serve_stems(filename):
    return send_from_directory(STEMS_FOLDER, filename)
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\server.py')
content = target.read_text(encoding='utf-8')

# Only insert if we haven't already inserted
if "Stem Separation Route" not in content:
    insert_idx = content.rfind("if __name__ == '__main__':")
    if insert_idx != -1:
        new_content = content[:insert_idx] + server_code + "\n" + content[insert_idx:]
        target.write_text(new_content, encoding='utf-8')
        print("Injected mock stem separation route into server.py")
    else:
        print("Could not find __main__ block in server.py")
else:
    print("Route already exists.")
