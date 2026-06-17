import pathlib

new_code = """
  // -- Upload Zone Events --
  const uZone = document.getElementById('uploadZone');
  const aUpload = document.getElementById('audioUpload');
  if (uZone && aUpload) {
    uZone.addEventListener('click', () => {
      aUpload.click();
    });
    uZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uZone.style.borderColor = 'var(--gold)';
    });
    uZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      uZone.style.borderColor = '';
    });
    uZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uZone.style.borderColor = '';
      if (e.dataTransfer.files.length > 0) {
        aUpload.files = e.dataTransfer.files;
        aUpload.dispatchEvent(new Event('change'));
      }
    });
  }
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\app.js')
content = target.read_text(encoding='utf-8')

search_str = "document.getElementById('audioUpload')?.addEventListener('change', async (e) => {"
idx = content.find(search_str)

if idx != -1:
    if "uZone.addEventListener('click'" not in content:
        new_content = content[:idx] + new_code + "\n  " + content[idx:]
        target.write_text(new_content, encoding='utf-8')
        print("Injected upload zone events.")
    else:
        print("Events already exist.")
else:
    print("Could not find insertion point.")
