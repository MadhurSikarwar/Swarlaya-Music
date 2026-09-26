/**
 * The Lehra player's audio graph, built once on first use:
 *
 *   engine ─┬─ lehra ───┐
 *           └─ tanpura ─┴─ mix → bass → treble ─┬─ dry ──────────┬─ compressor → analyser → master
 *                                               └─ reverb → wet ─┘
 *   metronome ────────────────────────────────────────────────────────────────────────────→ master
 *
 * master = the page's shared output (core/audio-output.js).
 */
import { $ } from '../core/dom.js';
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput } from '../core/audio-output.js';
import { LehraEngine } from './engine.js';

export const audio = {
  ctx: null,
  engine: null,         // LehraEngine (AudioWorklet), set once ready
  gainLehra: null,
  gainTanpura: null,
  gainMetronome: null,
  filterBass: null,
  filterTreble: null,
  reverbNode: null,
  dryGain: null,
  wetGain: null,
  analyser: null,
};

let ready = null; // Promise for the one-time graph + engine setup

/**
 * Build the graph and start the engine (once), and resume the context.
 * With `resume: false` a context created before any user gesture stays
 * suspended (it resumes on the first click, see core/audio-context.js).
 */
export async function ensureAudio({ resume = true } = {}) {
  if (!ready) {
    ready = setup();
    ready.catch(() => { ready = null; });
  }
  await ready;
  if (resume && audio.ctx.state === 'suspended') await audio.ctx.resume();
}

async function setup() {
  if (!audio.gainLehra) buildGraph();
  const engine = new LehraEngine(audio.ctx);
  await engine.init(audio.gainLehra, audio.gainTanpura);
  audio.engine = engine; // the drone is chosen and loaded by tanpura.js
}

function generateReverbIR(ctx, duration = 2, decay = 2.0) {
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

function buildGraph() {
  const ctx = getAudioContext();
  audio.ctx = ctx;

  const mix = ctx.createGain();
  audio.filterBass = ctx.createBiquadFilter();
  audio.filterBass.type = 'lowshelf';
  audio.filterBass.frequency.value = 200;

  audio.filterTreble = ctx.createBiquadFilter();
  audio.filterTreble.type = 'highshelf';
  audio.filterTreble.frequency.value = 3000;

  audio.reverbNode = ctx.createConvolver();
  audio.reverbNode.buffer = generateReverbIR(ctx, 2.5, 3.0);

  audio.dryGain = ctx.createGain();
  audio.dryGain.gain.value = 1;
  audio.wetGain = ctx.createGain();
  audio.wetGain.gain.value = 0;

  audio.analyser = ctx.createAnalyser();
  audio.analyser.fftSize = 256;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-15, ctx.currentTime);
  compressor.knee.setValueAtTime(20, ctx.currentTime);
  compressor.ratio.setValueAtTime(10, ctx.currentTime);
  compressor.attack.setValueAtTime(0.005, ctx.currentTime);
  compressor.release.setValueAtTime(0.1, ctx.currentTime);

  // The reverb path is wired only while the reverb slider is above 0 (see mixer.js).
  mix.connect(audio.filterBass);
  audio.filterBass.connect(audio.filterTreble);
  audio.filterTreble.connect(audio.dryGain);
  audio.dryGain.connect(compressor);
  audio.wetGain.connect(compressor);
  compressor.connect(audio.analyser);
  audio.analyser.connect(getMasterOutput());

  audio.gainLehra = ctx.createGain();
  audio.gainLehra.gain.value = 0.8;
  audio.gainLehra.connect(mix);

  audio.gainTanpura = ctx.createGain();
  audio.gainTanpura.gain.value = 0.5;
  audio.gainTanpura.connect(mix);

  // Metronome bypasses the FX
  audio.gainMetronome = ctx.createGain();
  audio.gainMetronome.gain.value = 0.6;
  audio.gainMetronome.connect(getMasterOutput());

  // Apply any volume/EQ/reverb settings made before audio existed.
  ['lehraVol', 'tanpuraVol', 'metronomeVol', 'fxBass', 'fxTreble', 'fxReverb'].forEach(id => {
    const el = $(id);
    if (el) el.dispatchEvent(new Event('input'));
  });
}
