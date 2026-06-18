import pathlib

missing_code = """
    document.querySelectorAll('.app-view').forEach(v => {
      v.style.display = 'none';
      v.classList.remove('active-view');
    });
    
    const target = e.target.getAttribute('data-target');
    e.target.classList.add('active');
    const view = document.getElementById(target);
    if(view) {
        view.style.display = '';
        view.classList.add('active-view');
    }
  });
});

// ── Stem Separator Logic ──
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\app.js')
content = target.read_text(encoding='utf-8')

search_str = "document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));"
idx = content.find(search_str)

if idx != -1:
    insert_pos = idx + len(search_str)
    # Check if we already inserted it
    if "// ── Stem Separator Logic ──" not in content[insert_pos:insert_pos+500]:
        new_content = content[:insert_pos] + missing_code + content[insert_pos:]
        target.write_text(new_content, encoding='utf-8')
        print("Restored navigation logic.")
    else:
        print("Logic already exists.")
else:
    print("Could not find search string in app.js")
