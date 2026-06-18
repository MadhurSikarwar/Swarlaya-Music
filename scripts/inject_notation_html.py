import pathlib

new_html = """
    <!-- NOTATION EDITOR VIEW -->
    <div id="view-notation" class="app-view" style="display: none;">
      <section class="notation-card studio-layout">
        
        <!-- Sidebar Palette -->
        <aside class="studio-sidebar">
          <div class="sidebar-header">
            <h3 class="sidebar-title">Palette</h3>
            <input type="text" class="palette-search" placeholder="Search..." id="paletteSearch">
          </div>
          <div class="palette-grid" id="paletteGrid">
            <!-- Populated dynamically based on Mode & Lang -->
          </div>
        </aside>

        <!-- Main Workspace -->
        <main class="studio-workspace">
          
          <!-- Top Control Bar -->
          <div class="studio-topbar">
            <div class="studio-toggles">
              <div class="toggle-group" id="modeToggle">
                <button class="toggle-btn active" data-val="tabla">Tabla</button>
                <button class="toggle-btn" data-val="vocal">Vocal</button>
              </div>
              <div class="toggle-group" id="systemToggle">
                <button class="toggle-btn active" data-val="bhatkhande">Bhatkhande</button>
                <button class="toggle-btn" data-val="paluskar">Paluskar</button>
              </div>
              <div class="toggle-group" id="langToggle">
                <button class="toggle-btn active" data-val="en">English</button>
                <button class="toggle-btn" data-val="hi">हिंदी</button>
              </div>
            </div>
            
            <div class="studio-actions">
              <button class="header-icon-btn" id="nsUndo" title="Undo"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button>
              <button class="header-icon-btn" id="nsRedo" title="Redo"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg></button>
              <button class="header-icon-btn" id="nsPlayBtn" style="color: var(--gold); border-color: var(--gold);">PLAY</button>
              <button class="header-icon-btn" id="nsExportBtn">PDF / PNG</button>
            </div>
          </div>

          <!-- Formatting Toolbar -->
          <div class="notation-toolbar">
            <select id="nsTaal" class="pitch-select">
              <option value="16">Teentaal (16)</option>
              <option value="12">Ektaal (12)</option>
              <option value="10">Jhaptaal (10)</option>
              <option value="8">Keharwa (8)</option>
              <option value="7">Rupak (7)</option>
              <option value="6">Dadra (6)</option>
              <option value="14">Dhamar (14)</option>
              <option value="14_deep">Deepchandi (14)</option>
            </select>
            <select id="nsTemplate" class="pitch-select">
              <option value="">Templates...</option>
              <option value="kaida">Kaida</option>
              <option value="rela">Rela</option>
              <option value="tukda">Tukda</option>
            </select>
            
            <div class="format-group" id="nsFormatGroup">
              <!-- Rendered contextually -->
            </div>
          </div>

          <!-- Document Area -->
          <div class="notation-document-wrapper">
            <div class="notation-document" id="nsDocument">
              <div class="doc-header">
                <input type="text" id="nsTitle" class="doc-title-input" value="Untitled Composition" placeholder="Composition Title">
              </div>
              <div class="dynamic-grid" id="nsGrid">
                <!-- Virtual DOM renders here -->
              </div>
            </div>
          </div>

        </main>
      </section>
    </div> <!-- End view-notation -->
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\index.html')
content = target.read_text(encoding='utf-8')

start_tag = '<!-- NOTATION EDITOR VIEW -->'
end_tag = '</div> <!-- End view-notation -->'

start_idx = content.find(start_tag)
if start_idx != -1:
    end_idx = content.find(end_tag, start_idx)
    if end_idx != -1:
        new_content = content[:start_idx] + new_html.strip() + "\n  " + content[end_idx + len(end_tag):]
        target.write_text(new_content, encoding='utf-8')
        print("Replaced notation view HTML.")
    else:
        print("Could not find end tag.")
else:
    print("Could not find start tag.")
