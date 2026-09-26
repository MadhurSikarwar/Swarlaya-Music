/**
 * Shruti: a drone at the chosen Sa, either
 *   tanpura  the plucked tanpura built from the string recordings (the same
 *            loop builder as the Lehra player's tanpura), looped seamlessly
 *            and varispeeded to Sa, or
 *   reed     a synthesised shruti box: Sa, the first string's swara below
 *            taar Sa (Pa / Ma / Ni) and taar Sa, each a pair of slightly
 *            detuned reeds, breathing with the bellows.
 * Changing the sound crossfades; changing Sa glides.
 */
import { getAudioContext } from '../core/audio-context.js';
import { autoSet, pluckedTanpura } from '../lehra/tanpura.js';

const FADE_IN = 0.6;
const FADE_OUT = 0.4;
const FIRST = { pa: 3 / 2, ma: 4 / 3, ni: 15 / 8 };

let out = null;     // → the suite's output
let voice = null;   // the drone sounding now
const decoded = new Map();

export function setShrutiOutput(node) {
  out = node;
}

function decode(url) {
  if (!decoded.has(url)) {
    const ctx = getAudioContext();
    const p = fetch(url).then(r => {
      if (!r.ok) throw new Error(`${r.status} (${url})`);
      return r.arrayBuffer();
    }).then(b => ctx.decodeAudioData(b));
    p.catch(() => decoded.delete(url));
    decoded.set(url, p);
  }
  return decoded.get(url);
}

const loops = new Map(); // "set|first|pace" → Promise<AudioBuffer + sa>

function tanpuraLoop(sa, first, pace) {
  const set = autoSet(sa);
  const key = `${set}|${first}|${pace}`;
  if (!loops.has(key)) {
    const p = pluckedTanpura(decode, set, first, pace).then(({ core, sr, sa: loopSa }) => {
      const buf = getAudioContext().createBuffer(1, core.length, sr);
      buf.copyToChannel(core, 0);
      return { buf, sa: loopSa };
    });
    p.catch(() => loops.delete(key));
    loops.set(key, p);
  }
  return loops.get(key);
}

function envelope(ctx) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_IN);
  g.connect(out);
  return g;
}

async function tanpuraVoice(opts) {
  const ctx = getAudioContext();
  const { buf, sa } = await tanpuraLoop(opts.sa, opts.first, opts.pace);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = opts.sa / sa;
  const env = envelope(ctx);
  const level = ctx.createGain();
  level.gain.value = 1.4;
  src.connect(level);
  level.connect(env);
  src.start();
  return {
    env,
    setSa: hz => src.playbackRate.setTargetAtTime(hz / sa, ctx.currentTime, 0.05),
    stop: t => src.stop(t),
  };
}

function reedVoice(opts) {
  const ctx = getAudioContext();
  const env = envelope(ctx);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1800;
  tone.Q.value = 0.5;
  const bellows = ctx.createGain();
  bellows.gain.value = 0.9;
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.22;
  const breathDepth = ctx.createGain();
  breathDepth.gain.value = 0.06;
  breath.connect(breathDepth);
  breathDepth.connect(bellows.gain);
  tone.connect(bellows);
  bellows.connect(env);
  const notes = [[1, 0.22], [FIRST[opts.first] || FIRST.pa, 0.16], [2, 0.12]]; // Sa, Pa/Ma/Ni, taar Sa
  const oscs = [];
  for (const [ratio, level] of notes) {
    for (const cents of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = opts.sa * ratio;
      o.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(tone);
      o.start();
      oscs.push({ o, ratio });
    }
  }
  breath.start();
  return {
    env,
    setSa: hz => oscs.forEach(({ o, ratio }) => o.frequency.setTargetAtTime(hz * ratio, ctx.currentTime, 0.05)),
    stop: t => { oscs.forEach(({ o }) => o.stop(t)); breath.stop(t); },
  };
}

function fadeOut(v) {
  const ctx = getAudioContext();
  const t = ctx.currentTime;
  v.env.gain.cancelScheduledValues(t);
  v.env.gain.setValueAtTime(v.env.gain.value, t);
  v.env.gain.linearRampToValueAtTime(0, t + FADE_OUT);
  v.stop(t + FADE_OUT + 0.05);
}

let request = 0;
let active = false; // on from the request, even while the tanpura loads

/** Start the drone, or crossfade to new settings { sound, sa, first, pace }. */
export async function startShruti(opts) {
  const id = ++request;
  active = true;
  let v;
  try {
    v = opts.sound === 'reed' ? reedVoice(opts) : await tanpuraVoice(opts);
  } catch (err) {
    if (id === request) active = false;
    throw err;
  }
  if (id !== request) { fadeOut(v); return; } // superseded while loading
  if (voice) fadeOut(voice);
  voice = v;
}

export function setShrutiSa(hz) {
  if (voice) voice.setSa(hz);
}

export function stopShruti() {
  request++;
  active = false;
  if (voice) fadeOut(voice);
  voice = null;
}

export function shrutiPlaying() {
  return active;
}
