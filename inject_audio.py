import pathlib

audio_js = """
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
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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

function playTone(freq, type='sine', duration=0.4, startTime=audioCtx.currentTime) {
  if (!freq) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  
  // Envelope to prevent clicking
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
  gain.gain.linearRampToValueAtTime(0, startTime + duration - 0.05);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playTablaHit(bol, startTime=audioCtx.currentTime) {
  // Simple synthetic drums for Tabla bols based on the bol text
  let isBass = /dha|dhin|dhun|ge/i.test(bol) || /धा|धिन|धुन|गे/.test(bol);
  let isSnare = /ta|tin|na|te|ti|ki/i.test(bol) || /ता|तिन|ना|ते|ती|की/.test(bol);
  
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
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const BPM = 120;
  const matraDuration = 60 / BPM;
  let time = audioCtx.currentTime + 0.1; // start slightly in the future
  
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
      if (content && content !== '-') {
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
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\notation.js')
content = target.read_text(encoding='utf-8')

if "NOTATION STUDIO - AUDIO ENGINE & PALUSKAR RENDERING (PHASE 4)" not in content:
    target.write_text(content + "\n" + audio_js, encoding='utf-8')
    print("Injected Phase 4 JS (Audio & Paluskar).")
else:
    print("Phase 4 JS already present.")
