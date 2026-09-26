// Swar tuner: the YIN detector (and its AudioWorklet wrapper) on synthetic
// tones, the swar mapping and the needle smoothing.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin } from '../public/js/tuner/pitch.worklet.js';
import { NeedleSmoother, nearestSwar } from '../public/js/tuner/swar.js';

const cents = (a, b) => 1200 * Math.log2(a / b);

function tone(hz, sr, secs, { harmonics = 1, noise = 0, amp = 0.5 } = {}) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  return new Float32Array(Math.round(secs * sr)).map((_, n) => {
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * hz * h * n / sr) / h; // sawtooth-like
    return amp * v / (harmonics > 1 ? 1.5 : 1) + noise * rand();
  });
}

test('YIN finds the pitch of pure and harmonic-rich tones (no octave errors)', () => {
  const sr = 24000;
  const frame = x => x.subarray(0, 1433); // the worklet's window at 24 kHz
  for (const hz of [65, 98, 146.83, 220, 392, 880, 1046.5]) {
    for (const opts of [{}, { harmonics: 12 }, { harmonics: 8, noise: 0.05 }]) {
      const r = yin(frame(tone(hz, sr, 0.1, opts)), sr);
      assert.ok(r, `${hz} Hz ${JSON.stringify(opts)}: detected`);
      assert.ok(Math.abs(cents(r.hz, hz)) < 3, `${hz} Hz ${JSON.stringify(opts)}: got ${r.hz.toFixed(2)} Hz`);
      assert.ok(r.clarity > 0.8);
    }
  }
});

test('YIN reports no pitch for noise', () => {
  let seed = 3;
  const noise = new Float32Array(1433).map(() => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1);
  const r = yin(noise, 24000);
  assert.ok(r === null || r.clarity < 0.6, `noise: ${JSON.stringify(r)}`);
});

test('the pitch worklet decimates, windows and reports a steady pitch', async () => {
  const posts = [];
  let Processor = null;
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: m => posts.push(m) }; } };
  globalThis.registerProcessor = (name, cls) => { Processor = cls; };
  try {
    await import('../public/js/tuner/pitch.worklet.js?as-worklet');
    const p = new Processor();
    const x = tone(196, 48000, 1, { harmonics: 6 });
    for (let i = 0; i + 128 <= x.length; i += 128) p.process([[x.subarray(i, i + 128)]]);
    assert.ok(posts.length >= 40 && posts.length <= 50, `${posts.length} reports in 1 s`);
    for (const m of posts) assert.ok(Math.abs(cents(m.hz, 196)) < 3, `reported ${m.hz}`);
    // silence → no pitch
    posts.length = 0;
    for (let i = 0; i < 100; i++) p.process([[new Float32Array(128)]]);
    assert.ok(posts.length > 0 && posts.at(-1).hz === 0);
  } finally {
    delete globalThis.registerProcessor;
    delete globalThis.AudioWorkletProcessor;
    delete globalThis.sampleRate;
  }
});

test('nearest swar relative to Sa: names, komal/tivra, octaves, intonation', () => {
  const sa = 146.83;
  const at = c => sa * Math.pow(2, c / 1200);
  assert.deepEqual(nearestSwar(sa, sa), { index: 0, name: 'Sa', qualifier: '', octave: 0, cents: 0 });
  let s = nearestSwar(at(702), sa); // just Pa
  assert.equal(s.name, 'Pa'); assert.ok(Math.abs(s.cents) < 0.1);
  s = nearestSwar(at(700), sa, { intonation: 'et' });
  assert.equal(s.name, 'Pa'); assert.ok(Math.abs(s.cents) < 0.1);
  s = nearestSwar(at(1200 * Math.log2(5 / 4) + 12), sa); // just Ga, 12 cents sharp
  assert.equal(s.name, 'Ga'); assert.equal(s.qualifier, ''); assert.ok(Math.abs(s.cents - 12) < 0.1);
  s = nearestSwar(at(386), sa, { intonation: 'et' }); // just Ga is 14 cents flat of ET
  assert.ok(Math.abs(s.cents + 14) < 0.1);
  assert.deepEqual([112, 316, 590, 814, 996].map(c => { const r = nearestSwar(at(c), sa); return `${r.name} ${r.qualifier}`; }),
    ['Re komal', 'Ga komal', 'Ma tivra', 'Dha komal', 'Ni komal']);
  s = nearestSwar(at(-1200 + 1088), sa); // mandra Ni
  assert.deepEqual([s.name, s.octave], ['Ni', -1]);
  s = nearestSwar(at(1190), sa); // just below taar Sa
  assert.deepEqual([s.name, s.octave], ['Sa', 1]); assert.ok(Math.abs(s.cents + 10) < 0.1);
  s = nearestSwar(at(204), sa, { system: 'carnatic' });
  assert.equal(s.name, 'R2');
});

test('needle: ignores a lone glitch, eases, follows a real change, releases after a gap', () => {
  const base = 5000;
  const m = new NeedleSmoother({ tau: 0.1, hold: 0.4 });
  const trace = [];
  [0, 2, -1, 1200, 1, 3].forEach((d, i) => { m.push(base + d, i * 0.02); trace.push(m.step(i * 0.02, 0.02) - base); });
  assert.ok(trace.every(v => Math.abs(v) < 5), `an octave glitch never moves the needle: ${trace.map(v => v.toFixed(1))}`);
  let w;
  for (let t = 0.12; t < 0.35; t += 0.016) w = m.step(t, 0.016);
  assert.ok(Math.abs(w - (base + 1)) < 1.5, `settles on the median (${w - base})`);
  for (let t = 0.36; t < 1.1; t += 0.016) { m.push(base + 150, t); w = m.step(t, 0.016); } // a new note
  assert.ok(Math.abs(w - (base + 150)) < 1, `follows a real change (${w - base})`);
  for (let t = 1.1; t < 1.6; t += 0.016) w = m.step(t, 0.016);
  assert.equal(w, null, 'released after the hold time without new estimates');
});
