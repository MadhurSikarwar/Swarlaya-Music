import pathlib

phase2_code = """
// ============================================================
// NOTATION STUDIO - INPUT & INTERACTION (PHASE 2)
// ============================================================

// --- Palette Datasets ---
const PALETTE_DATA = {
  tabla: {
    en: ['Dha', 'Dhin', 'Dhun', 'Tin', 'Ta', 'Na', 'Ge', 'Ke', 'Kat', 'Tit', 'Tirakita', 'Tete', 'Dhage', 'Dhere Dhere', 'Trkt', 'Tun', 'Ti', 'Ra', 'Ki', 'Ta', '-'],
    hi: ['धा', 'धिन', 'धुन', 'तिन', 'ता', 'ना', 'गे', 'के', 'कत', 'टिट', 'तिरकिट', 'टेटे', 'धागे', 'धेरे धेरे', 'त्रक्ट', 'तुन', 'ती', 'र', 'की', 'टा', '-']
  },
  vocal: {
    en: ['Sa', 'Re', 'Ga', 'Ma', 'Pa', 'Dha', 'Ni', 'S', 'R', 'G', 'M', 'P', 'D', 'N', '-'],
    hi: ['सा', 'रे', 'ग', 'म', 'प', 'ध', 'नि', '-']
  }
};

// Track active focus
notationState.activeCell = { lineIndex: 0, matraIndex: 0 };

function renderPalette() {
  const paletteGrid = document.getElementById('paletteGrid');
  if (!paletteGrid) return;
  paletteGrid.innerHTML = '';
  
  const items = PALETTE_DATA[notationState.mode][notationState.language] || [];
  
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.textContent = item;
    
    el.addEventListener('click', () => {
      insertIntoActiveCell(item);
    });
    
    paletteGrid.appendChild(el);
  });
}

function insertIntoActiveCell(text) {
  const { lineIndex, matraIndex } = notationState.activeCell;
  if (lineIndex < notationState.lines.length && matraIndex < notationState.lines[lineIndex].length) {
    let currentContent = notationState.lines[lineIndex][matraIndex].content;
    
    // If it's a dash (empty), replace it. Else append with space
    if (currentContent === '-' || currentContent.trim() === '') {
      notationState.lines[lineIndex][matraIndex].content = text;
    } else {
      notationState.lines[lineIndex][matraIndex].content += ' ' + text;
    }
    
    // Re-render the grid to show the inserted text
    renderNotationGrid();
  }
}

// Wrap renderNotationGrid to inject focus highlighting logic
const originalRenderNotationGrid = renderNotationGrid;
renderNotationGrid = function() {
  originalRenderNotationGrid();
  
  const gridContainer = document.getElementById('nsGrid');
  if(!gridContainer) return;
  
  const rows = gridContainer.querySelectorAll('.grid-row');
  rows.forEach((row, lIdx) => {
    let mIdx = 0;
    const vibhags = row.querySelectorAll('.grid-vibhag');
    vibhags.forEach(vibhag => {
      const cells = vibhag.querySelectorAll('.grid-cell');
      cells.forEach(cell => {
        const contentEl = cell.querySelector('.cell-content');
        
        // Restore focus visual if this is the active cell
        if (notationState.activeCell.lineIndex === lIdx && notationState.activeCell.matraIndex === mIdx) {
          contentEl.style.background = 'rgba(245,166,35,0.15)';
          contentEl.style.border = '1px dashed var(--gold)';
        }
        
        const capturedLIdx = lIdx;
        const capturedMIdx = mIdx;
        
        // Add focus listener without re-rendering
        contentEl.addEventListener('focus', () => {
          // Clear all
          document.querySelectorAll('.grid-cell .cell-content').forEach(el => {
            el.style.background = ''; 
            el.style.border = '';
          });
          // Highlight current
          contentEl.style.background = 'rgba(245,166,35,0.15)';
          contentEl.style.border = '1px dashed var(--gold)';
          
          notationState.activeCell = { lineIndex: capturedLIdx, matraIndex: capturedMIdx };
        });
        
        mIdx++;
      });
    });
  });
};

// Hook into toggles
const originalInit = initNotationStudio;
initNotationStudio = function() {
  originalInit();
  renderPalette();
  
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
       // Timeout ensures state is updated by the original listener first
       setTimeout(renderPalette, 10);
    });
  });
};
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\notation.js')
content = target.read_text(encoding='utf-8')

# Remove any bad previous attempt if it exists
if "NOTATION STUDIO - INPUT & INTERACTION (PHASE 2)" in content:
    idx = content.find("// ============================================================\n// NOTATION STUDIO - INPUT & INTERACTION (PHASE 2)")
    content = content[:idx]

target.write_text(content + "\n" + phase2_code, encoding='utf-8')
print("Appended Phase 2 logic cleanly.")
