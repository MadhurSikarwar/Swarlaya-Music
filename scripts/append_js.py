import pathlib

js_code = """
// ============================================================================
// ========================== NEW VERTICALS LOGIC =============================
// ============================================================================

// ── SPA Navigation ──
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // Stop Lehra audio
    if (typeof stopPlayback === 'function' && state && state.isPlaying) {
      stopPlayback();
    }
    // Stop Mixer audio
    if (mixerPlaying) stopMixer();
    // Stop Notation audio
    if (notationPlaying) {
      clearTimeout(notationTimerID);
      notationPlaying = false;
      document.getElementById('notationPlayBtn').textContent = 'PLAY';
      document.querySelectorAll('.notation-cell').forEach(c => c.classList.remove('playing'));
    }
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.app-view').forEach(v => {
      v.style.display = 'none';
      v.classList.remove('active-view');
    });
    
    const target = e.target.getAttribute('data-target');
    e.target.classList.add('active');
    const view = document.getElementById(target);
    if(view) {
        view.style.display = 'block';
        view.classList.add('active-view');
    }
  });
});

// ── Stem Separator Logic ──
let mixerAudioNodes = [];
let mixerPlaying = false;
let mixerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

document.getElementById('audioUpload')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  document.getElementById('uploadZone').style.display = 'none';
  document.getElementById('processingZone').style.display = 'block';
  document.getElementById('processingText').textContent = 'Uploading and processing stems... (this may take a few minutes)';
  
  const formData = new FormData();
  formData.append('audio', file);
  
  try {
    const res = await fetch('/api/separate', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    
    if (data.error) throw new Error(data.error);
    
    document.getElementById('processingZone').style.display = 'none';
    document.getElementById('mixerZone').style.display = 'block';
    
    renderMixerTracks(data.stems); 
    
  } catch (err) {
    alert("Error processing file: " + err.message);
    document.getElementById('processingZone').style.display = 'none';
    document.getElementById('uploadZone').style.display = 'block';
  }
});

async function renderMixerTracks(stems) {
  const container = document.getElementById('mixerTracks');
  container.innerHTML = '';
  mixerAudioNodes = [];
  
  for (const [name, url] of Object.entries(stems)) {
    const trackDiv = document.createElement('div');
    trackDiv.className = 'mixer-track';
    
    const label = document.createElement('span');
    label.className = 'track-name';
    label.textContent = name;
    
    const volWrap = document.createElement('div');
    volWrap.className = 'vol-slider-wrap';
    volWrap.style.flex = '1';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = '80';
    slider.className = 'vol-slider';
    
    const muteBtn = document.createElement('button');
    muteBtn.className = 'btn-mute';
    muteBtn.textContent = 'MUTE';
    
    trackDiv.appendChild(label);
    trackDiv.appendChild(volWrap);
    volWrap.appendChild(slider);
    trackDiv.appendChild(muteBtn);
    container.appendChild(trackDiv);
    
    // Load audio
    const audioEl = new Audio(url);
    audioEl.crossOrigin = 'anonymous';
    audioEl.loop = true;
    const track = mixerAudioCtx.createMediaElementSource(audioEl);
    const gainNode = mixerAudioCtx.createGain();
    gainNode.gain.value = 0.8;
    track.connect(gainNode).connect(mixerAudioCtx.destination);
    
    mixerAudioNodes.push({ el: audioEl, gain: gainNode });
    
    slider.addEventListener('input', (e) => {
      if (!muteBtn.classList.contains('muted')) {
        gainNode.gain.value = e.target.value / 100;
      }
    });
    
    muteBtn.addEventListener('click', () => {
      muteBtn.classList.toggle('muted');
      if (muteBtn.classList.contains('muted')) {
        gainNode.gain.value = 0;
      } else {
        gainNode.gain.value = slider.value / 100;
      }
    });
  }
}

document.getElementById('mixerPlayBtn')?.addEventListener('click', () => {
  if (mixerAudioCtx.state === 'suspended') mixerAudioCtx.resume();
  
  if (mixerPlaying) {
    stopMixer();
  } else {
    mixerAudioNodes.forEach(t => t.el.play());
    document.getElementById('mixerPlayIcon').style.display = 'none';
    document.getElementById('mixerPauseIcon').style.display = 'block';
    mixerPlaying = true;
  }
});

function stopMixer() {
  mixerAudioNodes.forEach(t => t.el.pause());
  document.getElementById('mixerPlayIcon').style.display = 'block';
  document.getElementById('mixerPauseIcon').style.display = 'none';
  mixerPlaying = false;
}

// ── Notation Editor Logic ──
let notationGrid = [];
let notationPlaying = false;
let notationAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
let notationTimerID;
let notationLookahead = 25.0; 
let notationScheduleAheadTime = 0.1;
let notationNextNoteTime = 0.0;
let notationCurrentCol = 0;

function initNotationGrid() {
  const container = document.getElementById('notationGridContainer');
  const taalSelect = document.getElementById('notationTaal');
  if(!container || !taalSelect) return;
  const cols = parseInt(taalSelect.value);
  const rows = 4; // Arbitrary 4 rows of composition
  
  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  
  // Header
  for (let i = 1; i <= cols; i++) {
    const div = document.createElement('div');
    div.className = 'notation-header-cell';
    div.textContent = i;
    container.appendChild(div);
  }
  
  notationGrid = [];
  
  for (let r = 0; r < rows; r++) {
    let rowCells = [];
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'notation-cell';
      cell.contentEditable = true;
      cell.dataset.row = r;
      cell.dataset.col = c;
      
      // Default sample content
      if (r === 0 && c % 4 === 0) cell.textContent = 'S';
      
      container.appendChild(cell);
      rowCells.push(cell);
    }
    notationGrid.push(rowCells);
  }
}

document.getElementById('notationTaal')?.addEventListener('change', initNotationGrid);
if (document.getElementById('notationGridContainer')) initNotationGrid();

// Formatting toolbar
['formatMandra', 'formatMadhya', 'formatTaar', 'formatKomal', 'formatTivra', 'formatDouble'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    
    if (node.nodeType === 3 && node.parentElement.classList.contains('notation-cell')) {
      const cell = node.parentElement;
      if (id === 'formatMandra') cell.className = 'notation-cell bhat-mandra';
      else if (id === 'formatTaar') cell.className = 'notation-cell bhat-taar';
      else if (id === 'formatKomal') cell.className = 'notation-cell bhat-komal';
      else if (id === 'formatTivra') cell.className = 'notation-cell bhat-tivra';
      else if (id === 'formatDouble') cell.style.textDecoration = 'underline';
      else cell.className = 'notation-cell'; // Madhya (reset)
    } else if (node.classList && node.classList.contains('notation-cell')) {
      // If the cell itself is selected instead of text inside
      if (id === 'formatMandra') node.className = 'notation-cell bhat-mandra';
      else if (id === 'formatTaar') node.className = 'notation-cell bhat-taar';
      else if (id === 'formatKomal') node.className = 'notation-cell bhat-komal';
      else if (id === 'formatTivra') node.className = 'notation-cell bhat-tivra';
      else if (id === 'formatDouble') node.style.textDecoration = 'underline';
      else node.className = 'notation-cell';
    }
  });
});

// Audio synthesis for notation
function playTone(hz, time, duration) {
  const osc = notationAudioCtx.createOscillator();
  const gain = notationAudioCtx.createGain();
  
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz, time);
  
  // Basic envelope
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.3, time + 0.05);
  gain.gain.setValueAtTime(0.3, time + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, time + duration);
  
  osc.connect(gain);
  gain.connect(notationAudioCtx.destination);
  
  osc.start(time);
  osc.stop(time + duration);
}

const SWARA_RATIOS = {
  'S': 1.0, 'r': 1.059, 'R': 1.122, 'g': 1.189, 'G': 1.260,
  'm': 1.335, 'M': 1.414, 'P': 1.498, 'd': 1.587, 'D': 1.682,
  'n': 1.782, 'N': 1.888, '-': 0
};

function notationNextNote() {
  const bpm = parseFloat(document.getElementById('notationBpm').value) || 120;
  const secondsPerBeat = 60.0 / bpm;
  
  notationNextNoteTime += secondsPerBeat;
  notationCurrentCol++;
  
  const cols = parseInt(document.getElementById('notationTaal').value);
  if (notationCurrentCol >= cols) {
    notationCurrentCol = 0;
  }
}

function notationScheduleNote(col, time) {
  const basePitch = parseFloat(document.getElementById('notationPitch').value);
  const secondsPerBeat = 60.0 / (parseFloat(document.getElementById('notationBpm').value) || 120);
  
  // Clear visual highlights
  document.querySelectorAll('.notation-cell').forEach(c => c.classList.remove('playing'));
  
  let noteToPlay = '';
  let cellClass = '';
  
  for (let r = 0; r < notationGrid.length; r++) {
    const cell = notationGrid[r][col];
    setTimeout(() => cell.classList.add('playing'), Math.max(0, (time - notationAudioCtx.currentTime)*1000));
    setTimeout(() => cell.classList.remove('playing'), Math.max(0, (time - notationAudioCtx.currentTime)*1000 + (secondsPerBeat*1000)));
    
    if (!noteToPlay && cell.textContent.trim() !== '') {
      noteToPlay = cell.textContent.trim();
      cellClass = cell.className;
    }
  }
  
  if (noteToPlay) {
    const s = noteToPlay.charAt(0);
    let ratio = SWARA_RATIOS[s] || 0;
    
    if (ratio > 0) {
      if (cellClass.includes('bhat-mandra')) ratio *= 0.5;
      if (cellClass.includes('bhat-taar')) ratio *= 2.0;
      if (cellClass.includes('bhat-komal')) ratio *= 0.943; 
      
      playTone(basePitch * ratio, time, secondsPerBeat * 0.9);
    }
  }
}

function notationScheduler() {
  while (notationNextNoteTime < notationAudioCtx.currentTime + notationScheduleAheadTime) {
    notationScheduleNote(notationCurrentCol, notationNextNoteTime);
    notationNextNote();
  }
  notationTimerID = setTimeout(notationScheduler, notationLookahead);
}

document.getElementById('notationPlayBtn')?.addEventListener('click', () => {
  if (notationAudioCtx.state === 'suspended') notationAudioCtx.resume();
  
  if (notationPlaying) {
    clearTimeout(notationTimerID);
    notationPlaying = false;
    document.getElementById('notationPlayBtn').textContent = 'PLAY';
    document.querySelectorAll('.notation-cell').forEach(c => c.classList.remove('playing'));
  } else {
    notationCurrentCol = 0;
    notationNextNoteTime = notationAudioCtx.currentTime + 0.1;
    notationScheduler();
    notationPlaying = true;
    document.getElementById('notationPlayBtn').textContent = 'STOP';
  }
});

document.getElementById('notationTitle')?.addEventListener('input', (e) => {
  document.getElementById('docTitleDisplay').textContent = e.target.value;
});

// PDF Export
document.getElementById('notationExportBtn')?.addEventListener('click', () => {
  const element = document.getElementById('notationDocument');
  if (typeof html2pdf !== 'undefined') {
      html2pdf().from(element).save(document.getElementById('notationTitle').value + '.pdf');
  } else {
      alert("html2pdf library is still loading, please try again in a moment.");
  }
});

"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\app.js')
with target.open('a', encoding='utf-8') as f:
    f.write("\n" + js_code)
