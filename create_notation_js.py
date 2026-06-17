import pathlib

js_code = """
// ============================================================
// NOTATION STUDIO - CORE ENGINE (PHASE 1)
// ============================================================

// 1. Global State
let notationState = {
  mode: 'tabla', // 'tabla' or 'vocal'
  system: 'bhatkhande', // 'bhatkhande' or 'paluskar'
  language: 'en', // 'en' or 'hi'
  taal: '16', // default Teentaal
  lines: [
    // Array of lines. Each line is an array of matras.
    // We start with 1 empty line of 16 matras
    Array.from({length: 16}, (_, i) => ({ matra: i + 1, content: '', modifier: null }))
  ]
};

// 2. Taal Configurations
const TAAL_CONFIG = {
  '16': { name: 'Teentaal', matras: 16, vibhags: [4, 4, 4, 4], taliKhali: ['X', '2', '0', '3'] },
  '12': { name: 'Ektaal', matras: 12, vibhags: [2, 2, 2, 2, 2, 2], taliKhali: ['X', '0', '2', '0', '3', '4'] },
  '10': { name: 'Jhaptaal', matras: 10, vibhags: [2, 3, 2, 3], taliKhali: ['X', '2', '0', '3'] },
  '8': { name: 'Keharwa', matras: 8, vibhags: [4, 4], taliKhali: ['X', '0'] },
  '7': { name: 'Rupak', matras: 7, vibhags: [3, 2, 2], taliKhali: ['0', '1', '2'] }, // Rupak starts with Khali
  '6': { name: 'Dadra', matras: 6, vibhags: [3, 3], taliKhali: ['X', '0'] },
  '14': { name: 'Dhamar', matras: 14, vibhags: [5, 2, 3, 4], taliKhali: ['X', '2', '0', '3'] },
  '14_deep': { name: 'Deepchandi', matras: 14, vibhags: [3, 4, 3, 4], taliKhali: ['X', '2', '0', '3'] }
};

// 3. Rendering Engine
function renderNotationGrid() {
  const gridContainer = document.getElementById('nsGrid');
  if (!gridContainer) return;
  gridContainer.innerHTML = ''; // Clear current

  const config = TAAL_CONFIG[notationState.taal];
  
  notationState.lines.forEach((line, lineIndex) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'grid-row';
    
    let matraCounter = 0;
    
    // Iterate through vibhags
    config.vibhags.forEach((vibhagSize, vIndex) => {
      const vibhagEl = document.createElement('div');
      vibhagEl.className = 'grid-vibhag';
      
      for (let i = 0; i < vibhagSize; i++) {
        const matraData = line[matraCounter];
        const isFirstOfVibhag = (i === 0);
        const taliKhaliMarker = isFirstOfVibhag ? config.taliKhali[vIndex] : '';
        
        const cellEl = document.createElement('div');
        cellEl.className = 'grid-cell';
        
        // Tali/Khali Marker (only on the first line to avoid clutter, or always. Let's do always for now)
        if (taliKhaliMarker) {
          const tkEl = document.createElement('div');
          tkEl.className = 'tali-khali';
          tkEl.textContent = taliKhaliMarker;
          cellEl.appendChild(tkEl);
        }
        
        // Matra Number
        const numEl = document.createElement('div');
        numEl.className = 'matra-num';
        numEl.textContent = (matraCounter + 1).toString();
        cellEl.appendChild(numEl);
        
        // Content Input (contenteditable)
        const contentEl = document.createElement('div');
        contentEl.className = 'cell-content';
        if (matraData && matraData.modifier) {
            contentEl.classList.add(`mod-${matraData.modifier}`);
        }
        contentEl.contentEditable = true;
        contentEl.textContent = matraData ? matraData.content : '-';
        
        // Save state on input
        contentEl.addEventListener('input', (e) => {
          notationState.lines[lineIndex][matraCounter].content = e.target.textContent;
        });
        
        cellEl.appendChild(contentEl);
        vibhagEl.appendChild(cellEl);
        matraCounter++;
      }
      rowEl.appendChild(vibhagEl);
    });
    
    gridContainer.appendChild(rowEl);
  });
}

// 4. Initialization & Listeners
function initNotationStudio() {
  renderNotationGrid();
  
  // Topbar Toggles
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const group = e.target.closest('.toggle-group');
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      const val = e.target.getAttribute('data-val');
      if (group.id === 'modeToggle') notationState.mode = val;
      if (group.id === 'systemToggle') notationState.system = val;
      if (group.id === 'langToggle') notationState.language = val;
      
      // We will re-render palettes in Phase 2 based on mode and language
      console.log('State updated:', notationState);
    });
  });
  
  // Taal Selector
  document.getElementById('nsTaal')?.addEventListener('change', (e) => {
    const newTaal = e.target.value;
    const config = TAAL_CONFIG[newTaal];
    notationState.taal = newTaal;
    // Reset lines to match new taal size
    notationState.lines = [
      Array.from({length: config.matras}, (_, i) => ({ matra: i + 1, content: '-', modifier: null }))
    ];
    renderNotationGrid();
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initNotationStudio);
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\notation.js')
target.write_text(js_code, encoding='utf-8')
print("Created notation.js")
