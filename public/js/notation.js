// ============================================================
// NOTATION STUDIO - CORE ENGINE
// ============================================================

// 1. Global State
let notationState = {
  mode: 'tabla', // 'tabla' or 'vocal'
  system: 'bhatkhande', // 'bhatkhande' or 'paluskar'
  language: 'en', // 'en' or 'hi'
  taal: '16', // default Teentaal
  activeCell: { lineIndex: 0, matraIndex: 0 },
  lines: [
    // Array of lines. Each line is an array of matras.
    Array.from({length: 16}, (_, i) => ({ matra: i + 1, content: '-', modifier: null }))
  ]
};

// History Stack for Undo/Redo
let historyStack = [];
let historyIndex = -1;

// 2. Constants & Configurations
const TAAL_CONFIG = {
  '16': { name: 'Teentaal', matras: 16, vibhags: [4, 4, 4, 4], taliKhali: ['X', '2', '0', '3'] },
  '12': { name: 'Ektaal', matras: 12, vibhags: [2, 2, 2, 2, 2, 2], taliKhali: ['X', '0', '2', '0', '3', '4'] },
  '10': { name: 'Jhaptaal', matras: 10, vibhags: [2, 3, 2, 3], taliKhali: ['X', '2', '0', '3'] },
  '8': { name: 'Keharwa', matras: 8, vibhags: [4, 4], taliKhali: ['X', '0'] },
  '7': { name: 'Rupak', matras: 7, vibhags: [3, 2, 2], taliKhali: ['0', '1', '2'] },
  '6': { name: 'Dadra', matras: 6, vibhags: [3, 3], taliKhali: ['X', '0'] },
  '14': { name: 'Dhamar', matras: 14, vibhags: [5, 2, 3, 4], taliKhali: ['X', '2', '0', '3'] },
  '14_deep': { name: 'Deepchandi', matras: 14, vibhags: [3, 4, 3, 4], taliKhali: ['X', '2', '0', '3'] }
};

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

// English/Hindi Translation Maps for Bols and Swaras
const TRANSLATION_MAP_EN_TO_HI = {
  // Swaras
  's': 'सा', 'sa': 'सा',
  'r': 'रे', 're': 'रे',
  'g': 'ग', 'ga': 'ग',
  'm': 'म', 'ma': 'म',
  'p': 'प', 'pa': 'प',
  'd': 'ध', 'dha': 'ध',
  'n': 'नि', 'ni': 'नि',
  'ṡ': 'सा', 'ṙ': 'रे', 'ġ': 'ग',
  'ṇ': 'नि',
  // Tabla Bols
  'dha': 'धा', 'dhin': 'धिन', 'dhun': 'धुन', 'tin': 'तिन', 'ta': 'ता', 'na': 'ना',
  'ge': 'गे', 'ke': 'के', 'kat': 'कत', 'tit': 'टिट', 'tirakita': 'तिरकिट', 'tete': 'टेटे',
  'dhage': 'धागे', 'dhere': 'धेरे', 'trkt': 'त्रक्ट', 'tun': 'तुन', 'ti': 'ती',
  'ra': 'र', 'ki': 'की',
  '-': '-', 'ऽ': 'ऽ'
};

const TRANSLATION_MAP_HI_TO_EN = {
  // Swaras
  'सा': 'Sa', 'रे': 'Re', 'ग': 'Ga', 'म': 'Ma', 'प': 'Pa', 'ध': 'Dha', 'नि': 'Ni',
  // Tabla Bols
  'धा': 'Dha', 'धिन': 'Dhin', 'धुन': 'Dhun', 'तिन': 'Tin', 'ता': 'Ta', 'ना': 'Na',
  'गे': 'Ge', 'के': 'Ke', 'कत': 'Kat', 'टिट': 'Tit', 'तिरकिट': 'Tirakita', 'टेटे': 'Tete',
  'धागे': 'Dhage', 'धेरे': 'Dhere', 'त्रक्ट': 'Trkt', 'तुन': 'Tun', 'ती': 'Ti',
  'र': 'Ra', 'की': 'Ki', 'टा': 'Ta',
  '-': '-', 'ऽ': '-'
};

const TEMPLATES = {
  tabla: {
    kaida: {
      name: 'Kaida (Teentaal)',
      taal: '16',
      title: 'Teentaal Kaida - Dha Ti Ta',
      lines: [
        ['Dha Ti Ta Dha', 'Ti Ta Dha Dha', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', 'Ta Ti Ta Ta', 'Ti Ta Ta Ta', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', 'Dha Ti Ta Dha', 'Ti Ta Dha Dha', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', 'Dha Ti Ta Dha', 'Ti Ta Dha Ge', 'Na Dha Ti Ta', '-']
      ]
    },
    rela: {
      name: 'Rela (Teentaal)',
      taal: '16',
      title: 'Teentaal Rela - Tirakita',
      lines: [
        ['Tirakita Dha Tirakita', 'Dha Dha Tirakita', 'Dha Ge Na Dha', 'Tirakita Dha Ge', 'Tirakita Ta Tirakita', 'Ta Ta Tirakita', 'Dha Ge Na Dha', 'Tirakita Dha Ge', 'Dha Tirakita Dha', 'Dha Tirakita Dha', 'Dha Ge Na Dha', 'Tirakita Dha Ge', 'Dha Tirakita Dha', 'Tirakita Dha Ge', 'Na Dha Ti Ta', '-']
      ]
    },
    tukda: {
      name: 'Tukda (Teentaal)',
      taal: '16',
      title: 'Teentaal Tukda - Kat Ta',
      lines: [
        ['Kat Ta Kat Ta', 'Dhere Dhere Kat Ta', 'Kat Ta Dhere Dhere', 'Kat Ta Kat Ta', 'Kat Ta Kat Ta', 'Dhere Dhere Kat Ta', 'Kat Ta Dhere Dhere', 'Kat Ta Kat Ta', 'Kat Ta Kat Ta', 'Dhere Dhere Kat Ta', 'Kat Ta Dhere Dhere', 'Kat Ta Kat Ta', 'Dha - - -', '- - - -', '- - - -', '-']
      ]
    }
  },
  vocal: {
    yaman: {
      name: 'Sargam Geet (Raag Yaman)',
      taal: '16',
      title: 'Sargam Geet - Raag Yaman (Teentaal)',
      lines: [
        // Asthayi Line 1
        [
          { content: 'Ṇ', modifier: 'dot-below' }, { content: 'R', modifier: null }, { content: 'G', modifier: null }, { content: 'M', modifier: 'vertical' },
          { content: 'P', modifier: null }, { content: 'D', modifier: null }, { content: 'N', modifier: null }, { content: 'Ṡ', modifier: 'dot-above' },
          { content: 'Ṡ', modifier: 'dot-above' }, { content: 'N', modifier: null }, { content: 'D', modifier: null }, { content: 'P', modifier: null },
          { content: 'M', modifier: 'vertical' }, { content: 'G', modifier: null }, { content: 'R', modifier: null }, { content: 'S', modifier: null }
        ],
        // Asthayi Line 2
        [
          { content: 'G', modifier: null }, { content: 'G', modifier: null }, { content: 'R', modifier: null }, { content: 'S', modifier: null },
          { content: 'Ṇ', modifier: 'dot-below' }, { content: 'R', modifier: null }, { content: 'G', modifier: null }, { content: 'M', modifier: 'vertical' },
          { content: 'P', modifier: null }, { content: 'D', modifier: null }, { content: 'P', modifier: null }, { content: 'M', modifier: 'vertical' },
          { content: 'G', modifier: null }, { content: 'R', modifier: null }, { content: 'G', modifier: null }, { content: 'S', modifier: null }
        ]
      ]
    },
    bhairav: {
      name: 'Chhota Khayal Bandish (Raag Bhairav)',
      taal: '16',
      title: 'Bandish - Raag Bhairav (Teentaal)',
      lines: [
        // Bhairav uses Komal Re & Dha
        [
          { content: 'Jaa', modifier: null }, { content: 'go', modifier: null }, { content: 'Mo', modifier: null }, { content: 'ri', modifier: null },
          { content: 'S', modifier: null }, { content: 'R', modifier: 'underline' }, { content: 'G', modifier: null }, { content: 'M', modifier: null },
          { content: 'P', modifier: null }, { content: 'D', modifier: 'underline' }, { content: 'N', modifier: null }, { content: 'Ṡ', modifier: 'dot-above' },
          { content: 'Ṡ', modifier: 'dot-above' }, { content: 'N', modifier: null }, { content: 'D', modifier: 'underline' }, { content: 'P', modifier: null }
        ],
        [
          { content: 'Pyaare', modifier: null }, { content: 'tum', modifier: null }, { content: 'bin', modifier: null }, { content: 'ho', modifier: null },
          { content: 'M', modifier: null }, { content: 'G', modifier: null }, { content: 'R', modifier: 'underline' }, { content: 'S', modifier: null },
          { content: 'G', modifier: null }, { content: 'M', modifier: null }, { content: 'P', modifier: null }, { content: 'D', modifier: 'underline' },
          { content: 'N', modifier: null }, { content: 'D', modifier: 'underline' }, { content: 'P', modifier: null }, { content: '-', modifier: null }
        ]
      ]
    },
    bilawal: {
      name: 'Lakshan Geet (Raag Bilawal)',
      taal: '16',
      title: 'Lakshan Geet - Raag Bilawal (Teentaal)',
      lines: [
        [
          { content: 'Bi', modifier: null }, { content: 'la', modifier: null }, { content: 'wa', modifier: null }, { content: 'l', modifier: null },
          { content: 'S', modifier: null }, { content: 'R', modifier: null }, { content: 'G', modifier: null }, { content: 'M', modifier: null },
          { content: 'P', modifier: null }, { content: 'D', modifier: null }, { content: 'N', modifier: null }, { content: 'Ṡ', modifier: 'dot-above' },
          { content: 'Ṡ', modifier: 'dot-above' }, { content: 'N', modifier: null }, { content: 'D', modifier: null }, { content: 'P', modifier: null }
        ]
      ]
    }
  }
};

const FORMAT_OPTS = [
  { id: 'underline', label: 'U', title: 'Underline (Komal / Double Speed)', icon: '<u>R</u>' },
  { id: 'dot-below', label: 'D', title: 'Mandra Saptak (Dot Below / Dot Above in Paluskar)', icon: 'Ṣ' },
  { id: 'dot-above', label: 'T', title: 'Taar Saptak (Dot Above / Line Above in Paluskar)', icon: 'Ṡ' },
  { id: 'vertical',  label: 'V', title: 'Tivra (Vertical Line / Slanted Stroke in Paluskar)', icon: 'M|' },
  { id: 'clear',     label: 'C', title: 'Clear Format', icon: '⨂' }
];

// 3. Translation Helper Functions
function translateToken(token, toLanguage) {
  if (!token) return '';
  const cleanToken = token.trim();
  const lowerToken = cleanToken.toLowerCase();
  
  if (toLanguage === 'hi') {
    // Check direct match or stripped match (ignoring saptak markers for base translation)
    const stripped = cleanToken.replace(/[̣̱̇॑]/g, '').toLowerCase();
    return TRANSLATION_MAP_EN_TO_HI[stripped] || cleanToken;
  } else {
    return TRANSLATION_MAP_HI_TO_EN[cleanToken] || cleanToken;
  }
}

function translateContent(content, toLanguage) {
  if (!content || content === '-' || content === 'ऽ') return content;
  return content.split(' ').map(token => translateToken(token, toLanguage)).join(' ');
}

function translateEntireDocument(toLanguage) {
  notationState.lines.forEach(line => {
    line.forEach(matra => {
      matra.content = translateContent(matra.content, toLanguage);
    });
  });
}

// 4. Rendering Engine
function renderNotationGrid() {
  const gridContainer = document.getElementById('nsGrid');
  const docContainer = document.getElementById('nsDocument');
  if (!gridContainer || !docContainer) return;
  
  // Set system attribute for CSS styling
  docContainer.setAttribute('data-system', notationState.system);
  gridContainer.innerHTML = ''; 

  const config = TAAL_CONFIG[notationState.taal];
  
  notationState.lines.forEach((line, lineIndex) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'grid-row';
    
    let matraCounter = 0;
    
    config.vibhags.forEach((vibhagSize, vIndex) => {
      const vibhagEl = document.createElement('div');
      vibhagEl.className = 'grid-vibhag';
      
      for (let i = 0; i < vibhagSize; i++) {
        const matraData = line[matraCounter];
        const isFirstOfVibhag = (i === 0);
        let taliKhaliMarker = isFirstOfVibhag ? config.taliKhali[vIndex] : '';
        
        // Translate Tali/Khali markers for Paluskar system
        if (taliKhaliMarker && notationState.system === 'paluskar') {
          if (taliKhaliMarker === 'X') taliKhaliMarker = '1';
          else if (taliKhaliMarker === '0') taliKhaliMarker = '+';
        }
        
        const cellEl = document.createElement('div');
        cellEl.className = 'grid-cell';
        
        // Render Tali/Khali marker
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
        
        // Content Input
        const contentEl = document.createElement('div');
        contentEl.className = 'cell-content';
        if (matraData && matraData.modifier) {
          contentEl.classList.add(`mod-${matraData.modifier}`);
        }
        contentEl.contentEditable = true;
        contentEl.textContent = matraData ? matraData.content : '-';
        
        // Highlight active focus
        if (notationState.activeCell.lineIndex === lineIndex && notationState.activeCell.matraIndex === matraCounter) {
          contentEl.style.background = 'rgba(245,166,35,0.15)';
          contentEl.style.border = '1px dashed var(--gold)';
        }
        
        // Capture indices for closure safety
        const currentLineIdx = lineIndex;
        const currentMatraIdx = matraCounter;
        
        // Save state on input
        contentEl.addEventListener('input', (e) => {
          notationState.lines[currentLineIdx][currentMatraIdx].content = e.target.textContent;
        });
        
        // Save history on blur (prevents spamming history on every keystroke)
        contentEl.addEventListener('blur', () => {
          saveHistory();
        });
        
        // Focus state visual highlight
        contentEl.addEventListener('focus', () => {
          document.querySelectorAll('.grid-cell .cell-content').forEach(el => {
            el.style.background = ''; 
            el.style.border = '';
          });
          contentEl.style.background = 'rgba(245,166,35,0.15)';
          contentEl.style.border = '1px dashed var(--gold)';
          notationState.activeCell = { lineIndex: currentLineIdx, matraIndex: currentMatraIdx };
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
  
  // Re-apply search filter if there's an active query
  applyPaletteSearch();
}

function renderTemplatesSelect() {
  const select = document.getElementById('nsTemplate');
  if (!select) return;
  
  select.innerHTML = '<option value="">Templates...</option>';
  
  const modeTemplates = TEMPLATES[notationState.mode];
  for (const key in modeTemplates) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = modeTemplates[key].name;
    select.appendChild(option);
  }
}

// 5. Actions & Interactions
function insertIntoActiveCell(text) {
  const { lineIndex, matraIndex } = notationState.activeCell;
  if (lineIndex < notationState.lines.length && matraIndex < notationState.lines[lineIndex].length) {
    let currentContent = notationState.lines[lineIndex][matraIndex].content;
    
    if (currentContent === '-' || currentContent.trim() === '') {
      notationState.lines[lineIndex][matraIndex].content = text;
    } else {
      notationState.lines[lineIndex][matraIndex].content += ' ' + text;
    }
    
    renderNotationGrid();
    saveHistory();
  }
}

function applyModifier(modifierId) {
  const { lineIndex, matraIndex } = notationState.activeCell;
  if (lineIndex < notationState.lines.length && matraIndex < notationState.lines[lineIndex].length) {
    if (modifierId === 'clear') {
      notationState.lines[lineIndex][matraIndex].modifier = null;
    } else {
      notationState.lines[lineIndex][matraIndex].modifier = modifierId;
    }
    renderNotationGrid();
    saveHistory();
  }
}

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
      applyModifier(opt.id);
    });
    container.appendChild(btn);
  });
}

function applyPaletteSearch() {
  const searchInput = document.getElementById('paletteSearch');
  if (!searchInput) return;
  const query = searchInput.value.toLowerCase();
  
  document.querySelectorAll('.palette-item').forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(query) ? '' : 'none';
  });
}

function addLineRow() {
  const cols = TAAL_CONFIG[notationState.taal].matras;
  const newRow = Array.from({length: cols}, (_, i) => ({ matra: i + 1, content: '-', modifier: null }));
  notationState.lines.push(newRow);
  renderNotationGrid();
  saveHistory();
}

function loadTemplate(templateId) {
  if (!templateId) return;
  const template = TEMPLATES[notationState.mode][templateId];
  if (!template) return;
  
  // Set taal
  notationState.taal = template.taal;
  const selectTaal = document.getElementById('nsTaal');
  if (selectTaal) selectTaal.value = template.taal;
  
  // Set Title
  const titleInput = document.getElementById('nsTitle');
  if (titleInput) titleInput.value = template.title;
  
  // Load lines
  notationState.lines = [];
  const cols = TAAL_CONFIG[template.taal].matras;
  
  template.lines.forEach(lineArr => {
    const formattedLine = lineArr.map((cellData, cIdx) => {
      if (typeof cellData === 'string') {
        // Simple string bol translation if language is Hindi
        const contentVal = (notationState.language === 'hi') ? translateContent(cellData, 'hi') : cellData;
        return { matra: cIdx + 1, content: contentVal, modifier: null };
      } else {
        // Object formatting (Swaras with modifiers)
        const contentVal = (notationState.language === 'hi') ? translateContent(cellData.content, 'hi') : cellData.content;
        return { matra: cIdx + 1, content: contentVal, modifier: cellData.modifier };
      }
    });
    notationState.lines.push(formattedLine);
  });
  
  renderNotationGrid();
  saveHistory();
}

// FIX: Debounce guard for saveHistory — prevents a full deep-clone of the grid
// state on every single keystroke (blur fires frequently on contentEditable cells).
let _historySaveTimer = null;
let _lastHistorySaveTime = 0;

function saveHistory() {
  const now = Date.now();
  // Immediate snapshot on non-typing actions (template load, palette click, modifier).
  // Debounce rapid keystrokes: only snapshot if 300ms have elapsed since the last one.
  if (now - _lastHistorySaveTime < 300) {
    clearTimeout(_historySaveTimer);
    _historySaveTimer = setTimeout(() => {
      _lastHistorySaveTime = Date.now();
      _commitHistory();
    }, 300);
    return;
  }
  _lastHistorySaveTime = now;
  _commitHistory();
}

function _commitHistory() {
  const stateCopy = JSON.parse(JSON.stringify(notationState.lines));
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  historyStack.push(stateCopy);
  historyIndex++;
  
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

// 7. PDF/PNG Export
function setupExport() {
  document.getElementById('nsExportBtn')?.addEventListener('click', () => {
    const originalElement = document.getElementById('nsDocument');
    const title = document.getElementById('nsTitle').value || 'Composition';
    
    // Clone the element so we don't mutate the live DOM
    const clone = originalElement.cloneNode(true);
    clone.style.background = '#fff';
    clone.style.color = '#000';
    clone.querySelectorAll('.cell-content').forEach(c => {
      c.style.color = '#000';
      // FIX: Disable contentEditable on all cells in the clone before passing to
      // html2pdf. This prevents the library from interpreting user-entered content
      // as executable markup and neutralizes any potential XSS injection vectors.
      c.contentEditable = 'false';
      c.setAttribute('contenteditable', 'false');
    });
    clone.querySelectorAll('.tali-khali').forEach(c => c.style.color = '#000');
    clone.querySelectorAll('.doc-title-input').forEach(c => {
       c.style.color = '#000';
       c.style.border = 'none';
       // We also want to copy the input value to the clone since cloneNode(true) might not copy input states
       c.value = originalElement.querySelector('.doc-title-input').value;
    });
    clone.querySelectorAll('.grid-cell').forEach(c => c.style.borderColor = '#ccc');
    clone.querySelectorAll('.grid-vibhag').forEach(c => c.style.borderColor = '#000');
    clone.querySelectorAll('.grid-row').forEach(c => c.style.borderColor = '#000');
    
    // Create a hidden container for the clone
    const hiddenContainer = document.createElement('div');
    hiddenContainer.style.position = 'absolute';
    hiddenContainer.style.left = '-9999px';
    hiddenContainer.style.top = '-9999px';
    hiddenContainer.appendChild(clone);
    document.body.appendChild(hiddenContainer);
    
    if (typeof html2pdf !== 'undefined') {
        html2pdf().from(clone).save(title + '.pdf').then(() => {
          document.body.removeChild(hiddenContainer);
        }).catch(err => {
          console.error('PDF Export Error:', err);
          document.body.removeChild(hiddenContainer);
        });
    } else {
        alert("html2pdf library is not loaded. Ensure you are connected to the internet.");
        document.body.removeChild(hiddenContainer);
    }
  });
}

// 8. Core Initialization
function initNotationStudio() {
  // Initial renders
  renderTemplatesSelect();
  renderPalette();
  renderFormatToolbar();
  renderNotationGrid();
  setupExport();
  
  // Wire Toggles
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const group = e.target.closest('.toggle-group');
      if (!group) return;
      
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      const val = e.target.getAttribute('data-val');
      
      if (group.id === 'modeToggle') {
        notationState.mode = val;
        // Swap default templates list and palette content
        renderTemplatesSelect();
        renderPalette();
        // Reset active composition to match mode
        const firstKey = Object.keys(TEMPLATES[val])[0];
        loadTemplate(firstKey);
      }
      
      if (group.id === 'systemToggle') {
        notationState.system = val;
        renderNotationGrid();
      }
      
      if (group.id === 'langToggle') {
        const oldLang = notationState.language;
        notationState.language = val;
        
        // Translate existing document cells instantly
        if (oldLang !== val) {
          translateEntireDocument(val);
        }
        
        renderPalette();
        renderNotationGrid();
      }
    });
  });
  
  // Taal Selector Listener
  document.getElementById('nsTaal')?.addEventListener('change', (e) => {
    const newTaal = e.target.value;
    const config = TAAL_CONFIG[newTaal];
    notationState.taal = newTaal;
    // Reset lines array to match the new size of the selected taal
    notationState.lines = [
      Array.from({length: config.matras}, (_, i) => ({ matra: i + 1, content: '-', modifier: null }))
    ];
    notationState.activeCell = { lineIndex: 0, matraIndex: 0 };
    renderNotationGrid();
    saveHistory();
  });
  
  // Undo/Redo Click Listeners
  document.getElementById('nsUndo')?.addEventListener('click', undo);
  document.getElementById('nsRedo')?.addEventListener('click', redo);
  
  // Palette Search Input
  document.getElementById('paletteSearch')?.addEventListener('input', applyPaletteSearch);
  
  // Tutorial Modal Show / Hide
  const helpBtn = document.getElementById('nsHelpBtn');
  const tutorialModal = document.getElementById('nsTutorialModal');
  const closeBtn = document.getElementById('nsTutorialClose');
  if (helpBtn && tutorialModal && closeBtn) {
    helpBtn.addEventListener('click', () => tutorialModal.classList.add('active'));
    closeBtn.addEventListener('click', () => tutorialModal.classList.remove('active'));
  }
  
  // Click outside to close modals (Enhances UX)
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
  
  // Add Line Row
  document.getElementById('nsAddRowBtn')?.addEventListener('click', addLineRow);
  
  // Templates Select dropdown listener
  document.getElementById('nsTemplate')?.addEventListener('change', (e) => {
    loadTemplate(e.target.value);
    e.target.value = ''; // Reset select state
  });
  
  // Save base history state
  saveHistory();
  
  // Hook up playback button
  document.getElementById('nsPlayBtn')?.addEventListener('click', toggleNotationPlayback);
}

// 9. Notation Playback Engine
let nsPlaying = false;
let nsNextNoteTime = 0;
let nsCurrentMatra = 0;
let nsCurrentLine = 0;
let nsTimerID = null;
const nsLookahead = 25.0; // ms
const nsScheduleAheadTime = 0.1; // s

function getFrequency(swara) {
  // Mapping based on D scale (146.83 Hz) roughly
  const baseFreq = parseFloat(document.getElementById('fineTuneHz')?.value || 146.83);
  const ratios = {
    'sa': 1, 're': 9/8, 'ga': 5/4, 'ma': 4/3, 'pa': 3/2, 'dha': 5/3, 'ni': 15/8,
    's': 1, 'r': 9/8, 'g': 5/4, 'm': 4/3, 'p': 3/2, 'd': 5/3, 'n': 15/8
  };
  let cleanSwara = translateToken(swara, 'en').toLowerCase().replace(/[̣̱̇॑]/g, '');
  let ratio = ratios[cleanSwara] || 1;
  return baseFreq * ratio;
}

function playTone(freq, time, dur) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.01, time);
  gain.gain.exponentialRampToValueAtTime(0.5, time + 0.02);
  gain.gain.setValueAtTime(0.5, time + dur - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
  osc.start(time);
  osc.stop(time + dur);
}

function playNoise(time, dur) {
  if (!audioCtx) return;
  const bufferSize = audioCtx.sampleRate * dur;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
  noise.connect(gain);
  gain.connect(audioCtx.destination);
  noise.start(time);
}

function nsScheduler() {
  if (!nsPlaying) return;
  while (nsNextNoteTime < audioCtx.currentTime + nsScheduleAheadTime) {
    nsScheduleNote(nsCurrentLine, nsCurrentMatra, nsNextNoteTime);
    nsAdvanceNote();
  }
  nsTimerID = setTimeout(nsScheduler, nsLookahead);
}

function nsScheduleNote(lineIdx, matraIdx, time) {
  if (lineIdx >= notationState.lines.length) return;
  const matra = notationState.lines[lineIdx][matraIdx];
  if (!matra || matra.content === '-' || matra.content === 'ऽ') return;
  
  setTimeout(() => {
     document.querySelectorAll('.grid-cell .cell-content').forEach(el => {
       el.style.background = '';
       el.style.border = '';
     });
     const cells = document.querySelectorAll('.grid-row')[lineIdx]?.querySelectorAll('.cell-content');
     if (cells && cells[matraIdx]) {
       cells[matraIdx].style.background = 'rgba(245,166,35,0.15)';
       cells[matraIdx].style.border = '2px solid var(--accent)';
     }
  }, Math.max(0, (time - audioCtx.currentTime) * 1000));

  let bpm = 100;
  const tempoVal = document.getElementById('tempoValue')?.textContent;
  if (tempoVal && tempoVal !== '—') bpm = parseInt(tempoVal);
  const dur = 60.0 / bpm;

  const tokens = matra.content.split(' ').filter(t => t.trim() !== '');
  if (notationState.mode === 'vocal') {
    tokens.forEach((tok, i) => {
       if (tok === '-' || tok === 'ऽ') return;
       const f = getFrequency(tok);
       let tokDur = dur / tokens.length;
       let finalFreq = f;
       if (matra.modifier === 'dot-above') finalFreq *= 2;
       if (matra.modifier === 'dot-below') finalFreq /= 2;
       if (matra.modifier === 'vertical') finalFreq *= 1.05946; // approx tivra/sharp
       if (matra.modifier === 'underline') finalFreq /= 1.05946; // approx komal/flat
       playTone(finalFreq, time + (i * tokDur), tokDur);
    });
  } else {
    tokens.forEach((tok, i) => {
       if (tok === '-' || tok === 'ऽ') return;
       let tokDur = dur / tokens.length;
       playNoise(time + (i * tokDur), tokDur);
    });
  }
}

function nsAdvanceNote() {
  let bpm = 100;
  const tempoVal = document.getElementById('tempoValue')?.textContent;
  if (tempoVal && tempoVal !== '—') bpm = parseInt(tempoVal);
  const secondsPerBeat = 60.0 / bpm;
  
  nsNextNoteTime += secondsPerBeat;
  nsCurrentMatra++;
  
  const cols = TAAL_CONFIG[notationState.taal].matras;
  if (nsCurrentMatra >= cols) {
    nsCurrentMatra = 0;
    nsCurrentLine++;
    if (nsCurrentLine >= notationState.lines.length) {
      nsCurrentLine = 0; // loop back to top
    }
  }
}

function toggleNotationPlayback() {
  if (nsPlaying) {
    nsPlaying = false;
    clearTimeout(nsTimerID);
    document.getElementById('nsPlayIcon').style.display = '';
    document.getElementById('nsPauseIcon').style.display = 'none';
    
    document.querySelectorAll('.grid-cell .cell-content').forEach(el => {
       el.style.background = '';
       el.style.border = '';
    });
  } else {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    nsPlaying = true;
    nsCurrentLine = 0;
    nsCurrentMatra = 0;
    nsNextNoteTime = audioCtx.currentTime + 0.1;
    document.getElementById('nsPlayIcon').style.display = 'none';
    document.getElementById('nsPauseIcon').style.display = '';
    nsScheduler();
  }
}

// Boot up when ready
document.addEventListener('DOMContentLoaded', () => {
  initNotationStudio();
});
