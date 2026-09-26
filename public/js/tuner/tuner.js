/**
 * Swar tuner: listens to the microphone, detects its pitch in an
 * AudioWorklet (pitch.worklet.js, YIN) and shows the nearest swar relative
 * to the current view's Sa, with its deviation in cents on a steadied
 * needle. The microphone only feeds the detector — it is never connected
 * to the speakers, and nothing is recorded.
 */
import { $ } from '../core/dom.js';
import { getAudioContext } from '../core/audio-context.js';
import { acquireMic, micSupported, releaseMic } from '../core/mic.js';
import { NeedleSmoother, nearestSwar } from './swar.js';

const MIN_CLARITY = 0.6;
const INTONATION_KEY = 'tuner_intonation';

// Each view says what Sa (and which swar names) the tuner should use.
const references = new Map();
export function registerTunerReference(viewId, fn) {
  references.set(viewId, fn);
}
function reference() {
  const active = document.querySelector('.app-view.active-view')?.id;
  const fn = references.get(active) || references.get('view-lehra');
  return fn ? fn() : { sa: 146.83, system: 'hindustani' };
}

let workletReady = null;
let session = null; // { src, filter, node, smoother, raf, last }

function loadWorklet(ctx) {
  if (!workletReady) {
    workletReady = ctx.audioWorklet.addModule(new URL('./pitch.worklet.js', import.meta.url));
    workletReady.catch(() => { workletReady = null; });
  }
  return workletReady;
}

const log2Hz = hz => 1200 * Math.log2(hz); // cents above 1 Hz: independent of Sa

function setStatus(text) {
  $('tunerStatus').textContent = text;
}

async function start() {
  if (session) return;
  if (!micSupported()) { setStatus('This browser has no microphone access.'); return; }
  const ctx = getAudioContext();
  session = { starting: true };
  $('tunerMicBtn').textContent = 'Starting…';
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    await loadWorklet(ctx);
    const stream = await acquireMic();
    if (!session) { releaseMic(); return; } // closed meanwhile
    const src = ctx.createMediaStreamSource(stream);
    // Band-limit below the detector's decimated Nyquist
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = ctx.sampleRate * 0.2;
    const node = new AudioWorkletNode(ctx, 'swar-pitch', { numberOfInputs: 1, numberOfOutputs: 0 });
    src.connect(filter);
    filter.connect(node); // analysis only
    const smoother = new NeedleSmoother();
    node.port.onmessage = e => {
      const m = e.data;
      smoother.push(m.hz > 0 && m.clarity >= MIN_CLARITY ? log2Hz(m.hz) : null, performance.now() / 1000);
    };
    session = { src, filter, node, smoother, raf: 0, last: performance.now() / 1000 };
    session.raf = requestAnimationFrame(draw);
    $('tunerMicBtn').textContent = 'Stop microphone';
    $('tunerMicBtn').classList.add('active');
    setStatus('Listening… sing or play a steady note.');
  } catch (err) {
    session = null;
    $('tunerMicBtn').textContent = 'Start microphone';
    setStatus(err && err.name === 'NotAllowedError'
      ? 'Microphone permission was refused. Allow it in the browser’s site settings to use the tuner.'
      : `Couldn't start the microphone: ${err.message || err}`);
  }
}

function stop() {
  if (!session) return;
  const s = session;
  session = null;
  if (s.raf) cancelAnimationFrame(s.raf);
  if (s.node) {
    s.node.port.onmessage = null;
    s.src.disconnect();
    s.filter.disconnect();
    releaseMic();
  }
  $('tunerMicBtn').textContent = 'Start microphone';
  $('tunerMicBtn').classList.remove('active');
  show(null);
  setStatus('');
}

function show(abs) {
  const { sa, system } = reference();
  $('tunerSa').textContent = sa.toFixed(2);
  const needle = $('tunerNeedle');
  if (abs === null) {
    $('tunerSwar').textContent = '—';
    $('tunerQualifier').textContent = '';
    $('tunerOctave').textContent = '';
    $('tunerCents').textContent = '';
    $('tunerHz').textContent = '';
    needle.style.left = '50%';
    needle.className = 'tuner-needle idle';
    return;
  }
  const hz = Math.pow(2, abs / 1200);
  const s = nearestSwar(hz, sa, { intonation: $('tunerIntonation').value, system });
  $('tunerSwar').textContent = s.name;
  $('tunerQualifier').textContent = s.qualifier;
  $('tunerOctave').textContent = s.octave < 0 ? 'mandra' + (s.octave < -1 ? ' ×' + -s.octave : '')
    : s.octave > 0 ? 'taar' + (s.octave > 1 ? ' ×' + s.octave : '') : 'madhya';
  const c = Math.max(-50, Math.min(50, s.cents));
  $('tunerCents').textContent = `${s.cents >= 0 ? '+' : '−'}${Math.abs(s.cents).toFixed(0)}¢`;
  $('tunerHz').textContent = `${hz.toFixed(1)} Hz`;
  needle.style.left = `${50 + c}%`;
  const off = Math.abs(s.cents);
  needle.className = 'tuner-needle ' + (off <= 10 ? 'good' : off <= 25 ? 'near' : 'far');
}

function draw() {
  if (!session || !session.smoother) return;
  const t = performance.now() / 1000;
  const v = session.smoother.step(t, t - session.last);
  session.last = t;
  show(v);
  session.raf = requestAnimationFrame(draw);
}

export function initTuner() {
  const modal = $('tunerModal');
  if (!modal) return;
  try { $('tunerIntonation').value = localStorage.getItem(INTONATION_KEY) || 'just'; } catch { /* storage unavailable */ }
  $('tunerIntonation').addEventListener('change', e => {
    try { localStorage.setItem(INTONATION_KEY, e.target.value); } catch { /* storage unavailable */ }
  });
  $('tunerBtn').addEventListener('click', () => {
    show(null);
    modal.classList.add('active');
  });
  $('tunerMicBtn').addEventListener('click', () => (session ? stop() : start()));
  $('tunerClose').addEventListener('click', () => { stop(); modal.classList.remove('active'); });
  // Closing by clicking outside (notation.js wires all overlays) also stops the mic
  new MutationObserver(() => { if (!modal.classList.contains('active')) stop(); })
    .observe(modal, { attributes: true, attributeFilter: ['class'] });
}
