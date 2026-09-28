// ============================================================
// NOTATION STUDIO - CORE ENGINE
// ============================================================
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput } from '../core/audio-output.js';
import { decodeShare, deserialize, encodeShare, loadLibrary, serialize, shareFromHash, storeLibrary, upsertEntry } from './library.js';
import { playBol, playSwar } from './synth.js';

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
  'd': 'ध', // 'dha' is ambiguous (swara ध vs bol धा): see translateToken
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
  
  if (toLanguage === 'hi') {
    // Check direct match or stripped match (ignoring saptak markers for base translation)
    const stripped = cleanToken.replace(/[̣̱̇॑]/g, '').toLowerCase();
    // "dha" is the swara ध in vocal notation but the bol धा in tabla notation
    if (stripped === 'dha' && notationState.mode === 'vocal') return 'ध';
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
        contentEl.setAttribute('role', 'textbox');
        contentEl.setAttribute('aria-label', `Line ${lineIndex + 1}, matra ${matraCounter + 1}`);
        contentEl.textContent = matraData ? matraData.content : '-';

        // Highlight active focus
        if (notationState.activeCell.lineIndex === lineIndex && notationState.activeCell.matraIndex === matraCounter) {
          contentEl.classList.add('is-selected');
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
          document.querySelectorAll('.grid-cell .cell-content.is-selected').forEach(el => el.classList.remove('is-selected'));
          contentEl.classList.add('is-selected');
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
  fitGridToWidth();
}

// Narrow screens: a line of the grid wraps at vibhag boundaries into
// balanced lines (Teentaal: 8 + 8 matras rather than 12 + 4). style.css sizes
// each matra as 1/--per-line of the row.
const MIN_MATRA_PX = 44;

/** Matras per displayed line: the whole cycle if it fits in `fit` matras, else the fewest, most even lines of whole vibhags. */
export function matrasPerLine(vibhags, fit) {
  const sum = list => list.reduce((a, b) => a + b, 0);
  if (sum(vibhags) <= fit) return sum(vibhags);
  // Shortest possible longest line when the vibhags are split into `lines` runs
  const longestLine = (start, lines) => {
    if (lines === 1) return sum(vibhags.slice(start));
    let best = Infinity, run = 0;
    for (let end = start; end <= vibhags.length - lines; end++) {
      run += vibhags[end];
      best = Math.min(best, Math.max(run, longestLine(end + 1, lines - 1)));
    }
    return best;
  };
  for (let lines = 2; lines <= vibhags.length; lines++) {
    const len = longestLine(0, lines);
    if (len <= fit) return len;
  }
  return Math.max(...vibhags);
}

function fitGridToWidth() {
  const grid = document.getElementById('nsGrid');
  const row = grid && grid.querySelector('.grid-row');
  if (!row || !row.clientWidth) return; // hidden: sized when it's shown
  const fit = Math.max(1, Math.floor(row.clientWidth / MIN_MATRA_PX));
  grid.style.setProperty('--per-line', matrasPerLine(TAAL_CONFIG[notationState.taal].vibhags, fit));
}

function renderPalette() {
  const paletteGrid = document.getElementById('paletteGrid');
  if (!paletteGrid) return;
  paletteGrid.innerHTML = '';
  
  const items = PALETTE_DATA[notationState.mode][notationState.language] || [];
  
  items.forEach(item => {
    const el = document.createElement('button');
    el.type = 'button';
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
    btn.className = 'header-icon-btn icon-only format-btn';
    btn.innerHTML = opt.icon;
    btn.title = opt.title;
    btn.setAttribute('aria-label', opt.title);
    
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
// html2pdf is ~900 KB, so it's fetched the first time someone exports rather
// than on every page load.
const HTML2PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
let html2pdfLoading = null;

function loadHtml2Pdf() {
  if (typeof html2pdf !== 'undefined') return Promise.resolve();
  if (!html2pdfLoading) {
    html2pdfLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HTML2PDF_URL;
      script.onload = resolve;
      script.onerror = () => { html2pdfLoading = null; script.remove(); reject(new Error('html2pdf failed to load')); };
      document.head.appendChild(script);
    });
  }
  return html2pdfLoading;
}

function setupExport() {
  document.getElementById('nsExportBtn')?.addEventListener('click', async () => {
    try {
      await loadHtml2Pdf();
    } catch {
      alert("Couldn't load the PDF exporter. Check your internet connection and try again.");
      return;
    }
    const originalElement = document.getElementById('nsDocument');
    const title = document.getElementById('nsTitle').value || 'Composition';
    
    // Clone the element so we don't mutate the live DOM
    const clone = originalElement.cloneNode(true);
    clone.style.background = '#fff';
    clone.style.color = '#000';
    clone.querySelectorAll('.cell-content').forEach(c => {
      c.classList.remove('is-selected', 'is-playing');
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
    
    html2pdf().from(clone).save(title + '.pdf').then(() => {
      document.body.removeChild(hiddenContainer);
    }).catch(err => {
      console.error('PDF Export Error:', err);
      document.body.removeChild(hiddenContainer);
    });
  });
}

// 8. Core Initialization
export function initNotationStudio() {
  // Initial renders
  const gridEl = document.getElementById('nsGrid');
  if (gridEl && 'ResizeObserver' in window) new ResizeObserver(fitGridToWidth).observe(gridEl);
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
  // (Escape / backdrop clicks close every modal: see core/modals.js)

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

  initLibrary();
}


// 9. Notation Playback Engine
let nsPlaying = false;
let nsNextNoteTime = 0;
let nsCurrentMatra = 0;
let nsCurrentLine = 0;
let nsTimerID = null;
let nsOut = null;
const nsLookahead = 25.0; // ms
const nsScheduleAheadTime = 0.1; // s

// Notation playback follows the Lehra player's tempo (#tempoValue is a
// number input), falling back to 100 BPM.
function nsTempo() {
  const v = parseInt(document.getElementById('tempoValue')?.value, 10);
  return v > 0 ? v : 100;
}

function showTempo() {
  const el = document.getElementById('nsTempoLabel');
  if (el) el.textContent = `${nsTempo()} BPM`;
}

// Sa of the Lehra player (the fine-tune field always holds the current Sa)
function nsSa() {
  const v = parseFloat(document.getElementById('fineTuneHz')?.value);
  return v > 0 ? v : 146.83;
}

// Just ratios: [shuddh, komal (underline), tivra (vertical line)]
const SWAR_RATIOS = {
  sa: [1], re: [9 / 8, 16 / 15], ga: [5 / 4, 6 / 5], ma: [4 / 3, null, 45 / 32],
  pa: [3 / 2], dha: [5 / 3, 8 / 5], ni: [15 / 8, 16 / 9],
};
const SWAR_ALIASES = { s: 'sa', r: 're', g: 'ga', m: 'ma', p: 'pa', d: 'dha', n: 'ni', dh: 'dha' };

/**
 * Frequency of a sung swara token with its cell modifier, or null for
 * anything that isn't a swara (e.g. the words of a bandish), which stays
 * silent. Saptak comes from the dot modifiers, or from dots typed on the
 * letter itself (Ṡ, Ṇ).
 */
export function swarFrequency(token, modifier, sa) {
  const decomposed = translateToken(token, 'en').normalize('NFD');
  const key = decomposed.replace(/[̀-॒ͯ॑]/g, '').toLowerCase();
  const name = SWAR_RATIOS[key] ? key : SWAR_ALIASES[key];
  if (!name) return null;
  const [shuddh, komal, tivra] = SWAR_RATIOS[name];
  let ratio = shuddh;
  if (modifier === 'underline' && komal) ratio = komal;
  if (modifier === 'vertical' && tivra) ratio = tivra;
  if (modifier === 'dot-above' || (!modifier && /̇/.test(decomposed))) ratio *= 2;
  if (modifier === 'dot-below' || (!modifier && /̣/.test(decomposed))) ratio /= 2;
  return sa * ratio;
}

function nsOutput() {
  if (!nsOut) {
    const ctx = getAudioContext();
    nsOut = ctx.createGain();
    nsOut.gain.value = 0.8;
    // Fast strokes overlap (a rela rings on): limit rather than clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    nsOut.connect(limiter);
    limiter.connect(getMasterOutput());
  }
  return nsOut;
}

function nsScheduler() {
  const audioCtx = getAudioContext();
  if (!nsPlaying) return;
  showTempo();
  while (nsNextNoteTime < audioCtx.currentTime + nsScheduleAheadTime) {
    nsScheduleNote(nsCurrentLine, nsCurrentMatra, nsNextNoteTime);
    nsAdvanceNote();
  }
  nsTimerID = setTimeout(nsScheduler, nsLookahead);
}

function clearPlayingHighlight() {
  document.querySelectorAll('.grid-cell .cell-content.is-playing').forEach(el => el.classList.remove('is-playing'));
}

function nsScheduleNote(lineIdx, matraIdx, time) {
  const audioCtx = getAudioContext();
  if (lineIdx >= notationState.lines.length) return;
  const matra = notationState.lines[lineIdx][matraIdx];
  if (!matra || matra.content === '-' || matra.content === 'ऽ') return;

  setTimeout(() => {
     if (!nsPlaying) return;
     clearPlayingHighlight();
     const cells = document.querySelectorAll('.grid-row')[lineIdx]?.querySelectorAll('.cell-content');
     if (cells && cells[matraIdx]) cells[matraIdx].classList.add('is-playing');
  }, Math.max(0, (time - audioCtx.currentTime) * 1000));

  const dur = 60.0 / nsTempo();
  const tokens = matra.content.split(' ').filter(t => t.trim() !== '');
  const tokDur = dur / tokens.length;
  const sa = nsSa();
  const out = nsOutput();
  tokens.forEach((tok, i) => {
    if (tok === '-' || tok === 'ऽ') return;
    const t = time + i * tokDur;
    if (notationState.mode === 'vocal') {
      const f = swarFrequency(tok, matra.modifier, sa);
      if (f) playSwar(audioCtx, out, f, t, tokDur);
    } else {
      playBol(audioCtx, out, translateToken(tok, 'en'), t, tokDur, sa);
    }
  });
}

function nsAdvanceNote() {
  const secondsPerBeat = 60.0 / nsTempo();

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
    clearPlayingHighlight();
  } else {
    const audioCtx = getAudioContext();
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

/** Stop playback (e.g. when the user leaves the Notation page). */
export function stopNotationPlayback() {
  if (nsPlaying) toggleNotationPlayback();
}

// 10. Library: save / open / import / export / share
const TAAL_MATRAS = Object.fromEntries(Object.entries(TAAL_CONFIG).map(([id, c]) => [id, c.matras]));

function currentComposition() {
  return {
    title: document.getElementById('nsTitle')?.value || 'Untitled Composition',
    mode: notationState.mode,
    system: notationState.system,
    language: notationState.language,
    taal: notationState.taal,
    lines: notationState.lines,
  };
}

/** Show a composition (from the library, a file or a link) in the editor. */
function applyComposition(c) {
  stopNotationPlayback();
  Object.assign(notationState, {
    mode: c.mode, system: c.system, language: c.language, taal: c.taal, lines: c.lines,
    activeCell: { lineIndex: 0, matraIndex: 0 },
  });
  const groups = { modeToggle: c.mode, systemToggle: c.system, langToggle: c.language };
  for (const [id, val] of Object.entries(groups)) {
    document.querySelectorAll(`#${id} .toggle-btn`).forEach(b => b.classList.toggle('active', b.dataset.val === val));
  }
  document.getElementById('nsTaal').value = c.taal;
  document.getElementById('nsTitle').value = c.title;
  renderTemplatesSelect();
  renderPalette();
  renderNotationGrid();
  historyStack = [];
  historyIndex = -1;
  _commitHistory();
}

function libraryStatus(text) {
  document.getElementById('nsLibraryStatus').textContent = text;
}

function renderLibrary() {
  const ul = document.getElementById('nsLibraryList');
  ul.innerHTML = '';
  const list = loadLibrary();
  if (!list.length) {
    ul.innerHTML = '<li class="empty-hint">Nothing saved yet.</li>';
    return;
  }
  list.forEach(entry => {
    const li = document.createElement('li');
    li.className = 'preset-item';
    const info = document.createElement('div');
    info.className = 'preset-info';
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = entry.name;
    const meta = document.createElement('span');
    meta.className = 'preset-summary';
    const taal = TAAL_CONFIG[entry.doc.taal]?.name || entry.doc.taal;
    meta.textContent = `${entry.doc.mode === 'vocal' ? 'Vocal' : 'Tabla'} · ${taal} · ${entry.doc.lines?.length || 0} line(s) · ${new Date(entry.saved).toLocaleDateString()}`;
    info.append(name, meta);
    const open = document.createElement('button');
    open.className = 'header-icon-btn';
    open.textContent = 'Open';
    open.addEventListener('click', () => {
      try {
        applyComposition(deserialize(entry.doc, TAAL_MATRAS));
        document.getElementById('nsLibraryModal').classList.remove('active');
      } catch (err) {
        libraryStatus(`Couldn't open it: ${err.message}`);
      }
    });
    const del = document.createElement('button');
    del.className = 'header-icon-btn preset-delete';
    del.textContent = '×';
    del.title = `Delete “${entry.name}”`;
    del.setAttribute('aria-label', `Delete ${entry.name}`);
    del.addEventListener('click', () => {
      if (!confirm(`Delete “${entry.name}” from this browser?`)) return;
      storeLibrary(loadLibrary().filter(e => e.name !== entry.name));
      renderLibrary();
    });
    li.append(info, open, del);
    ul.appendChild(li);
  });
}

function saveToLibrary(name) {
  const ok = storeLibrary(upsertEntry(loadLibrary(), name, serialize(currentComposition())));
  libraryStatus(ok ? `Saved “${name}” in this browser.` : "Couldn't save (browser storage is full or disabled).");
  return ok;
}

function exportJson() {
  const doc = serialize(currentComposition());
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(doc.title || 'composition').replace(/[\\/:*?"<>|]+/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJson(file) {
  try {
    applyComposition(deserialize(JSON.parse(await file.text()), TAAL_MATRAS));
    libraryStatus(`Opened “${file.name}”.`);
  } catch (err) {
    libraryStatus(`Couldn't import ${file.name}: ${err.message}`);
  }
}

async function createShareLink() {
  const url = `${location.origin}/notation#n=${await encodeShare(serialize(currentComposition()))}`;
  const field = document.getElementById('nsShareUrl');
  field.value = url;
  field.select();
  try {
    await navigator.clipboard.writeText(url);
    libraryStatus('Link copied — anyone who opens it sees this composition.');
  } catch {
    libraryStatus('Copy the link above to share this composition.');
  }
}

function initLibrary() {
  const modal = document.getElementById('nsLibraryModal');
  if (!modal) return;
  document.getElementById('nsLibraryBtn').addEventListener('click', () => {
    document.getElementById('nsSaveName').value = document.getElementById('nsTitle').value;
    document.getElementById('nsShareUrl').value = '';
    libraryStatus('');
    renderLibrary();
    modal.classList.add('active');
  });
  document.getElementById('nsLibraryClose').addEventListener('click', () => modal.classList.remove('active'));
  document.getElementById('nsSaveForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('nsSaveName').value.trim().slice(0, 80);
    if (name && saveToLibrary(name)) renderLibrary();
  });
  document.getElementById('nsExportJson').addEventListener('click', exportJson);
  const fileInput = document.getElementById('nsImportFile');
  document.getElementById('nsImportJson').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) importJson(fileInput.files[0]);
    fileInput.value = '';
  });
  document.getElementById('nsShareBtn').addEventListener('click', createShareLink);
  // Ctrl/Cmd+S on the Notation page saves under the title
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' &&
        document.getElementById('view-notation')?.classList.contains('active-view')) {
      e.preventDefault();
      const name = (document.getElementById('nsTitle').value || 'Untitled Composition').trim().slice(0, 80);
      saveToLibrary(name);
      const btn = document.getElementById('nsLibraryBtn');
      btn.classList.add('saved');
      setTimeout(() => btn.classList.remove('saved'), 1200);
    }
  });
  showTempo();
}

/**
 * Open a composition shared as a link (#n=…), then switch to the Notation
 * page. Call after navigation is initialised.
 */
export async function openSharedComposition() {
  const payload = shareFromHash(location.hash);
  if (!payload) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  try {
    applyComposition(deserialize(await decodeShare(payload), TAAL_MATRAS));
    document.dispatchEvent(new CustomEvent('nav-internal', { detail: { target: 'view-notation', domain: 'hindustani' } }));
  } catch (err) {
    alert(`This composition link can't be opened: ${err.message}`);
  }
}
