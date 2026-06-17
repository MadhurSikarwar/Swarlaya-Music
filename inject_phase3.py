import pathlib
import json

phase3_js = """
// ============================================================
// NOTATION STUDIO - ADVANCED ENGINE & UX (PHASE 3)
// ============================================================

// --- History Engine (Undo / Redo) ---
let historyStack = [];
let historyIndex = -1;

function saveHistory() {
  // Deep copy lines state
  const stateCopy = JSON.parse(JSON.stringify(notationState.lines));
  
  // If we are not at the end of the stack, truncate the future
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  
  historyStack.push(stateCopy);
  historyIndex++;
  
  // Cap at 50 states
  if (historyStack.length > 50) {
    historyStack.shift();
    historyIndex--;
  }
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    notationState.lines = JSON.parse(JSON.stringify(historyStack[historyIndex]));
    renderNotationGrid();
  }
}

function redo() {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;
    notationState.lines = JSON.parse(JSON.stringify(historyStack[historyIndex]));
    renderNotationGrid();
  }
}

// --- Formatting Engine ---
const FORMAT_OPTS = [
  { id: 'underline', label: 'U', title: 'Underline (Komal / Double Speed)', icon: '<u>R</u>' },
  { id: 'dot-below', label: 'D', title: 'Mandra Saptak (Dot Below)', icon: 'Ṣ' },
  { id: 'dot-above', label: 'T', title: 'Taar Saptak (Dot Above)', icon: 'Ṡ' },
  { id: 'vertical',  label: 'V', title: 'Tivra (Vertical Line)', icon: 'M|' },
  { id: 'clear',     label: 'C', title: 'Clear Format', icon: '⨂' }
];

function renderFormatToolbar() {
  const container = document.getElementById('nsFormatGroup');
  if (!container) return;
  container.innerHTML = '';
  
  FORMAT_OPTS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'header-icon-btn format-btn';
    btn.innerHTML = opt.icon;
    btn.title = opt.title;
    
    btn.addEventListener('click', () => {
      const { lineIndex, matraIndex } = notationState.activeCell;
      if (lineIndex < notationState.lines.length && matraIndex < notationState.lines[lineIndex].length) {
        if (opt.id === 'clear') {
          notationState.lines[lineIndex][matraIndex].modifier = null;
        } else {
          notationState.lines[lineIndex][matraIndex].modifier = opt.id;
        }
        saveHistory();
        renderNotationGrid();
      }
    });
    container.appendChild(btn);
  });
}

// --- Export Engine ---
function setupExport() {
  document.getElementById('nsExportBtn')?.addEventListener('click', () => {
    const element = document.getElementById('nsDocument');
    const title = document.getElementById('nsTitle').value || 'Composition';
    
    // Quick cleanup for PDF look
    element.style.background = '#fff';
    element.style.color = '#000';
    document.querySelectorAll('.cell-content').forEach(c => c.style.color = '#000');
    document.querySelectorAll('.tali-khali').forEach(c => c.style.color = '#000');
    document.querySelectorAll('.doc-title-input').forEach(c => {
       c.style.color = '#000';
       c.style.border = 'none';
    });
    document.querySelectorAll('.grid-cell').forEach(c => c.style.borderColor = '#ccc');
    document.querySelectorAll('.grid-vibhag').forEach(c => c.style.borderColor = '#000');
    document.querySelectorAll('.grid-row').forEach(c => c.style.borderColor = '#000');
    
    if (typeof html2pdf !== 'undefined') {
        html2pdf().from(element).save(title + '.pdf').then(() => {
          // Restore dark theme inline styles
          element.style.background = '';
          element.style.color = '';
          document.querySelectorAll('.cell-content').forEach(c => c.style.color = '');
          document.querySelectorAll('.tali-khali').forEach(c => c.style.color = '');
          document.querySelectorAll('.doc-title-input').forEach(c => {
             c.style.color = '';
             c.style.border = '';
          });
          document.querySelectorAll('.grid-cell').forEach(c => c.style.borderColor = '');
          document.querySelectorAll('.grid-vibhag').forEach(c => c.style.borderColor = '');
          document.querySelectorAll('.grid-row').forEach(c => c.style.borderColor = '');
        });
    } else {
        alert("html2pdf library is not loaded. Ensure you have internet connection.");
    }
  });
}

// Hook into initializers
const initP2 = initNotationStudio;
initNotationStudio = function() {
  initP2();
  renderFormatToolbar();
  setupExport();
  
  // Wire undo/redo
  document.getElementById('nsUndo')?.addEventListener('click', undo);
  document.getElementById('nsRedo')?.addEventListener('click', redo);
  
  // Save initial state
  saveHistory();
};

// Wrap the insert logic to save history
const origInsert = insertIntoActiveCell;
insertIntoActiveCell = function(text) {
  origInsert(text);
  saveHistory();
};
"""

phase3_css = """
.mod-dot-above {
  position: relative;
}
.mod-dot-above::before {
  content: '.';
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  font-weight: bold;
}
.mod-vertical {
  position: relative;
}
.mod-vertical::after {
  content: '|';
  position: absolute;
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.2rem;
  font-weight: 300;
}
"""

js_target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\notation.js')
css_target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\style.css')

# Inject JS
js_content = js_target.read_text(encoding='utf-8')
if "NOTATION STUDIO - ADVANCED ENGINE & UX (PHASE 3)" not in js_content:
    js_target.write_text(js_content + "\n" + phase3_js, encoding='utf-8')
    print("Injected Phase 3 JS.")
else:
    print("Phase 3 JS already present.")

# Inject CSS
css_content = css_target.read_text(encoding='utf-8')
if ".mod-dot-above" not in css_content:
    css_target.write_text(css_content + "\n" + phase3_css, encoding='utf-8')
    print("Injected Phase 3 CSS.")
else:
    print("Phase 3 CSS already present.")
