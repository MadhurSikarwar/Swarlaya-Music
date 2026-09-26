// Lehra engine tests on synthetic "recordings" (pure tones with exact cycle
// lengths), driving the real AudioWorklet DSP offline.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LehraDSP, segmentPadFor, DEC } from '../public/js/lehra/engine.worklet.js';
import { buildSegments, countAdtsFrames, primingOffset, AAC_PRIMING_44K } from '../public/js/lehra/engine.js';
import { shouldEndNow } from '../public/js/lehra/practice.js';

const SR = 48000;
const BLOCK = 128;
const TAAL = { beats: 4, tempos: [60, 120] };       // cycles of 4 s and 2 s
const TONES = [220, 330];                           // one tone per recorded tempo

/** Recording laid out like the lehra .aac files: one cycle per tempo, back to back. */
function synthRecording(taal = TAAL, tones = TONES, lead = 0) {
  const lens = taal.tempos.map(T => Math.round(taal.beats * 60 / T * SR));
  const pcm = new Float32Array(lead + lens.reduce((a, b) => a + b, 0) + SR);
  let start = lead;
  lens.forEach((len, s) => {
    for (let i = 0; i < len; i++) pcm[start + i] = 0.3 * Math.sin(2 * Math.PI * tones[s] * i / SR);
    start += len;
  });
  return pcm;
}

function makeDsp({ bpm, pitch = 1, loop = true, taal = TAAL, tones = TONES, startFrame = 0 }) {
  const posts = [];
  const dsp = new LehraDSP(SR, m => posts.push(m));
  const segs = buildSegments(synthRecording(taal, tones), SR, taal, 0, segmentPadFor(SR), DEC);
  dsp.handle({ type: 'raag', id: 'a', beats: taal.beats, tuning: 1, segs });
  dsp.handle({ type: 'play', id: 'a', session: 1, seq: 1, startFrame, bpm, pitch, tanpuraRatio: 1, loop });
  return { dsp, posts, segs };
}

/** Render `seconds` of lehra output; `events` = [{ t, msg }] sent mid-render. */
function render(dsp, seconds, events = []) {
  const total = Math.round(seconds * SR);
  const out = new Float32Array(total);
  const blockL = new Float32Array(BLOCK), blockT = new Float32Array(BLOCK);
  let e = 0;
  for (let f = 0; f < total; f += BLOCK) {
    while (e < events.length && events[e].t * SR <= f) dsp.handle(events[e++].msg);
    dsp.render(blockL, blockT, BLOCK, f);
    out.set(blockL.subarray(0, Math.min(BLOCK, total - f)), f);
  }
  return out;
}

/** Dominant frequency from upward zero crossings. */
function frequency(x, from, to) {
  let crossings = 0, first = -1, last = -1;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      if (first < 0) first = i; else crossings++;
      last = i;
    }
  }
  return crossings * SR / (last - first);
}

test('at a recorded tempo, playback reproduces the recording exactly (loop included)', () => {
  const { dsp, segs } = makeDsp({ bpm: 60 });
  const out = render(dsp, 6); // 1.5 cycles: crosses the loop point
  const seg = segs[0];
  const core = seg.buf.subarray(seg.pre, seg.pre + seg.len);
  let maxErr = 0;
  for (let k = Math.round(0.01 * SR); k < out.length; k++) {
    maxErr = Math.max(maxErr, Math.abs(out[k] - core[k % seg.len]));
  }
  assert.ok(maxErr < 1e-5, `max error ${maxErr}`);
});

test('the musical clock runs at the requested tempo', () => {
  const { dsp, posts } = makeDsp({ bpm: 90 });
  render(dsp, 3);
  const last = posts.filter(p => p.type === 'pos').at(-1);
  assert.ok(Math.abs(last.bpf - 90 / 60 / SR) < 1e-12);
  // beat position at the anchor frame matches 90 BPM from sam at frame 0
  assert.ok(Math.abs(last.beat - last.frame * 90 / 60 / SR) < 1e-6);
});

test('the recording closest in tempo (after pitch shift) is used', () => {
  const { dsp } = makeDsp({ bpm: 115 });
  render(dsp, 0.5);
  assert.equal(dsp.voices.at(-1).seg.bpm, 120);

  // pitch ×1.5 at 90 BPM: the 60 BPM recording resampled ×1.5 is exactly 90 BPM
  const shifted = makeDsp({ bpm: 90, pitch: 1.5 });
  render(shifted.dsp, 0.5);
  assert.equal(shifted.dsp.voices.at(-1).seg.bpm, 60);
});

test('pitch shifting transposes by the requested ratio', () => {
  const { dsp } = makeDsp({ bpm: 90, pitch: 1.5 });
  const out = render(dsp, 2);
  const f = frequency(out, SR / 2, 2 * SR - 1000);
  assert.ok(Math.abs(f - 330) < 1.5, `measured ${f} Hz, expected 330 Hz`);
});

test('time-stretching keeps the pitch', () => {
  const { dsp } = makeDsp({ bpm: 70 }); // 60 BPM recording stretched ×1.17
  const out = render(dsp, 2);
  const f = frequency(out, SR / 2, 2 * SR - 1000);
  assert.ok(Math.abs(f - 220) < 1.5, `measured ${f} Hz, expected 220 Hz`);
});

test('a live tempo sweep switches recordings without clicks', () => {
  const events = [];
  for (let i = 0; i <= 60; i++) events.push({ t: 0.5 + i * 0.05, msg: { type: 'params', bpm: 60 + i } });
  const { dsp } = makeDsp({ bpm: 60 });
  const out = render(dsp, 4, events);
  assert.equal(dsp.voices.at(-1).seg.bpm, 120);
  // largest sample-to-sample step stays within what a 330 Hz tone at 0.3 can do
  let maxStep = 0;
  for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
  const toneStep = 0.3 * 2 * Math.PI * 330 / SR;
  assert.ok(maxStep < toneStep * 1.5, `max step ${maxStep} vs tone ${toneStep}`);
});

test('with loop off, playback ends exactly at the end of the cycle', () => {
  const { dsp, posts } = makeDsp({ bpm: 60 });
  const out = render(dsp, 6, [{ t: 1, msg: { type: 'params', loop: false } }]);
  let lastSound = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) lastSound = i;
  assert.ok(Math.abs(lastSound / SR - 4) < 0.005, `ended at ${lastSound / SR} s`);
  assert.ok(posts.some(p => p.type === 'ended'));
});

test('switching to a different taal lands on its sam as the crossfade completes', () => {
  const { dsp, posts } = makeDsp({ bpm: 60 });
  const taal3 = { beats: 3, tempos: [60] };
  dsp.handle({ type: 'raag', id: 'b', beats: 3, tuning: 1,
    segs: buildSegments(synthRecording(taal3, [440]), SR, taal3, 0, segmentPadFor(SR), DEC) });
  const switchAt = 1.3;
  render(dsp, 2.5, [{ t: switchAt, msg: { type: 'switch', id: 'b', resetPhase: true, seq: 2 } }]);
  const a = posts.find(p => p.type === 'pos' && p.seq === 2);
  const sam = Math.ceil(a.beat / 3) * 3;
  const samTime = (a.frame + (sam - a.beat) / a.bpf) / SR;
  assert.equal(sam % 3, 0);
  assert.ok(Math.abs(samTime - (switchAt + 0.08)) < 0.03, `sam at ${samTime} s`);
});

test('loop points are made seamless even when the recording is not', () => {
  // Like the real files: continuous across segment joins, but 221.3 Hz does not
  // fit a whole number of periods in either cycle, so each raw loop jumps.
  const total = Math.round((4 + 2 + 1) * SR);
  const pcm = new Float32Array(total).map((_, n) => 0.3 * Math.sin(2 * Math.PI * 221.3 * n / SR));
  const segs = buildSegments(pcm, SR, TAAL, 0, segmentPadFor(SR), DEC);
  const toneStep = 0.3 * 2 * Math.PI * 221.3 / SR;       // max step of the tone itself
  for (const seg of segs) {
    const b = seg.buf, p = seg.pre, len = seg.len;
    const rawJump = Math.abs(pcm[Math.round(seg.bpm === 60 ? 0 : 4 * SR)] - pcm[Math.round(seg.bpm === 60 ? 4 * SR : 6 * SR) - 1]);
    assert.ok(rawJump > toneStep * 2, `seg ${seg.bpm}: raw loop should jump (${rawJump})`);
    const wrapStep = Math.abs(b[p] - b[p - 1]);           // last → first sample
    assert.ok(wrapStep < toneStep * 1.05, `seg ${seg.bpm}: wrap step ${wrapStep}`);
    assert.equal(b[p - 1], b[p + len - 1]);                // circular padding
  }
});

test('a delayed start (count-in) begins exactly at sam, with the clock at beat 0 there', () => {
  const startFrame = Math.round(1.5 * SR); // e.g. a 1.5 s count-in
  const { dsp, posts, segs } = makeDsp({ bpm: 60, startFrame });
  const out = render(dsp, 3);
  let first = -1;
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) { first = i; break; }
  assert.equal(first, startFrame + 1, 'silent until sam (then the 4 ms start fade)');
  const seg = segs[0], core = seg.buf.subarray(seg.pre, seg.pre + seg.len);
  const k = startFrame + Math.round(0.01 * SR);
  assert.ok(Math.abs(out[k] - core[k - startFrame]) < 1e-5, 'plays the cycle from its sam');
  const pos = posts.find(p => p.type === 'pos');
  assert.equal(pos.frame, startFrame);
  assert.equal(pos.beat, 0);
});

test('stopping during the count-in cancels before anything sounds', () => {
  const { dsp, posts } = makeDsp({ bpm: 60, startFrame: SR });
  const out = render(dsp, 2, [{ t: 0.5, msg: { type: 'stop' } }]);
  assert.ok(out.every(v => v === 0));
  assert.equal(dsp.playing, false);
  assert.ok(!posts.some(p => p.type === 'pos'));
});

test('practice timer: "stop after N cycles" ends exactly on sam via loop-off', () => {
  // Drive the real DSP the way practice.js does: a clock tick every 25 ms,
  // loop switched off once shouldEndNow() says so.
  for (const bpm of [60, 97]) {
    const { dsp } = makeDsp({ bpm });
    const total = Math.round(12 * SR), out = new Float32Array(total);
    const blockL = new Float32Array(BLOCK), blockT = new Float32Array(BLOCK);
    let lastTick = -Infinity, sent = false;
    for (let f = 0; f < total; f += BLOCK) {
      if (f - lastTick >= 0.025 * SR) {
        lastTick = f;
        const a = dsp.anchor;
        if (a && !sent) {
          const beat = a.beat + (f - a.frame) * a.bpf;
          if (shouldEndNow({ unit: 'cycles', amount: 2 }, { beat, beats: 4, bpm, elapsed: f / SR })) {
            dsp.handle({ type: 'params', loop: false });
            sent = true;
          }
        }
      }
      dsp.render(blockL, blockT, BLOCK, f);
      out.set(blockL.subarray(0, Math.min(BLOCK, total - f)), f);
    }
    let lastSound = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== 0) lastSound = i;
    const expected = 2 * 4 * 60 / bpm;
    assert.ok(Math.abs(lastSound / SR - expected) < 0.005, `${bpm} BPM: ended at ${lastSound / SR} s, sam at ${expected} s`);
  }
});

test('practice timer: minutes end on the first sam with enough lead, never mid-fade', () => {
  const clock = (beat, elapsed) => ({ beat, beats: 16, bpm: 120, elapsed });
  const plan = { unit: 'min', amount: 1 };
  assert.equal(shouldEndNow(plan, clock(100, 59.9)), false);
  assert.equal(shouldEndNow(plan, clock(100, 60.1)), true);
  // 0.1 s before sam is too late for this cycle: wait until after it
  assert.equal(shouldEndNow(plan, clock(127.8, 64)), false);
  assert.equal(shouldEndNow(plan, clock(128.05, 64.2)), true);
  assert.equal(shouldEndNow({ unit: 'cycles', amount: 3 }, clock(-3, -1)), false, 'count-in');
});

test('AAC priming offset: ADTS frame counting and decoder trimming', () => {
  // three ADTS frames of 10 bytes each (sync 0xFFF1, frame length 10, 1 raw block)
  const frame = [0xff, 0xf1, 0x50, 0x80, 0x01, 0x40, 0xfc, 0, 0, 0];
  const bytes = new Uint8Array([...frame, ...frame, ...frame]);
  assert.equal(countAdtsFrames(bytes.buffer), 3);
  assert.equal(countAdtsFrames(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer), 0);

  // decoder kept everything → full priming; trimmed 1024 → the rest
  assert.equal(primingOffset(3 * 1024, 44100, 3), AAC_PRIMING_44K);
  assert.equal(primingOffset(2 * 1024, 44100, 3), AAC_PRIMING_44K - 1024);
  assert.ok(Math.abs(primingOffset(3 * 1024 * 48000 / 44100, 48000, 3) - AAC_PRIMING_44K * 48000 / 44100) < 1e-6);
});
