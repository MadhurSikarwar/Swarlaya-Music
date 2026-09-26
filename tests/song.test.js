// Song mode of the Lehra engine (practise along with a separated track):
// one segment covering the whole track, live speed and transpose, seeking
// and loop on/off — driven offline through the real worklet DSP.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LehraDSP, segmentPadFor, DEC } from '../public/js/lehra/engine.worklet.js';
import { buildSegments, songBpm } from '../public/js/lehra/engine.js';
import { addInto, shiftToSa, formatTime } from '../public/js/practice/song.js';

const SR = 48000;
const BLOCK = 128;
const LEN = 3 * SR;

// A non-repeating "track": a slow chirp, so every position is recognisable.
const TRACK = new Float32Array(LEN).map((_, n) => 0.3 * Math.sin(2 * Math.PI * (200 * n / SR + 40 * (n / SR) ** 2)));

function songDsp({ speed = 1, pitch = 1, loop = true, startPhase = 0 }) {
  const posts = [];
  const dsp = new LehraDSP(SR, m => posts.push(m));
  const bpm = songBpm(LEN, SR);
  const segs = buildSegments(TRACK, SR, { beats: 1, tempos: [bpm] }, 0, segmentPadFor(SR), DEC);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].len, LEN, 'one segment, exactly the track');
  dsp.handle({ type: 'raag', id: 'song', beats: 1, tuning: 1, segs });
  dsp.handle({ type: 'play', id: 'song', session: 1, seq: 1, startFrame: 0, bpm: bpm * speed, pitch, tanpuraRatio: 1, loop, startPhase });
  return { dsp, posts };
}

function render(dsp, seconds, events = []) {
  const total = Math.round(seconds * SR), out = new Float32Array(total);
  const l = new Float32Array(BLOCK), t = new Float32Array(BLOCK);
  let e = 0;
  for (let f = 0; f < total; f += BLOCK) {
    while (e < events.length && events[e].t * SR <= f) dsp.handle(events[e++].msg);
    dsp.render(l, t, BLOCK, f);
    out.set(l.subarray(0, Math.min(BLOCK, total - f)), f);
  }
  return out;
}

const lastSound = x => { let k = 0; for (let i = 0; i < x.length; i++) if (x[i] !== 0) k = i; return k / SR; };

/** Upward zero crossings → frequency over [from, to) seconds. */
function freq(x, from, to) {
  let n = 0, first = -1, last = -1;
  for (let i = Math.round(from * SR) + 1; i < to * SR; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; else n++; last = i; }
  }
  return n * SR / (last - first);
}
const trackFreqAt = s => 200 + 80 * s; // the chirp's instantaneous frequency

test('song mode at 1× reproduces the track exactly and, with loop off, ends at its end', () => {
  const { dsp, posts } = songDsp({ loop: false });
  const out = render(dsp, 4);
  let maxErr = 0;
  for (let k = Math.round(0.01 * SR); k < LEN - Math.round(0.05 * SR); k++) maxErr = Math.max(maxErr, Math.abs(out[k] - TRACK[k]));
  assert.ok(maxErr < 1e-5, `max error ${maxErr}`);
  assert.ok(Math.abs(lastSound(out) - 3) < 0.005, `ended at ${lastSound(out)} s`);
  assert.ok(posts.some(p => p.type === 'ended'));
  const pos = posts.filter(p => p.type === 'pos').at(-2);
  assert.ok(Math.abs(pos.beat - pos.frame / LEN) < 1e-6, 'the clock reads the position in the track');
});

test('speed changes the tempo, not the pitch', () => {
  const { dsp } = songDsp({ speed: 1.5, loop: false });
  const out = render(dsp, 3);
  assert.ok(Math.abs(lastSound(out) - 2) < 0.01, `3 s track at 1.5× ended at ${lastSound(out)} s`);
  const f = freq(out, 0.9, 1.1); // track time 1.35–1.65 s
  assert.ok(Math.abs(f / trackFreqAt(1.5) - 1) < 0.01, `${f} Hz vs ${trackFreqAt(1.5)} Hz`);
});

test('transposing changes the pitch, not the tempo', () => {
  const ratio = Math.pow(2, 3 / 12);
  const { dsp } = songDsp({ pitch: ratio, loop: false });
  const out = render(dsp, 3.5);
  assert.ok(Math.abs(lastSound(out) - 3) < 0.01, `ended at ${lastSound(out)} s`);
  const f = freq(out, 1.4, 1.6);
  assert.ok(Math.abs(f / (trackFreqAt(1.5) * ratio) - 1) < 0.01, `${f} Hz vs ${trackFreqAt(1.5) * ratio} Hz`);
});

test('seeking jumps to the position and continues seamlessly from there', () => {
  const { dsp, posts } = songDsp({});
  const out = render(dsp, 1.6, [{ t: 0.5, msg: { type: 'seek', phase: 0.6, seq: 2 } }]);
  // After the crossfade the output is the track again, from about 1.8 s in
  const at = Math.round(1.0 * SR), n = Math.round(0.2 * SR);
  let bestLag = 0, bestErr = Infinity;
  for (let lag = Math.round(1.5 * SR); lag < Math.round(2.3 * SR); lag++) {
    let err = 0;
    for (let i = 0; i < n; i += 97) err += Math.abs(out[at + i] - TRACK[at - Math.round(1.0 * SR) + lag + i]);
    if (err < bestErr) { bestErr = err; bestLag = lag; }
  }
  const trackPosAt1s = bestLag / SR;
  assert.ok(Math.abs(trackPosAt1s - (1.8 + 0.5)) < 0.03, `at 1.0 s playing track time ${trackPosAt1s} s`);
  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(out[at + i] - TRACK[bestLag + i]));
  assert.ok(maxErr < 1e-5, `exact after the seek (max error ${maxErr})`);
  const report = posts.find(p => p.type === 'pos' && p.seq === 2);
  assert.ok(Math.abs((report.beat % 1) - (0.6 + (report.frame - 0.5 * SR) / LEN)) < 0.03, 'the clock follows the seek');
});

test('playback can start mid-track', () => {
  const { dsp } = songDsp({ startPhase: 0.25 });
  const out = render(dsp, 0.5);
  let maxErr = 0;
  for (let k = Math.round(0.01 * SR); k < out.length; k++) maxErr = Math.max(maxErr, Math.abs(out[k] - TRACK[k + LEN / 4]));
  assert.ok(maxErr < 1e-5, `max error ${maxErr}`);
});

test('practice helpers: stem mixing, matching my Sa, time format', () => {
  const a = new Float32Array([1, 2, 3]), b = new Float32Array([10, 20]);
  assert.deepEqual([...addInto(b, a)], [11, 22, 3], 'the longer track carries the sum');
  assert.equal(addInto(null, a), a);
  // Song in C (130.81), my Sa D (146.83): up 2 semitones; a song in A goes up a fourth rather than down a fifth
  assert.equal(shiftToSa(130.81, 146.83), 2);
  assert.equal(shiftToSa(220, 146.83), 5);
  assert.equal(shiftToSa(155.56, 146.83), -1);
  assert.equal(shiftToSa(185, 146.83), -4);
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(61.6), '1:01');
  assert.equal(formatTime(3725), '62:05');
});
