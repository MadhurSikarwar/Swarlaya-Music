import pathlib

server_code = """

# ── Stem Separation Route ─────────────────────────────────────────
import subprocess
from werkzeug.utils import secure_filename

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
    
    # We expect 4 stems: vocals, drums, bass, other
    if not out_path.exists():
        log.info(f"Separating stems for {filename} into {out_path}...")
        try:
            # Run spleeter CLI. Will use pretrained 4stems model.
            subprocess.run([
                "spleeter", "separate",
                "-p", "spleeter:4stems",
                "-o", str(STEMS_FOLDER),
                str(file_path)
            ], check=True)
            
            # Spleeter creates a folder with the filename (without extension)
            base_name = file_path.stem
            spleeter_out = STEMS_FOLDER / base_name
            if spleeter_out.exists():
                spleeter_out.rename(out_path)
                
        except Exception as e:
            log.error(f"Spleeter error: {e}", exc_info=True)
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

# We need to insert the route before the `if __name__ == '__main__':` block.
insert_idx = content.rfind("if __name__ == '__main__':")
if insert_idx != -1:
    new_content = content[:insert_idx] + server_code + "\n" + content[insert_idx:]
    target.write_text(new_content, encoding='utf-8')
    print("Injected stem separation route into server.py")
else:
    print("Could not find __main__ block in server.py")
