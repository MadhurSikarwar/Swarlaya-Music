/**
 * Lehra Studio — app.js
 *
 * AUDIO ARCHITECTURE (matching Android LehraApp / LehraAudioEngineWrapper):
 * ─────────────────────────────────────────────────────────────────────────
 * The native Android app:
 *   1. Pre-decodes all .aac → .wav files at startup (LehraResourceLoader.java)
 *   2. Feeds raw WAV samples into the C++ engine via ProcessAudioNative()
 *   3. Engine does internal time-stretching + pitch shifting in C++
 *   4. pitchCoeff = TuningCoeff × (146.83 / selectedHz) applied at sample level
 *
 * Our web equivalent (zero phase vocoder — zero buzz):
 *   1. Python server pre-processes audio with librosa.effects.pitch_shift()
 *   2. Client fetches pre-pitched WAV from /api/audio?file=X&hz=Y
 *   3. AudioBufferSourceNode plays at playbackRate = bpm / presetBpm ONLY
 *   4. NO Tone.js, NO PitchShift node, NO phase vocoder artifacts
 *
 * The only rate change is for tempo, which the native engine also does.
 * This is exactly how the app sounds.
 *
 * PITCH TABLE (UIMain.java pitchRecords array):
 *   F#=92.5  G=98.0  G#=103.83  A=110.0  A#=116.54  B=123.47
 *   C=130.81  C#=138.59  D=146.83(base)  D#=155.56  E=164.81  F=174.61
 *   F#hi=185.0  Ghi=196.0
 */

'use strict';

const $ = id => document.getElementById(id);

// ── Base pitch (the pitch all recordings were made at) ──────────
const BASE_HZ = 146.83; // D

// ── App State ───────────────────────────────────────────────────
const state = {
  instrument: null,
  taal: null,
  taalData: null,
  raag: null,
  bpm: 90,
  isPlaying: false,
  isLooping: true,
  pitchHz: BASE_HZ,
  metronomeSubdivision: 1,

  // Beat / Matra tracking
  beatIndex: 0,
  matraCount: 0,

  // Tap tempo
  tapTimes: [],

  // Waveform
  waveFrame: null,

  // Options
  metronomeEnabled: false,
  metronomeSound: 'classic',
  // true = Sam/Taali loud, Khali softer (recommended for riyaz)
  // false = flat uniform click on every beat
  metronomeAccents: true,
  wakeLockEnabled: true,

  // Riyaz
  riyazStart: 0,
};

// ── Web Audio (pure, no Tone.js) ─────────────────────────────────
let audioCtx = null;
let gainLehra = null;
let masterCompressor = null;

// Studio FX Nodes
let fxMasterMix = null;
let filterBass = null;
let filterTreble = null;
let reverbNode = null;
let dryGainNode = null;
let wetGainNode = null;
let analyserNode = null;

let gainTanpura = null;

// Current playing source
let lehraBuffer = null;      // decoded AudioBuffer (cached per URL)
let lehraBufferUrl = null;   // the URL it was fetched from
let lehraSource = null;      // current AudioBufferSourceNode
let activeSegment = null;    // { presetBpm, start, duration, end }
let isLoading = false;
let loadedBpm = null;        // The BPM the currently loaded buffer was perfectly stretched to
let debounceTimer = null;
let lehraFetchId = 0;

// Tanpura
let tanpuraBuffer = null;
let tanpuraBufferHz = null;
let tanpuraSource = null;
let tanpuraFetchId = 0;

let gainMetronome = null;
let metronomeBuffer = null;
let metronomeUpBuffer = null;

// Scheduler
let timerWorker = null;
let lookahead = 25.0; // ms
let scheduleAheadTime = 0.1; // s
let nextNoteTime = 0.0;
let currentBeatInBar = 0;
let currentSubBeat = 0;
let notesInQueue = [];
let drawBeatLoopFrame = null;

// Tanpura (simple <audio> element — no processing needed, kept for compatibility but no longer used for playback)
const tanpuraEl = $('tanpuraAudio');

// Canvas
const canvas = $('waveCanvas');
const ctx2d = canvas ? canvas.getContext('2d') : null;

function generateReverbIR(ctx, duration=2, decay=2.0) {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const n = Math.pow(1 - i / length, decay);
    left[i] = (Math.random() * 2 - 1) * n;
    right[i] = (Math.random() * 2 - 1) * n;
  }
  return impulse;
}

// ── Ensure Audio Context ─────────────────────────────────────────
async function ensureAudioCtx() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  document.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }, { capture: true });

  // FX Chain setup
  fxMasterMix = audioCtx.createGain();
  filterBass = audioCtx.createBiquadFilter();
  filterBass.type = 'lowshelf';
  filterBass.frequency.value = 200;
  
  filterTreble = audioCtx.createBiquadFilter();
  filterTreble.type = 'highshelf';
  filterTreble.frequency.value = 3000;

  reverbNode = audioCtx.createConvolver();
  reverbNode.buffer = generateReverbIR(audioCtx, 2.5, 3.0);
  
  dryGainNode = audioCtx.createGain();
  dryGainNode.gain.value = 1;
  wetGainNode = audioCtx.createGain();
  wetGainNode.gain.value = 0;

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;

  // Master compressor
  masterCompressor = audioCtx.createDynamicsCompressor();
  masterCompressor.threshold.setValueAtTime(-15, audioCtx.currentTime);
  masterCompressor.knee.setValueAtTime(20, audioCtx.currentTime);
  masterCompressor.ratio.setValueAtTime(10, audioCtx.currentTime);
  masterCompressor.attack.setValueAtTime(0.005, audioCtx.currentTime);
  masterCompressor.release.setValueAtTime(0.1, audioCtx.currentTime);

  if (!timerWorker) {
    const workerCode = `
      let timerID = null;
      self.onmessage = function(e) {
        if (e.data === "start") {
          timerID = setInterval(function() { postMessage("tick"); }, 25);
        } else if (e.data === "stop") {
          clearInterval(timerID);
          timerID = null;
        }
      };
    `;
    const blob = new Blob([workerCode], {type: "application/javascript"});
    timerWorker = new Worker(URL.createObjectURL(blob));
    timerWorker.onmessage = function(e) {
      if (e.data === "tick") schedulerTick();
    };
  }

  // Routing — reverb bypass: don't connect reverbNode yet, it connects
  // only when the user raises the reverb slider above 0.
  // fxMasterMix -> Bass -> Treble -> Dry path
  fxMasterMix.connect(filterBass);
  filterBass.connect(filterTreble);
  
  // Dry path only at startup (reverb is 0%)
  filterTreble.connect(dryGainNode);
  // Note: filterTreble.connect(reverbNode) happens lazily in fxReverb handler
  
  // Recombine into Compressor -> Analyser -> Destination
  dryGainNode.connect(masterCompressor);
  wetGainNode.connect(masterCompressor);
  masterCompressor.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);

  // Lehra and Tanpura -> fxMasterMix
  gainLehra = audioCtx.createGain();
  gainLehra.gain.value = 0.8;
  gainLehra.connect(fxMasterMix);

  gainTanpura = audioCtx.createGain();
  gainTanpura.gain.value = 0.5;
  gainTanpura.connect(fxMasterMix);

  // Metronome chain bypasses FX
  gainMetronome = audioCtx.createGain();
  gainMetronome.gain.value = 0.6;
  gainMetronome.connect(audioCtx.destination);

  if (!metronomeBuffer) {
    fetch('/assets/Metronome.aac').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(d => metronomeBuffer = d).catch(console.error);
    fetch('/assets/MetronomeUp.aac').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(d => metronomeUpBuffer = d).catch(console.error);
  }
}

// ── Visualizer ─────────────────────────────────────────────────────
let visualizerRunning = false;
function startVisualizer() {
  if (!analyserNode || visualizerRunning) return;
  const data = new Uint8Array(analyserNode.frequencyBinCount);
  const mandala = document.querySelector('.np-mandala');
  
  visualizerRunning = true;
  function loop() {
    if (!state.isPlaying) {
      if (mandala) mandala.style.transform = 'scale(1)';
      visualizerRunning = false;
      return;
    }
    analyserNode.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;
    
    if (mandala) {
      const scale = 1 + (avg / 255) * 0.18; 
      mandala.style.transform = `scale(${scale})`;
    }
    requestAnimationFrame(loop);
  }
  loop();
}

// ── Wake Lock ──────────────────────────────────────────────────────
let wakeLock = null;

async function requestWakeLock() {
  if (!state.wakeLockEnabled) return;
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.error('Wake Lock error:', err);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible' && state.isPlaying) {
    requestWakeLock();
  }
});

// ── Metronome ─────────────────────────────────────────────────────
function scheduleMetronome(time, beatIndex, subBeat = 0) {
  if (!state.metronomeEnabled) return;
  
  const matra = beatIndex + 1;
  const isSam   = matra === 1;
  const isKhali = state.taalData?.khali?.includes(matra);
  const isTaali = state.taalData?.taali?.includes(matra);

  // When accents are OFF: every beat is treated as a plain beat regardless
  // of its taal position. Sam, Khali, and Taali all sound identical.
  const useAccents = state.metronomeAccents;
  // Sam (beat 1) is ALWAYS accented — it marks the top of the cycle.
  // Only Taali/Khali differentiation is suppressed when accents are off.
  const effectiveSam   = isSam;                   // always loud on 1
  const effectiveTaali = useAccents && isTaali;
  const effectiveKhali = useAccents && isKhali;
  
  if (state.metronomeSound === 'classic') {
    if (!metronomeBuffer || !metronomeUpBuffer) return;
    const src = audioCtx.createBufferSource();
    src.buffer = (subBeat === 0 && (effectiveSam || effectiveTaali)) ? metronomeUpBuffer : metronomeBuffer;
    
    const srcGain = audioCtx.createGain();
    if (subBeat > 0) srcGain.gain.value = 0.3;
    else if (effectiveKhali) srcGain.gain.value = 0.4;
    else srcGain.gain.value = 1.0;
    
    src.connect(srcGain);
    srcGain.connect(gainMetronome);
    src.start(time);
  } else if (state.metronomeSound === 'beep') {
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = 'sine';
    
    let freq = 440;
    if (subBeat > 0)         freq = 600;
    else if (effectiveSam)   freq = 880;
    else if (effectiveTaali) freq = 660;
    else if (effectiveKhali) freq = 330;
    
    osc.frequency.value = freq;
    
    let vol = 1;
    if (subBeat > 0)         vol = 0.3;
    else if (effectiveKhali) vol = 0.5;
    
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vol, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(env);
    env.connect(gainMetronome);
    osc.start(time);
    osc.stop(time + 0.1);
  } else if (state.metronomeSound === 'woodblock') {
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = 'triangle';
    
    let freq = 800;
    if (subBeat > 0)         freq = 600;
    else if (effectiveSam)   freq = 1000;
    else if (effectiveTaali) freq = 900;
    else if (effectiveKhali) freq = 700;
    
    osc.frequency.value = freq;
    
    let vol = 1;
    if (subBeat > 0)         vol = 0.4;
    else if (effectiveKhali) vol = 0.6;
    
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vol, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(env);
    env.connect(gainMetronome);
    osc.start(time);
    osc.stop(time + 0.05);
  }
}

// ── Volume Sliders ───────────────────────────────────────────────
function initVolumeSliders() {
  const lv = $('lehraVol');
  const tv = $('tanpuraVol');

  lv.addEventListener('input', e => {
    const v = +e.target.value;
    if (gainLehra) gainLehra.gain.setTargetAtTime(v / 100, audioCtx.currentTime, 0.02);
    $('lehraVolVal').textContent = v + '%';
    lv.style.setProperty('--val', v + '%');
  });
  lv.style.setProperty('--val', '80%');

  tv.addEventListener('input', e => {
    const v = +e.target.value;
    if (gainTanpura) gainTanpura.gain.setTargetAtTime(v / 100, audioCtx.currentTime, 0.02);
    $('tanpuraVolVal').textContent = v + '%';
    tv.style.setProperty('--val', v + '%');
  });
  tv.style.setProperty('--val', '50%');

  const mv = $('metronomeVol');
  mv.addEventListener('input', e => {
    const v = +e.target.value;
    if (gainMetronome) gainMetronome.gain.setTargetAtTime(v / 100, audioCtx.currentTime, 0.02);
    $('metronomeVolVal').textContent = v + '%';
    mv.style.setProperty('--val', v + '%');
  });
  mv.style.setProperty('--val', '60%');

  // Allow pitch-shifting for Tanpura
  tanpuraEl.preservesPitch = false;
  tanpuraEl.mozPreservesPitch = false;
  tanpuraEl.webkitPreservesPitch = false;
}

// ── Riyaz Tracker ──────────────────────────────────────────────────
function saveRiyazTime(seconds) {
  if (seconds <= 0) return;
  const dateStr = new Date().toISOString().split('T')[0];
  const key = `lehra_riyaz_${dateStr}`;
  let current = parseInt(localStorage.getItem(key) || '0', 10);
  localStorage.setItem(key, current + seconds);
}

function processRiyazSession() {
  if (state.riyazStart > 0) {
    const duration = Math.round((Date.now() - state.riyazStart) / 1000);
    saveRiyazTime(duration);
    state.riyazStart = 0;
  }
}

function renderStats() {
  const chart = $('statsChart');
  if (!chart) return;
  chart.innerHTML = '';
  let totalToday = 0;
  
  const bars = [];
  for (let i=6; i>=0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const secs = parseInt(localStorage.getItem(`lehra_riyaz_${ds}`) || '0', 10);
    bars.push({ date: d.toLocaleDateString('en-US', {weekday:'short'}), secs, isToday: i===0 });
    if (i===0) totalToday = secs;
  }
  
  const maxSecs = Math.max(...bars.map(b => b.secs), 60); 
  
  bars.forEach(b => {
    const heightPct = (b.secs / maxSecs) * 100;
    chart.innerHTML += `
      <div class="stat-bar-container">
        <div class="stat-bar" style="height: ${Math.max(2, heightPct)}%; opacity: ${b.isToday ? '1':'0.7'};"></div>
        <div class="stat-label">${b.date}</div>
      </div>
    `;
  });
  
  const minToday = Math.round(totalToday / 60);
  $('statsTotalToday').textContent = minToday + (minToday === 1 ? ' min' : ' mins');
}

// ── Pitch Select & Fine Tune ───────────────────────────────────────
async function updateTanpuraPitch() {
  if (!audioCtx) return; // Will load when play starts
  if (tanpuraBufferHz === state.pitchHz) return;
  const currentFetchId = ++tanpuraFetchId;
  const url = `/api/tanpura?hz=${state.pitchHz.toFixed(6)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    const arrayBuf = await res.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    applyQuickFades(decoded);
    if (currentFetchId !== tanpuraFetchId) return;
    tanpuraBuffer = decoded;
    tanpuraBufferHz = state.pitchHz;
    if (state.isPlaying) {
      playTanpuraSource();
    }
  } catch (err) {
    console.error('Tanpura load error:', err);
  }
}

function playTanpuraSource() {
  if (tanpuraSource) {
    try { tanpuraSource.stop(0); } catch (_) { }
    try { tanpuraSource.disconnect(); } catch (_) { }
    tanpuraSource = null;
  }
  if (!tanpuraBuffer || !state.isPlaying) return;
  const src = audioCtx.createBufferSource();
  src.buffer = tanpuraBuffer;
  src.loop = true;
  src.connect(gainTanpura);
  src.start(0);
  tanpuraSource = src;
}

$('pitchSelect').addEventListener('change', async () => {
  const newHz = parseFloat($('pitchSelect').value);
  if (newHz === state.pitchHz) return;
  state.pitchHz = newHz;
  $('fineTuneHz').value = newHz.toFixed(2); // sync fine tune input

  const sel = $('pitchSelect');
  const label = sel.options[sel.selectedIndex].text.replace(' (Original)', '').replace('(Original)', '');
  $('tagPitch').textContent = label;
  $('tagPitch').classList.toggle('active', true);

  updateTanpuraPitch();

  if (state.isPlaying && state.raag) {
    await reloadAudio();
  }
});

let fineTuneDebounce = null;
$('fineTuneHz').addEventListener('input', (e) => {
  let val = parseFloat(e.target.value);
  if (isNaN(val)) return;

  // Bound to reasonable Hz range (e.g., 60Hz to 300Hz)
  if (val < 60) val = 60;
  if (val > 300) val = 300;

  state.pitchHz = val;
  $('tagPitch').textContent = 'Custom ' + val.toFixed(1) + 'Hz';
  $('tagPitch').classList.toggle('active', true);

  updateTanpuraPitch();

  // Debounce the audio reload so it doesn't spam the server
  clearTimeout(fineTuneDebounce);
  fineTuneDebounce = setTimeout(async () => {
    if (state.isPlaying && state.raag) {
      await reloadAudio();
    }
  }, 600);
});

// ── Audio URL ────────────────────────────────────────────────────
// NOTE on TuningCoeff (matches Android LehraApp / LehraAudioEngineWrapper):
// Each instrument's recordings were made at (146.83 × tuningCoeff) Hz, not
// plain 146.83 Hz.  The Android C++ engine compensates via SetLehraParams.
// We replicate that by sending hz = pitchHz / tuningCoeff to the server so
// it shifts from the recording's actual base pitch to the desired scale.
// Tanpura (tanpura_06_01.wav) is always at D=146.83 Hz — no correction needed there.
function getEffectiveLehraHz() {
  const tuningCoeff = CATALOGUE[state.instrument]?.tuningCoeff ?? 1.0;
  return state.pitchHz / tuningCoeff;
}

function getAudioUrl() {
  if (!state.instrument || !state.taal || !state.raag || !state.taalData) return null;
  const raagData = CATALOGUE[state.instrument]?.taals[state.taal]?.raags[state.raag];
  if (!raagData?.file) return null;

  const segments = computeSegments(state.taalData);
  const seg = closestSegment(state.bpm, segments);
  const stretch = state.bpm / seg.presetBpm;
  const effectiveHz = getEffectiveLehraHz();

  // Request 50ms of extra audio for seamlessly crossfading the loop boundary
  const fadeSec = 0.05;
  const reqEnd = seg.end + (fadeSec * stretch);

  return `/api/audio?file=${encodeURIComponent(raagData.file)}&hz=${effectiveHz.toFixed(6)}&start=${seg.start}&end=${reqEnd}&stretch=${stretch}`;
}

// ── Compute segment layout from taalData ─────────────────────────
// Each preset tempo maps to a segment in the audio file.
// Duration of each segment = (beats × 60 / presetBpm) seconds.
function computeSegments(taalData) {
  const segments = [];
  let t = 0;
  for (const presetBpm of taalData.tempos) {
    const dur = (taalData.beats * 60) / presetBpm;
    segments.push({ presetBpm, start: t, duration: dur, end: t + dur });
    t += dur;
  }
  return segments;
}

function closestSegment(bpm, segments) {
  return segments.reduce((best, seg) =>
    Math.abs(seg.presetBpm - bpm) < Math.abs(best.presetBpm - bpm) ? seg : best
  );
}

// ── Audio Cache (IndexedDB) ───────────────────────────────────────
const dbName = 'lehra-audio-cache';
const storeName = 'audio-buffers';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(storeName);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedAudio(url) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function cacheAudio(url, arrayBuffer) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(arrayBuffer, url);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("Failed to cache audio:", e);
  }
}

// ── Fetch + Decode audio ──────────────────────────────────────────
async function fetchAndDecode(url, targetDurSec) {
  setStatus('Processing audio…', 'loading');
  setBadge('Processing…', true);

  const cachedBuf = await getCachedAudio(url);
  if (cachedBuf) {
    setStatus('Decoding audio…', 'loading');
    const copy = cachedBuf.slice(0); // slice prevents detaching the cached original
    const decoded = await audioCtx.decodeAudioData(copy);
    return applySeamlessFold(decoded, targetDurSec);
  }

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  setStatus('Decoding audio…', 'loading');
  const arrayBuf = await res.arrayBuffer();
  
  if (arrayBuf.byteLength === 0) {
      throw new Error("Received empty audio buffer from server");
  }
  
  const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
  
  // Cache ONLY if decode succeeds
  await cacheAudio(url, arrayBuf);
  
  return applySeamlessFold(decoded, targetDurSec);
}

function applySeamlessFold(audioBuffer, targetDurSec) {
  if (!targetDurSec) {
    applyQuickFades(audioBuffer, 15);
    return audioBuffer;
  }
  
  const sampleRate = audioBuffer.sampleRate;
  const targetLen = Math.floor(targetDurSec * sampleRate);
  const fadeSamples = audioBuffer.length - targetLen;
  
  if (fadeSamples <= 100) {
    applyQuickFades(audioBuffer, 15);
    return audioBuffer;
  }

  const newBuffer = audioCtx.createBuffer(
    audioBuffer.numberOfChannels,
    targetLen,
    sampleRate
  );

  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const origData = audioBuffer.getChannelData(c);
    const newData = newBuffer.getChannelData(c);
    
    for (let i = fadeSamples; i < targetLen; i++) {
      newData[i] = origData[i];
    }
    
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / fadeSamples;
      const fadeIn = Math.sin(t * (Math.PI / 2));
      const fadeOut = Math.cos(t * (Math.PI / 2));
      
      const startSample = origData[i];
      const tailSample = origData[targetLen + i];
      
      newData[i] = startSample * fadeIn + tailSample * fadeOut;
    }
  }
  return newBuffer;
}

function applyQuickFades(audioBuffer, fadeMs = 15) {
  const sampleRate = audioBuffer.sampleRate;
  const fadeSamples = Math.floor((fadeMs / 1000) * sampleRate);
  if (fadeSamples * 2 > audioBuffer.length) return;
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    const len = data.length;
    for (let i = 0; i < fadeSamples; i++) {
      const t = Math.sin((i / fadeSamples) * (Math.PI / 2));
      data[i] *= t;
      data[len - 1 - i] *= t;
    }
  }
}

// ── Create and start source node ─────────────────────────────────
function stopLehraSource(fadeOutMs = 0) {
  if (lehraSource) {
    const s = lehraSource;
    const g = s.customGain;
    lehraSource = null;

    if (fadeOutMs > 0 && g) {
      g.gain.setValueAtTime(g.gain.value, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + (fadeOutMs / 1000));
      setTimeout(() => {
        try { s.stop(0); s.disconnect(); g.disconnect(); } catch (_) { }
      }, fadeOutMs + 10);
    } else {
      try { s.stop(0); s.disconnect(); if (g) g.disconnect(); } catch (_) { }
    }
  }
}

function createSource(buffer, fadeInMs = 0) {
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.loop = state.isLooping;

  // perfectly stretched by server
  src.playbackRate.value = 1.0;

  const srcGain = audioCtx.createGain();
  if (fadeInMs > 0) {
    srcGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    srcGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + (fadeInMs / 1000));
  } else {
    srcGain.gain.value = 1;
  }

  src.connect(srcGain);
  srcGain.connect(gainLehra);
  src.start(0);

  src.onended = () => {
    if (!state.isLooping && state.isPlaying) {
      state.isPlaying = false;
      onStopped();
    }
  };

  lehraSource = src;
  lehraSource.customGain = srcGain;
}

async function loadAndPlay() {
  if (!state.raag || !state.taalData) {
    setStatus('Select instrument → taal → raag first', '');
    return;
  }

  await ensureAudioCtx();
  const url = getAudioUrl();
  if (!url) { setStatus('Could not resolve audio path', ''); return; }

  stopLehraSource();
  isLoading = true;
  const currentFetchId = ++lehraFetchId;

  try {
    if (lehraBuffer && lehraBufferUrl === url) {
      // Cache hit — play immediately
      createSource(lehraBuffer);
    } else {
      lehraBuffer = null;
      lehraBufferUrl = null;
      const targetDurSec = (state.taalData.beats * 60) / state.bpm;
      const buffer = await fetchAndDecode(url, targetDurSec);
      if (currentFetchId !== lehraFetchId) return; // request overridden
      lehraBuffer = buffer;
      lehraBufferUrl = url;
      loadedBpm = state.bpm;
      createSource(lehraBuffer);
    }

    state.isPlaying = true;
    showPause();
    startWaveform();
    startScheduler();
    $('nowPlayingCard').classList.add('playing');
    await updateTanpuraPitch(); // Ensure tanpura buffer is loaded
    playTanpuraSource();
    requestWakeLock();
    state.riyazStart = Date.now();
    setStatus(`Playing: ${state.raag} · ${state.instrument} · ${state.bpm} BPM`, 'playing');
    setBadge('Playing', false);
    $('infoDot').className = 'info-dot playing';
    updateBeatTiming();
    startVisualizer();
    showMatraRow(true);

  } catch (err) {
    if (currentFetchId !== lehraFetchId) return; // Ignore errors from overridden requests
    console.error('Audio load error:', err);
    setStatus('Audio error: ' + err.message, '');
    setBadge('Error', false);
    state.isPlaying = false;
    showPlay();
  }
  if (currentFetchId === lehraFetchId) {
    isLoading = false;
  }
}

async function reloadAudio() {
  if (!state.isPlaying) return;
  const oldPos = lehraSource ? (audioCtx.currentTime) : 0;
  stopLehraSource();
  lehraBuffer = null;
  lehraBufferUrl = null;
  await loadAndPlay();
}

function pausePlayback() {
  if (!state.isPlaying) return;
  state.isPlaying = false;
  processRiyazSession();
  if (lehraSource) { lehraSource.stop(); lehraSource.disconnect(); lehraSource = null; }
  if (tanpuraSource) { tanpuraSource.stop(); tanpuraSource.disconnect(); tanpuraSource = null; }
  showPlay();
  stopScheduler();
  $('nowPlayingCard').classList.remove('playing');
  releaseWakeLock();
  $('infoDot').className = 'info-dot';
  setStatus('Paused', '');
}

function stopPlayback() {
  state.isPlaying = false;
  processRiyazSession();
  if (lehraSource) { lehraSource.stop(); lehraSource.disconnect(); lehraSource = null; }
  if (tanpuraSource) { tanpuraSource.stop(); tanpuraSource.disconnect(); tanpuraSource = null; }
  state.beatIndex = 0;
  showPlay();
  stopScheduler();
  clearWaveform();
  $('nowPlayingCard').classList.remove('playing');
  releaseWakeLock();
  $('infoDot').className = 'info-dot';
  setStatus('Stopped', '');
  setBadge('Web Player', false);
  updateMatraDisplay(0, state.taalData?.beats || 0);
}

function onStopped() {
  stopScheduler();
  clearWaveform();
  showPlay();
  $('nowPlayingCard').classList.remove('playing');
  $('infoDot').className = 'info-dot';
  setStatus('Ready', '');
}

async function togglePlay() {
  if (isLoading) {
    lehraFetchId++; // abort pending load
    isLoading = false;
    showPlay();
    setStatus('Ready', '');
    return;
  }
  if (state.isPlaying) {
    pausePlayback();
  } else {
    await loadAndPlay();
  }
}

// ── Apply tempo change ────────────────────────────────────────────
function applyTempoChange() {
  if (!state.isPlaying || !lehraBuffer || !state.taalData || !loadedBpm) return;

  // We DO NOT use playbackRate here because it changes pitch (the chipmunk effect).
  // The user explicitly requested to remove the temporary pitch spike.
  // Instead, we just wait for the server to provide the perfectly stretched loop.

  // 2. Debounce fetch for PERFECT loop (time-stretched on server, pitch preserved)
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    if (state.bpm === loadedBpm || !state.isPlaying) return;

    const url = getAudioUrl();
    if (url === lehraBufferUrl) return;

    const currentFetchId = ++lehraFetchId;

    try {
      const targetDurSec = (state.taalData.beats * 60) / state.bpm;
      const buffer = await fetchAndDecode(url, targetDurSec); // fetches in background!
      if (currentFetchId !== lehraFetchId || !state.isPlaying) return;

      const oldSource = lehraSource; // capture just before hot-swapping

      // Hot-swap
      lehraBuffer = buffer;
      lehraBufferUrl = url;
      loadedBpm = state.bpm;

      createSource(buffer, 50); // 50ms smooth fade-in
      if (oldSource) {
        const g = oldSource.customGain;
        if (g) {
          g.gain.setValueAtTime(g.gain.value, audioCtx.currentTime);
          g.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
          setTimeout(() => {
            try { oldSource.stop(0); oldSource.disconnect(); g.disconnect(); } catch (_) { }
          }, 60);
        } else {
          try { oldSource.stop(0); oldSource.disconnect(); } catch (_) { }
        }
      }

      // Sync beats gracefully without fully resetting the UI flash
      updateBeatTiming();
      setStatus(`Playing: ${state.raag} · ${state.instrument} · ${state.bpm} BPM`, 'playing');
    } catch (err) {
      if (currentFetchId !== lehraFetchId) return;
      console.error("Perfect loop swap failed", err);
    }
  }, 400); // Wait 400ms after user stops dragging
}

// ── Instrument Rendering ─────────────────────────────────────────
function renderInstruments() {
  const list = $('instrumentList');
  list.innerHTML = '';
  Object.entries(CATALOGUE).forEach(([name, data]) => {
    const btn = document.createElement('button');
    btn.className = 'selector-btn';
    const tc = Object.keys(data.taals).length;
    btn.innerHTML = `<span>${name}</span><span class="btn-badge">${tc} taal${tc !== 1 ? 's' : ''}</span>`;
    btn.addEventListener('click', () => selectInstrument(name, btn));
    list.appendChild(btn);
  });
}

function selectInstrument(name, btn) {
  state.instrument = name;
  state.taal = null; state.taalData = null; state.raag = null;
  document.querySelectorAll('#instrumentList .selector-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTaals();
  $('raagList').innerHTML = '<p class="empty-hint">← Select a taal first</p>';
  clearTempoPanel();
  updateNowPlaying();
  renderBeatDots(0);
  updateMatraDisplay(0, 0);
  showMatraRow(false);
}

// ── Taal Rendering ────────────────────────────────────────────────
function renderTaals() {
  const list = $('taalList');
  list.innerHTML = '';
  Object.entries(CATALOGUE[state.instrument].taals).forEach(([name, data]) => {
    const btn = document.createElement('button');
    btn.className = 'selector-btn';
    btn.innerHTML = `<span>${name}</span><span class="btn-badge">${data.beats} beats</span>`;
    btn.addEventListener('click', () => selectTaal(name, data, btn));
    list.appendChild(btn);
  });
}

function selectTaal(name, data, btn) {
  state.taal = name; state.taalData = data; state.raag = null;
  document.querySelectorAll('#taalList .selector-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRaags(data.raags);
  clearTempoPanel();
  renderBeatDots(data.beats);
  updateNowPlaying();
  updateMatraDisplay(0, data.beats);
  $('matraTotal').textContent = data.beats;
}

// ── Raag Rendering ────────────────────────────────────────────────
function renderRaags(raags) {
  const list = $('raagList');
  list.innerHTML = '';
  Object.keys(raags).forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'selector-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => selectRaag(name, btn));
    list.appendChild(btn);
  });
}

function selectRaag(name, btn) {
  state.raag = name;
  document.querySelectorAll('#raagList .selector-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.bpm = state.taalData.tempos[0];
  buildTempoPanel(state.taalData);
  updateNowPlaying();
  if (state.isPlaying) {
    lehraBuffer = null; lehraBufferUrl = null;
    loadAndPlay();
  }
}

// ── Tempo Panel ───────────────────────────────────────────────────
function clearTempoPanel() {
  $('tempoPills').innerHTML = '<p class="empty-hint">Select instrument → taal → raag</p>';
  $('tempoSliderWrap').style.display = 'none';
  $('tempoValue').textContent = '—';
  $('tempoRangeLabel').textContent = '';
  $('sliderTicks').innerHTML = '';
}

function buildTempoPanel(taalData) {
  const { tempos, minTempo, maxTempo } = taalData;
  $('tempoRangeLabel').textContent = `${minTempo}–${maxTempo} BPM`;

  const pills = $('tempoPills');
  pills.innerHTML = '';
  tempos.forEach(t => {
    const pill = document.createElement('button');
    pill.className = 'tempo-preset-pill' + (t === state.bpm ? ' active' : '');
    pill.textContent = t;
    pill.dataset.bpm = t;
    pill.addEventListener('click', () => {
      setBpm(t);
      syncSlider();
      applyTempoChange();
    });
    pills.appendChild(pill);
  });

  $('tempoSliderWrap').style.display = '';
  buildSliderTicks(tempos, minTempo, maxTempo);
  syncSlider();

  // Sync the typed input range bounds when a new taal is selected
  const tvEl = $('tempoValue');
  if (tvEl) {
    tvEl.min = minTempo;
    tvEl.max = maxTempo;
    tvEl.value = state.bpm;
  }
}

function buildSliderTicks(tempos, minTempo, maxTempo) {
  const wrap = $('sliderTicks');
  wrap.innerHTML = '';
  wrap.style.position = 'relative'; wrap.style.height = '28px';
  const range = maxTempo - minTempo;
  tempos.forEach(t => {
    const tick = document.createElement('div');
    tick.className = 'slider-tick';
    tick.dataset.bpm = t;
    tick.style.position = 'absolute';
    tick.style.left = ((t - minTempo) / range * 100) + '%';
    tick.style.transform = 'translateX(-50%)';
    tick.innerHTML = `<div class="slider-tick-line"></div><div class="slider-tick-label">${t}</div>`;
    tick.addEventListener('click', () => { setBpm(t); syncSlider(); applyTempoChange(); });
    wrap.appendChild(tick);
  });
}

function setBpm(bpm) {
  if (!state.taalData) return;
  const { minTempo, maxTempo } = state.taalData;
  state.bpm = Math.max(minTempo, Math.min(maxTempo, Math.round(bpm)));
}

function bpmToProgress(bpm) {
  const { minTempo, maxTempo } = state.taalData;
  return (bpm - minTempo) / (maxTempo - minTempo) * 210;
}

function progressToBpm(progress) {
  const { minTempo, maxTempo } = state.taalData;
  return Math.round(minTempo + (progress / 210) * (maxTempo - minTempo));
}

function syncSlider() {
  if (!state.taalData) return;
  const progress = bpmToProgress(state.bpm);
  const slider = $('tempoSlider');
  slider.value = progress;
  slider.style.setProperty('--slider-pct', (progress / 210 * 100).toFixed(1) + '%');
  // tempoValue is now a <input type="number">, so use .value not .textContent
  const tvEl = $('tempoValue');
  if (tvEl) tvEl.value = state.bpm;

  const nearest = state.taalData.tempos.reduce((a, b) =>
    Math.abs(b - state.bpm) < Math.abs(a - state.bpm) ? b : a
  );
  document.querySelectorAll('.tempo-preset-pill').forEach(p =>
    p.classList.toggle('active', +p.dataset.bpm === nearest));
  document.querySelectorAll('.slider-tick').forEach(t =>
    t.classList.toggle('active', +t.dataset.bpm === nearest));
  updateNowPlaying();
}

// ── Tempo Slider Events ───────────────────────────────────────────
$('tempoSlider').addEventListener('input', e => {
  if (!state.taalData) return;
  setBpm(progressToBpm(+e.target.value));
  e.target.style.setProperty('--slider-pct', (+e.target.value / 210 * 100).toFixed(1) + '%');
  $('tempoValue').textContent = state.bpm;
  syncSlider();
  applyTempoChange();
});

$('bpmMinus').addEventListener('click', () => { if (state.taalData) { setBpm(state.bpm - 1); syncSlider(); applyTempoChange(); } });
$('bpmPlus').addEventListener('click', () => { if (state.taalData) { setBpm(state.bpm + 1); syncSlider(); applyTempoChange(); } });

// Long-press ±
function addLongPress(id, fn) {
  let iv = null;
  const el = $(id);
  const go = () => { fn(); iv = setInterval(fn, 80); };
  const stop = () => { clearInterval(iv); iv = null; };
  el.addEventListener('mousedown', go);
  el.addEventListener('mouseup', stop);
  el.addEventListener('mouseleave', stop);
  el.addEventListener('touchstart', e => { e.preventDefault(); go(); }, { passive: false });
  el.addEventListener('touchend', stop);
}
addLongPress('bpmMinus', () => { if (state.taalData) { setBpm(state.bpm - 1); syncSlider(); applyTempoChange(); } });
addLongPress('bpmPlus', () => { if (state.taalData) { setBpm(state.bpm + 1); syncSlider(); applyTempoChange(); } });

// ── Tap Tempo ──────────────────────────────────────────────────────
$('tapTempoBtn').addEventListener('click', () => {
  if (!state.taalData) return;
  const now = Date.now();
  const last = state.tapTimes[state.tapTimes.length - 1];
  if (!last || now - last > 2000) {
    state.tapTimes = [now];
    setStatus('Tap again to set tempo…', '');
    return;
  }
  if (now - last < 100) return;
  state.tapTimes.push(now);
  if (state.tapTimes.length > 6) state.tapTimes.shift();
  if (state.tapTimes.length >= 2) {
    let total = 0;
    for (let i = 1; i < state.tapTimes.length; i++) total += state.tapTimes[i] - state.tapTimes[i - 1];
    const bpm = Math.round(60000 / (total / (state.tapTimes.length - 1)));
    setBpm(bpm); syncSlider(); applyTempoChange();
    setStatus(`Tap tempo: ${state.bpm} BPM`, '');
  }
});

// ── Beat Flash ────────────────────────────────────────────────────
// Pre-built array of beat dot elements, populated in renderBeatDots.
// Avoids running querySelectorAll('.beat-dot') inside the 60fps drawBeatLoop.
let beatDotEls = [];

function renderBeatDots(beats) {
  const c = $('beatDots');
  c.innerHTML = '';
  state.beatIndex = 0;
  beatDotEls = []; // reset cache
  for (let i = 0; i < beats; i++) {
    const d = document.createElement('div');
    const matra = i + 1;
    let extraClass = '';
    if (matra === 1) extraClass = ' sam';
    else if (state.taalData?.taali?.includes(matra)) extraClass = ' taali';
    else if (state.taalData?.khali?.includes(matra)) extraClass = ' khali';
    
    d.className = 'beat-dot' + extraClass;
    d.id = `bd-${i}`;
    c.appendChild(d);
    beatDotEls.push(d); // cache reference
  }
}

function schedulerTick() {
  if (!state.isPlaying || !state.taalData || !audioCtx) return;
  const subDiv = state.metronomeSubdivision || 1;
  const subBeatLen = (60.0 / state.bpm) / subDiv;

  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    scheduleNote(currentBeatInBar, currentSubBeat, nextNoteTime);
    nextNoteTime += subBeatLen;
    currentSubBeat++;
    if (currentSubBeat >= subDiv) {
      currentSubBeat = 0;
      currentBeatInBar = (currentBeatInBar + 1) % state.taalData.beats;
    }
  }
}

function scheduleNote(beatNumber, subBeat, time) {
  if (subBeat === 0) {
    notesInQueue.push({ note: beatNumber, time: time });
  }
  scheduleMetronome(time, beatNumber, subBeat);
}

function startScheduler() {
  if (!state.taalData || !audioCtx) return;
  stopScheduler();
  notesInQueue = [];
  currentBeatInBar = 0;
  currentSubBeat = 0;
  nextNoteTime = audioCtx.currentTime + 0.05; // start shortly after
  if (timerWorker) timerWorker.postMessage("start");
  if (!drawBeatLoopFrame) drawBeatLoopFrame = requestAnimationFrame(drawBeatLoop);
}

function stopScheduler() {
  if (timerWorker) timerWorker.postMessage("stop");
  if (drawBeatLoopFrame) { cancelAnimationFrame(drawBeatLoopFrame); drawBeatLoopFrame = null; }
  // Use cached refs — avoids a querySelectorAll on stop
  beatDotEls.forEach(d => d.classList.remove('active'));
}

function drawBeatLoop() {
  if (!state.isPlaying) {
    drawBeatLoopFrame = null;
    return;
  }
  
  let currentNote = -1;
  const currentTime = audioCtx.currentTime;
  
  while (notesInQueue.length && notesInQueue[0].time <= currentTime) {
    currentNote = notesInQueue[0].note;
    notesInQueue.splice(0, 1);
  }
  
  if (currentNote !== -1) {
    state.beatIndex = currentNote;
    flashBeat();
    state.matraCount = currentNote + 1;
    updateMatraDisplay(state.matraCount, state.taalData.beats);
  }
  
  drawBeatLoopFrame = requestAnimationFrame(drawBeatLoop);
}

function flashBeat() {
  // Use cached refs for both remove and add — no DOM queries at 60fps
  beatDotEls.forEach(d => d.classList.remove('active'));
  if (beatDotEls[state.beatIndex]) beatDotEls[state.beatIndex].classList.add('active');
}

function updateBeatTiming() {
  if (state.isPlaying) { 
    startScheduler();
  }
}

function updateMatraDisplay(matra, total) {
  const el = $('matraCounter');
  if (!el) return;
  el.textContent = matra > 0 ? matra : '—';
  el.classList.toggle('sam', matra === 1 && total > 0);
}

function showMatraRow(show) {
  const row = $('matraRow');
  if (row) row.style.display = show ? '' : 'none';
}

// ── Waveform ──────────────────────────────────────────────────────
function startWaveform() {
  if (!analyserNode || !canvas) return;
  const buf = new Uint8Array(analyserNode.frequencyBinCount);

  // Cache the gradient once — recreating LinearGradient every frame at 60fps
  // was wasting ~0.2ms per frame on the main thread.
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  let cachedGradient = null;
  let cachedW = 0;

  function draw() {
    state.waveFrame = requestAnimationFrame(draw);
    analyserNode.getByteTimeDomainData(buf);
    const cW = canvas.offsetWidth, cH = canvas.offsetHeight;
    ctx2d.clearRect(0, 0, cW, cH);
    ctx2d.lineWidth = 2;
    // Rebuild gradient only when canvas width changes (e.g. on resize)
    if (!cachedGradient || cW !== cachedW) {
      cachedGradient = ctx2d.createLinearGradient(0, 0, cW, 0);
      cachedGradient.addColorStop(0, '#f5a623');
      cachedGradient.addColorStop(1, '#e8572a');
      cachedW = cW;
    }
    ctx2d.strokeStyle = cachedGradient;
    ctx2d.beginPath();
    const sl = cW / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const x = i * sl;
      const y = (buf[i] / 128) * cH / 2;
      i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
  }
  draw();
}

function clearWaveform() {
  if (state.waveFrame) { cancelAnimationFrame(state.waveFrame); state.waveFrame = null; }
  if (ctx2d && canvas) ctx2d.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
}

// ── Now Playing ───────────────────────────────────────────────────
function updateNowPlaying() {
  $('npRaag').textContent = state.raag || 'Select a Raag';
  $('npDetails').textContent = state.instrument && state.taal
    ? `${state.instrument} · ${state.taal}`
    : 'Choose instrument, taal & tempo to begin';

  const tags = [
    [$('tagInstrument'), state.instrument],
    [$('tagTaal'), state.taal],
    [$('tagBeats'), state.taalData ? `${state.taalData.beats} beats` : null],
    [$('tagTempo'), state.bpm && state.raag ? `${state.bpm} BPM` : null],
  ];
  tags.forEach(([el, val]) => {
    if (el) { el.textContent = val || '—'; el.classList.toggle('active', !!val); }
  });
}

// ── Transport ──────────────────────────────────────────────────────
$('playBtn').addEventListener('click', togglePlay);
$('stopBtn').addEventListener('click', stopPlayback);
$('loopBtn').addEventListener('click', () => {
  state.isLooping = !state.isLooping;
  if (lehraSource) lehraSource.loop = state.isLooping;
  $('loopBtn').classList.toggle('active', state.isLooping);
});

// ── Keyboard Shortcuts ─────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowUp') {
    e.preventDefault();
    if (state.taalData) {
      setBpm(state.bpm + 1);
      syncSlider();
      applyTempoChange();
    }
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    if (state.taalData) {
      setBpm(state.bpm - 1);
      syncSlider();
      applyTempoChange();
    }
  }
});

// ── UI Helpers ────────────────────────────────────────────────────
function showPlay() { $('playIcon').style.display = ''; $('pauseIcon').style.display = 'none'; }
function showPause() { $('playIcon').style.display = 'none'; $('pauseIcon').style.display = ''; }

function setStatus(msg, type) {
  $('statusText').textContent = msg;
  const dot = $('infoDot');
  dot.className = 'info-dot' + (type ? ' ' + type : '');
}

function setBadge(text, loading) {
  const b = $('loadingBadge');
  b.textContent = text;
  b.classList.toggle('loading', loading);
}

// ── Init ──────────────────────────────────────────────────────────
function init() {
  renderInstruments();
  initVolumeSliders();
  $('loopBtn').classList.add('active');
  showPlay();
  showMatraRow(false);
  setStatus('Ready — select a raag to begin', '');

  // Set initial pitch tag
  const sel = $('pitchSelect');
  $('tagPitch').textContent = sel.options[sel.selectedIndex].text.replace(' (Original)', '').replace('(Original)', '');
  $('tagPitch').classList.add('active');

  // Options listeners
  $('metronomeToggle').addEventListener('change', e => {
    state.metronomeEnabled = e.target.checked;
  });
  $('metronomeSoundSelect').addEventListener('change', e => {
    state.metronomeSound = e.target.value;
  });
  const subSel = $('metronomeSubdivisionSelect');
  if (subSel) {
    subSel.addEventListener('change', e => {
      state.metronomeSubdivision = parseInt(e.target.value) || 1;
    });
  }
  $('wakeLockToggle').addEventListener('change', e => {
    state.wakeLockEnabled = e.target.checked;
    if (!state.wakeLockEnabled) releaseWakeLock();
    else if (state.isPlaying) requestWakeLock();
  });

  // Khali/Taali accents toggle
  const accentsToggle = $('metronomeAccentsToggle');
  if (accentsToggle) {
    accentsToggle.addEventListener('change', e => {
      state.metronomeAccents = e.target.checked;
    });
  }

  // ── Typed Tempo Input ─────────────────────────────────────────────────
  // The tempoValue element is now an <input type="number">. The user can:
  //   • Type a BPM and press Enter (or Tab / click away) to commit
  //   • Use Up/Down arrow keys inside the field to nudge ±1
  const tempoInput = $('tempoValue');
  if (tempoInput) {
    // Commit on Enter key
    tempoInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTypedBpm();
        tempoInput.blur();
      }
      // Let ArrowUp/Down work as ±1, then prevent the global shortcut handler
      // from also firing so we don't double-apply the change.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
        if (!state.taalData) return;
        const delta = e.key === 'ArrowUp' ? 1 : -1;
        setBpm(state.bpm + delta);
        syncSlider();
        applyTempoChange();
      }
    });

    // Commit on blur (click away / Tab)
    tempoInput.addEventListener('blur', () => {
      commitTypedBpm();
    });

    // Live preview while typing (updates slider position in real-time)
    tempoInput.addEventListener('input', () => {
      const val = parseInt(tempoInput.value, 10);
      if (!isNaN(val) && state.taalData) {
        const { minTempo, maxTempo } = state.taalData;
        if (val >= minTempo && val <= maxTempo) {
          state.bpm = val;
          // Update slider visually without triggering a server reload
          const progress = bpmToProgress(state.bpm);
          $('tempoSlider').value = progress;
          $('tempoSlider').style.setProperty('--slider-pct', (progress / 210 * 100).toFixed(1) + '%');
          updateNowPlaying();
        }
      }
    });
  }

  function commitTypedBpm() {
    if (!state.taalData) return;
    const val = parseInt($('tempoValue').value, 10);
    if (isNaN(val)) { syncSlider(); return; } // revert to last known BPM
    setBpm(val);    // clamps to [minTempo, maxTempo]
    syncSlider();   // updates slider + pill + tick highlights
    applyTempoChange(); // triggers server reload if playing
  }
  // ──────────────────────────────────────────────────────────────────────

  // Studio FX Listeners
  const fxBass = $('fxBass');
  const fxTreble = $('fxTreble');
  const fxReverb = $('fxReverb');
  
  if (fxBass) {
    fxBass.addEventListener('input', e => {
      const v = +e.target.value;
      if (filterBass) filterBass.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
      $('fxBassVal').textContent = v + 'dB';
      fxBass.style.setProperty('--val', ((v + 12) / 24 * 100) + '%');
    });
    fxBass.style.setProperty('--val', '50%');
  }

  if (fxTreble) {
    fxTreble.addEventListener('input', e => {
      const v = +e.target.value;
      if (filterTreble) filterTreble.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
      $('fxTrebleVal').textContent = v + 'dB';
      fxTreble.style.setProperty('--val', ((v + 12) / 24 * 100) + '%');
    });
    fxTreble.style.setProperty('--val', '50%');
  }

  if (fxReverb) {
    // Track whether the reverb path is wired. When reverb=0 the ConvolverNode
    // is fully disconnected so it processes zero audio frames (saves CPU).
    let reverbActive = false;

    fxReverb.addEventListener('input', e => {
      const v = +e.target.value;
      const wet = v / 100;
      const dry = 1 - (wet * 0.5);

      if (wet > 0 && !reverbActive) {
        // Lazily wire the reverb path on first use
        try { filterTreble.connect(reverbNode); } catch (_) {}
        try { reverbNode.connect(wetGainNode); } catch (_) {}
        reverbActive = true;
      } else if (wet === 0 && reverbActive) {
        // Fully remove reverb from graph when slider returns to 0
        try { filterTreble.disconnect(reverbNode); } catch (_) {}
        try { reverbNode.disconnect(wetGainNode); } catch (_) {}
        reverbActive = false;
      }

      if (wetGainNode) wetGainNode.gain.setTargetAtTime(wet, audioCtx.currentTime, 0.02);
      if (dryGainNode) dryGainNode.gain.setTargetAtTime(dry, audioCtx.currentTime, 0.02);
      $('fxReverbVal').textContent = v + '%';
      fxReverb.style.setProperty('--val', v + '%');
    });
    fxReverb.style.setProperty('--val', '0%');
  }

  // Modals
  $('fxBtn')?.addEventListener('click', () => {
    $('fxModal').classList.add('active');
  });
  $('fxClose')?.addEventListener('click', () => {
    $('fxModal').classList.remove('active');
  });
  
  $('statsBtn')?.addEventListener('click', () => {
    renderStats();
    $('statsModal').classList.add('active');
  });
  $('statsClose')?.addEventListener('click', () => {
    $('statsModal').classList.remove('active');
  });

  // Fullscreen
  $('fullscreenBtn')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      document.body.classList.add('fullscreen-mode');
    } else {
      document.body.classList.remove('fullscreen-mode');
    }
  });

  if (canvas) {
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    });
    ro.observe(canvas);
  }
}

document.addEventListener('DOMContentLoaded', init);


// ============================================================================
// ========================== NEW VERTICALS LOGIC =============================
// ============================================================================

// ── SPA Navigation ──
function initNavigation() {
  // First check URL search params (legacy)
  const urlParams = new URLSearchParams(window.location.search);
  let domain = urlParams.get('domain');
  let path = window.location.pathname.replace(/^\/|\/$/g, ''); // strip slashes

  if (domain === 'carnatic') {
    navigateTo('view-carnatic', 'carnatic');
    window.history.replaceState({target: 'view-carnatic', domain: 'carnatic'}, '', '/carnatic');
  } else if (domain === 'hindustani') {
    navigateTo('view-hindustani', 'hindustani');
    window.history.replaceState({target: 'view-hindustani', domain: 'hindustani'}, '', '/hindustani');
  } else if (path) {
    // Path-based routing (virtual folders)
    if (path === 'carnatic') navigateTo('view-carnatic', 'carnatic');
    else if (path === 'hindustani') navigateTo('view-hindustani', 'hindustani');
    else if (path === 'lehra') navigateTo('view-lehra', 'hindustani');
    else if (path === 'notation') navigateTo('view-notation', 'hindustani');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNavigation);
} else {
  initNavigation();
}

// Handle internal navigation events from dashboard cards
document.addEventListener('nav-internal', (e) => {
  if (e.detail && e.detail.target) {
    navigateTo(e.detail.target, e.detail.domain);
    // Map targets to folder paths
    let path = '/';
    if (e.detail.target === 'view-carnatic') path = '/carnatic';
    if (e.detail.target === 'view-hindustani') path = '/hindustani';
    if (e.detail.target === 'view-lehra') path = '/lehra';
    if (e.detail.target === 'view-notation') path = '/notation';
    window.history.pushState({target: e.detail.target, domain: e.detail.domain}, '', path);
  }
});

// Handle browser Back/Forward buttons
window.addEventListener('popstate', (e) => {
  if (e.state && e.state.target) {
    navigateTo(e.state.target, e.state.domain, true);
  } else {
    // Fallback to home
    navigateTo('view-home', null, true);
  }
});

function navigateTo(target, domain, skipHistory = false) {
  // Stop Lehra audio safely
  if (typeof stopPlayback === 'function' && typeof state !== 'undefined' && state && state.isPlaying) {
    stopPlayback();
  }
  // Stop Mixer audio
  if (typeof mixerPlaying !== 'undefined' && mixerPlaying && typeof stopMixer === 'function') {
    stopMixer();
  }
  
  // Hide all views
  document.querySelectorAll('.app-view').forEach(v => {
    v.style.display = 'none';
    v.classList.remove('active-view');
  });
  
  // Remove active from nav-btns
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Toggle Pitch Controls visibility
  const pitchWrap = document.querySelector('.pitch-wrap');
  if (pitchWrap) {
    pitchWrap.style.display = target === 'view-lehra' ? 'flex' : 'none';
  }
  
  // Show target view
  const view = document.getElementById(target);
  if(view) {
      view.style.display = '';
      view.classList.add('active-view');
  }
  
  // If no domain provided, try to infer it from the target view
  if (!domain && view) {
    domain = view.getAttribute('data-domain');
  }
  
  // Activate corresponding nav button
  if (domain) {
    const navBtn = document.querySelector(`.nav-btn[data-domain="${domain}"]`);
    if (navBtn) navBtn.classList.add('active');
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const target = e.currentTarget.getAttribute('data-target');
    if (target) {
      e.preventDefault();
      const domain = e.currentTarget.getAttribute('data-domain');
      navigateTo(target, domain);
      
      let path = '/';
      if (target === 'view-carnatic') path = '/carnatic';
      if (target === 'view-hindustani') path = '/hindustani';
      if (target === 'view-home') path = '/';
      window.history.pushState({target, domain}, '', path);
    }
  });
});

window.addEventListener('nav-internal', (e) => {
  navigateTo(e.detail.target, e.detail.domain);
});

window.addEventListener('nav-home', () => {
  navigateTo('view-home');
});

// ── Stem Separator Logic ──

let mixerAudioNodes = [];
let mixerPlaying = false;
let mixerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();


  // -- Upload Zone Events --
  const uZone = document.getElementById('uploadZone');
  const aUpload = document.getElementById('audioUpload');
  if (uZone && aUpload) {
    uZone.addEventListener('click', () => {
      aUpload.click();
    });
    uZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uZone.style.borderColor = 'var(--gold)';
    });
    uZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      uZone.style.borderColor = '';
    });
    uZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uZone.style.borderColor = '';
      if (e.dataTransfer.files.length > 0) {
        aUpload.files = e.dataTransfer.files;
        aUpload.dispatchEvent(new Event('change'));
      }
    });
  }

  document.getElementById('audioUpload')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  document.getElementById('uploadZone').style.display = 'none';
  document.getElementById('processingZone').style.display = 'block';
  const processingText = document.getElementById('processingText');
  processingText.textContent = 'Uploading audio file...';
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch('/api/separate', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    
    if (data.error) throw new Error(data.error);
    
    const jobId = data.job_id;
    processingText.textContent = 'Job queued. Waiting for server...';
    
    // Polling function
    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await fetch(`/api/job_status/${jobId}`);
        const statusData = await statusRes.json();
        
        if (statusData.error) {
          clearInterval(pollInterval);
          throw new Error(statusData.error);
        }
        
        if (statusData.status === 'processing') {
          const latestLog = statusData.logs && statusData.logs.length > 0 ? statusData.logs[statusData.logs.length - 1] : 'Processing...';
          processingText.textContent = `Processing (${statusData.progress}%): ${latestLog}`;
        } else if (statusData.status === 'completed') {
          clearInterval(pollInterval);
          
          document.getElementById('processingZone').style.display = 'none';
          document.getElementById('mixerZone').style.display = 'block';
          
          const stems = {
            'Vocals': `/api/stems/${jobId}/vocals.mp3`,
            'Drums': `/api/stems/${jobId}/drums.mp3`,
            'Bass': `/api/stems/${jobId}/bass.mp3`,
            'Guitar': `/api/stems/${jobId}/guitar.mp3`,
            'Piano': `/api/stems/${jobId}/piano.mp3`,
            'Other': `/api/stems/${jobId}/other.mp3`
          };
          
          renderMixerTracks(stems); 
        } else if (statusData.status === 'error') {
          clearInterval(pollInterval);
          throw new Error(statusData.error);
        }
      } catch (pollErr) {
        clearInterval(pollInterval);
        alert("Error polling job status: " + pollErr.message);
        document.getElementById('processingZone').style.display = 'none';
        document.getElementById('uploadZone').style.display = 'block';
      }
    }, 2000);
    
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

