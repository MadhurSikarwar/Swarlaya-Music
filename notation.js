
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
document.addEventListener('DOMContentLoaded', () => initNotationStudio());


// ============================================================
// NOTATION STUDIO - INPUT & INTERACTION (PHASE 2)
// ============================================================

// --- Palette Datasets ---
const PALETTE_DATA = {
  tabla: {
    en: ['Dha', 'Dhin', 'Dhun', 'Tin', 'Ta', 'Na', 'Ge', 'Ke', 'Kat', 'Tit', 'Tirakita', 'Tete', 'Dhage', 'Dhere Dhere', 'Trkt', 'Tun', 'Ti', 'Ra', 'Ki', 'Ta', '-'],
    hi: ['धा', 'धिन', 'धुन', 'तिन', 'ता', 'ना', 'गे', 'के', 'कत', 'टिट', 'तिरकिट', 'टेटे', 'धागे', 'धेरे धेरे', 'त्रक्ट', 'तुन', 'ती', 'र', 'की', 'टा', '-', 'ऽ']
  },
  vocal: {
    en: ['Sa', 'Re', 'Ga', 'Ma', 'Pa', 'Dha', 'Ni', 'S', 'R', 'G', 'M', 'P', 'D', 'N', '-'],
    hi: ['सा', 'रे', 'ग', 'म', 'प', 'ध', 'नि', '-', 'ऽ']
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


// ============================================================
// NOTATION STUDIO - AUDIO ENGINE & PALUSKAR RENDERING (PHASE 4)
// ============================================================

// --- Paluskar Rendering Patch ---
const origRenderPhase3 = renderNotationGrid;
renderNotationGrid = function() {
  origRenderPhase3();
  
  if (notationState.system === 'paluskar') {
    const gridContainer = document.getElementById('nsGrid');
    if(gridContainer) {
      gridContainer.querySelectorAll('.tali-khali').forEach(tk => {
        let val = tk.textContent;
        if (val === 'X') val = '1';
        else if (val === '0') val = '+';
        tk.textContent = val;
      });
    }
  }
};

// --- Audio Synthesizer Engine ---
const nsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

const SWARA_FREQS = {
  'S': 261.63, // C4
  'R': 293.66, // D4
  'G': 329.63, // E4
  'M': 349.23, // F4
  'P': 392.00, // G4
  'D': 440.00, // A4
  'N': 493.88, // B4
  'Sa': 261.63,
  'Re': 293.66,
  'Ga': 329.63,
  'Ma': 349.23,
  'Pa': 392.00,
  'Dha': 440.00,
  'Ni': 493.88,
  // Hindi Swaras mapping roughly
  'सा': 261.63,
  'रे': 293.66,
  'ग': 329.63,
  'म': 349.23,
  'प': 392.00,
  'ध': 440.00,
  'नि': 493.88
};

function playTone(freq, type='sine', duration=0.4, startTime=nsAudioCtx.currentTime) {
  if (!freq) return;
  const osc = nsAudioCtx.createOscillator();
  const gain = nsAudioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  
  const attack = Math.min(0.05, duration * 0.1);
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.linearRampToValueAtTime(0.5, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  
  osc.connect(gain);
  gain.connect(nsAudioCtx.destination);
  
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playTablaHit(bol, startTime=nsAudioCtx.currentTime) {
  // Simple synthetic drums for Tabla bols based on the bol text
  let isBass = /dha|dhin|dhun|ge/i.test(bol) || /धा|धिन|धुन|गे/.test(bol);
  let isSnare = /ta|tin|na|te|ti|ki|kat|tit/i.test(bol) || /ता|तिन|ना|ते|ती|की|कत|टिट/.test(bol);
  
  if (isBass) {
     playTone(150, 'sine', 0.5, startTime); // Baya thud
  }
  if (isSnare) {
     playTone(800, 'triangle', 0.2, startTime); // Daya sharp sound
  }
}

let isPlaying = false;

function playComposition() {
  if (isPlaying) return; // Prevent multiple clicks
  isPlaying = true;
  
  if (nsAudioCtx.state === 'suspended') {
    nsAudioCtx.resume();
  }
  
  const BPM = 120;
  const matraDuration = 60 / BPM;
  let time = nsAudioCtx.currentTime + 0.1; // start slightly in the future
  
  const btn = document.getElementById('nsPlayBtn');
  if(btn) {
      btn.style.color = '#fff';
      btn.style.background = 'var(--gold)';
      btn.textContent = 'STOP';
  }

  // Flatten lines for playback
  let totalMatras = 0;
  notationState.lines.forEach((line) => {
    line.forEach(matra => {
      let content = matra.content.trim();
      if (content && content !== '-' && content !== 'ऽ') {
         // Handle multiple notes in a cell (split by space)
         let notes = content.split(' ');
         let subDuration = matraDuration / notes.length;
         
         notes.forEach((note, i) => {
            const t = time + (i * subDuration);
            if (notationState.mode === 'vocal') {
               // Vocal Mode - Try to map to pitch
               let f = SWARA_FREQS[note] || 440;
               // Apply modifiers
               if (matra.modifier === 'dot-below') f = f / 2;
               if (matra.modifier === 'dot-above') f = f * 2;
               if (matra.modifier === 'underline') f = f * 0.943; // approx flat (1 semitone down)
               if (matra.modifier === 'vertical') f = f * 1.059;  // approx sharp
               
               playTone(f, 'sine', subDuration, t);
            } else {
               // Tabla Mode
               playTablaHit(note, t);
            }
         });
      }
      time += matraDuration;
      totalMatras++;
    });
  });
  
  // Reset button when done
  setTimeout(() => {
    isPlaying = false;
    if(btn) {
        btn.style.color = 'var(--gold)';
        btn.style.background = 'transparent';
        btn.textContent = 'PLAY';
    }
  }, totalMatras * matraDuration * 1000);
}

const origInitPhase3 = initNotationStudio;
initNotationStudio = function() {
  origInitPhase3();
  
  const playBtn = document.getElementById('nsPlayBtn');
  if(playBtn) {
    // Replace old listener if any by cloning node, but we don't have one
    // Actually we never wired nsPlayBtn before!
    playBtn.addEventListener('click', () => {
       if(isPlaying) {
          // Can't reliably stop scheduled web audio easily without keeping references.
          // Let's just allow the timeout to reset the button for now.
       } else {
          playComposition();
       }
    });
  }
};

// --- Phase 5: Help, Search & Templates ---
const origInitPhase4 = initNotationStudio;
initNotationStudio = function() {
  origInitPhase4();
  
  // Palette Search
  const searchInput = document.getElementById('paletteSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('.palette-btn').forEach(btn => {
        btn.style.display = btn.textContent.toLowerCase().includes(query) ? '' : 'none';
      });
    });
  }

  // Tutorial Modal
  const helpBtn = document.getElementById('nsHelpBtn');
  const tutorialModal = document.getElementById('nsTutorialModal');
  const closeBtn = document.getElementById('nsTutorialClose');
  if (helpBtn && tutorialModal && closeBtn) {
    helpBtn.addEventListener('click', () => tutorialModal.classList.add('active'));
    closeBtn.addEventListener('click', () => tutorialModal.classList.remove('active'));
  }

    // Add Row Button
  const addRowBtn = document.getElementById('nsAddRowBtn');
  if (addRowBtn) {
    addRowBtn.addEventListener('click', () => {
      const cols = notationState.taal === '16' ? 16 : parseInt(notationState.taal) || 16;
      const newRow = Array.from({length: cols}, (_, i) => ({ matra: i + 1, content: '-', modifier: null }));
      notationState.lines.push(newRow);
      renderNotationGrid();
      saveHistory();
    });
  }

// Templates
  const templateSelect = document.getElementById('nsTemplate');
  if (templateSelect) {
    templateSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      
      let sample = [];
      const cols = parseInt(notationState.taal) || 16;
      
      if (val === 'kaida') {
        sample = ['Dha Ti Ta Dha', 'Ti Ta Dha Dha', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', 'Ta Ti Ta Ta', 'Ti Ta Ta Ta', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', 'Dha Ti Ta Dha', 'Ti Ta Dha Dha', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', 'Dha Ti Ta Dha', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', '-'];
      } else if (val === 'rela') {
        sample = ['Tirakita Dha Tirakita', 'Dha Dha Tirakita', 'Dha Ge Na Dha', 'Tirakita Dha Ge', 'Tirakita Ta Tirakita', 'Ta Ta Tirakita', 'Dha Ge Na Dha', 'Tirakita Dha Ge', 'Dha Tirakita Dha', 'Dha Tirakita Dha', 'Dha Ge Na Dha', 'Tirakita Dha Ge', 'Dha Tirakita Dha', 'Tirakita Dha Ge', 'Na Dha Ti Ta', '-'];
      } else if (val === 'tukda') {
        sample = ['Kat Ta Kat Ta', 'Dhere Dhere Kat Ta', 'Kat Ta Dhere Dhere', 'Kat Ta Kat Ta', 'Kat Ta Kat Ta', 'Dhere Dhere Kat Ta', 'Kat Ta Dhere Dhere', 'Kat Ta Kat Ta'];
      }
      
      if (notationState.mode === 'vocal') {
        sample = ['S R G M', 'P D N S', 'S N D P', 'M G R S', 'G M P D', 'N S R G', 'G R S N', 'D P M G', 'M P D N', 'S R G M', 'G R S N', 'D P M G', 'S - - -', '- - - -', '- - - -', '- - - -'];
      }
      
      notationState.lines = [];
      let totalMats = 0;
      let matrasArray = [];
      
      for(let i = 0; i < sample.length; i++) {
        matrasArray.push({ matra: (totalMats % cols) + 1, content: sample[i], modifier: null });
        totalMats++;
        if(totalMats % cols === 0 || i === sample.length - 1) {
           notationState.lines.push(matrasArray);
           matrasArray = [];
        }
      }
      
      renderNotationGrid();
      saveHistory();
      e.target.value = '';
    });
  }
};
