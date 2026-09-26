// Custom tanpura: the plucked-string loop builder, its tuning against the
// real string recordings, and the engine's crossfaded drone swap.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LehraDSP, segmentPadFor, DEC } from '../public/js/lehra/engine.worklet.js';
import { buildSegments, padLoop } from '../public/js/lehra/engine.js';
import { FIRST_STRING, PACE_UNIT, TANPURA_SETS, autoSet, buildPluckedLoop, resample } from '../public/js/lehra/tanpura.js';

const SR = 48000;

/** 16-bit PCM mono WAV → { sr, pcm } */
function readWav(path) {
  const b = readFileSync(new URL(path, import.meta.url));
  let i = 12, sr = 0, pcm = null;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4), size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      assert.equal(b.readUInt16LE(i + 8), 1, 'PCM');
      assert.equal(b.readUInt16LE(i + 10), 1, 'mono');
      sr = b.readUInt32LE(i + 12);
      assert.equal(b.readUInt16LE(i + 22), 16, '16-bit');
    } else if (id === 'data') {
      pcm = new Float32Array(size / 2);
      for (let k = 0; k < pcm.length; k++) pcm[k] = b.readInt16LE(i + 8 + 2 * k) / 32768;
    }
    i += 8 + size + (size & 1);
  }
  return { sr, pcm };
}

/** f0 near `approx` (±40 cents): the frequency whose first 4 harmonics carry the most energy. */
function pitchNear(x, sr, approx) {
  let best = 0, bestE = -1;
  for (let c = -40; c <= 40; c += 0.5) {
    const f = approx * Math.pow(2, c / 1200);
    let e = 0;
    for (let h = 1; h <= 4; h++) {
      // Goertzel: DFT power at exactly f·h
      const k = 2 * Math.cos(2 * Math.PI * f * h / sr);
      let s1 = 0, s2 = 0;
      for (let n = 0; n < x.length; n++) { const s = x[n] + k * s1 - s2; s2 = s1; s1 = s; }
      e += s1 * s1 + s2 * s2 - k * s1 * s2;
    }
    if (e > bestE) { bestE = e; best = f; }
  }
  return best;
}

const cents = (a, b) => 1200 * Math.log2(a / b);

test('resampling transposes by the requested ratio', () => {
  const x = new Float32Array(SR).map((_, n) => Math.sin(2 * Math.PI * 200 * n / SR));
  for (const ratio of [2 / 3 * 1.2, 1.25]) {
    const y = resample(x, ratio);
    assert.ok(Math.abs(y.length - x.length / ratio) < 3);
    const f = pitchNear(y.subarray(2000, 2000 + SR / 2), SR, 200 * ratio);
    assert.ok(Math.abs(cents(f, 200 * ratio)) < 1, `ratio ${ratio}: ${f} Hz`);
  }
});

test('plucked loop: seamless, deterministic, at a steady level', () => {
  // Decaying tones stand in for the three strings
  const pluck = hz => new Float32Array(Math.round(8 * SR)).map((_, n) => 0.4 * Math.exp(-n / SR / 2) * Math.sin(2 * Math.PI * hz * n / SR));
  const strings = { first: pluck(110), jodi: pluck(146.83), kharaj: pluck(73.4) };
  const loop = buildPluckedLoop(strings, SR, PACE_UNIT.fast);
  assert.equal(loop.length, Math.round(5 * PACE_UNIT.fast * SR) * 2, 'two cycles of five pluck units');
  assert.deepEqual(buildPluckedLoop(strings, SR, PACE_UNIT.fast), loop, 'same style, same sound');
  let sum = 0, maxStep = 0;
  for (let i = 0; i < loop.length; i++) {
    sum += loop[i] * loop[i];
    maxStep = Math.max(maxStep, Math.abs(loop[(i + 1) % loop.length] - loop[i]));
  }
  assert.ok(Math.abs(Math.sqrt(sum / loop.length) - 0.085) < 0.01, 'normalised level');
  const wrap = Math.abs(loop[0] - loop[loop.length - 1]);
  assert.ok(wrap <= maxStep, `the loop point is as smooth as the rest (${wrap} vs ${maxStep})`);
});

test('string recordings: in tune as measured; first string lands on Pa / Ma / Ni exactly', () => {
  for (const [name, set] of Object.entries(TANPURA_SETS)) {
    const jodi = readWav(`../assets/${set.jodi.url.split('/').pop()}`);
    const first = readWav(`../assets/${set.first.url.split('/').pop()}`);
    const win = x => x.subarray(Math.round(0.5 * 44100), Math.round(1.5 * 44100));
    assert.equal(jodi.sr, 44100);
    assert.ok(Math.abs(cents(pitchNear(win(jodi.pcm), jodi.sr, set.sa), set.sa)) < 3, `${name}: Sa`);
    assert.ok(Math.abs(cents(pitchNear(win(first.pcm), first.sr, set.first.hz), set.first.hz)) < 3, `${name}: first string`);
    for (const [string, ratio] of Object.entries(FIRST_STRING)) {
      const tuned = resample(first.pcm.subarray(0, 2 * 44100), ratio * set.sa / set.first.hz);
      const f = pitchNear(win(tuned), first.sr, ratio * set.sa);
      assert.ok(Math.abs(cents(f, ratio * set.sa)) < 3, `${name} ${string}: ${f.toFixed(2)} Hz vs ${(ratio * set.sa).toFixed(2)}`);
    }
  }
  assert.equal(autoSet(130.81), 'male');
  assert.equal(autoSet(196), 'female');
});

test('engine: a new drone crossfades in (no click) and plays at ratio × its scale', () => {
  const posts = [];
  const dsp = new LehraDSP(SR, m => posts.push(m));
  const taal = { beats: 4, tempos: [60] };
  const rec = new Float32Array(6 * SR); // silent lehra: listen to the drone only
  dsp.handle({ type: 'raag', id: 'a', beats: 4, tuning: 1, segs: buildSegments(rec, SR, taal, 0, segmentPadFor(SR), DEC) });
  const sine = (hz, secs) => padLoop(new Float32Array(Math.round(secs * SR)).map((_, n) => 0.3 * Math.sin(2 * Math.PI * hz * n / SR)), 64);
  dsp.handle({ type: 'tanpura', ...sine(200, 1), scale: 1 });
  dsp.handle({ type: 'play', id: 'a', session: 1, seq: 1, startFrame: 0, bpm: 60, pitch: 1, tanpuraRatio: 1.1, loop: true });
  const total = 4 * SR, out = new Float32Array(total), l = new Float32Array(128), t = new Float32Array(128);
  for (let f = 0; f < total; f += 128) {
    if (f === SR * 2) dsp.handle({ type: 'tanpura', ...sine(300, 1), scale: 0.5 });
    dsp.render(l, t, 128, f);
    out.set(t, f);
  }
  assert.ok(Math.abs(cents(pitchNear(out.subarray(SR, SR + SR / 2), SR, 220), 220)) < 1, 'old drone at 200 × 1.1');
  assert.ok(Math.abs(cents(pitchNear(out.subarray(3 * SR, 3 * SR + SR / 2), SR, 165), 165)) < 1, 'new drone at 300 × 1.1 × 0.5');
  let maxStep = 0;
  for (let i = 2 * SR - 10; i < 3 * SR; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
  const toneStep = 0.3 * 2 * Math.PI * 220 / SR;
  assert.ok(maxStep < toneStep * 1.5, `crossfade without a click (max step ${maxStep})`);
});
