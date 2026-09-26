/** Now-playing card: audio-reactive mandala, waveform, and the info tags. */
import { $ } from '../core/dom.js';
import { audio } from './audio.js';
import { state } from './state.js';

let visualizerRunning = false;
let waveFrame = null;

export function startVisualizer() {
  const analyser = audio.analyser;
  if (!analyser || visualizerRunning) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const mandala = document.querySelector('.np-mandala');

  visualizerRunning = true;
  function loop() {
    if (!state.isPlaying) {
      if (mandala) mandala.style.transform = 'scale(1)';
      visualizerRunning = false;
      return;
    }
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;
    if (mandala) mandala.style.transform = `scale(${1 + (avg / 255) * 0.18})`;
    requestAnimationFrame(loop);
  }
  loop();
}

export function startWaveform() {
  const canvas = $('waveCanvas');
  const analyser = audio.analyser;
  if (!analyser || !canvas) return;
  const ctx2d = canvas.getContext('2d');
  const buf = new Uint8Array(analyser.frequencyBinCount);

  // Cache the gradient — rebuilt only when the canvas width changes.
  let cachedGradient = null;
  let cachedW = 0;

  function draw() {
    waveFrame = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(buf);
    const cW = canvas.offsetWidth, cH = canvas.offsetHeight;
    ctx2d.clearRect(0, 0, cW, cH);
    ctx2d.lineWidth = 2;
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
      if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
  }
  draw();
}

export function clearWaveform() {
  if (waveFrame) { cancelAnimationFrame(waveFrame); waveFrame = null; }
  const canvas = $('waveCanvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
}

/** Keep the canvas's drawing buffer the size it is displayed at. */
export function initWaveformCanvas() {
  const canvas = $('waveCanvas');
  if (!canvas) return;
  new ResizeObserver(() => {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }).observe(canvas);
}

export function updateNowPlaying() {
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
