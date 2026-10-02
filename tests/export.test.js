// Lehra audio export: length and ending, fades, metronome ticks, the WAV
// format, and chunked rendering through the real engine DSP.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EXPORT_SEC, applyEndFades, applyOutputFade, clickTimes, estimateBytes, exportFileName,
  exportPlan, formatBytes, formatDuration, toPcm16, wavHeader,
} from '../public/js/lehra/export-format.js';
import { exportDsp, renderChunk } from '../public/js/lehra/export-render.js';
import { DEC, segmentPadFor } from '../public/js/lehra/engine.worklet.js';
import { buildSegments } from '../public/js/lehra/engine.js';

const SR = 44100;

test('export length: minutes round up to whole cycles and end on sam', () => {
  // Teentaal at 80 BPM: a 12 s cycle; 5 minutes = exactly 25 cycles
  const exact = exportPlan({ bpm: 80, cycleBeats: 16, unit: 'min', amount: 5, endOnSam: true, sr: SR });
  assert.equal(exact.cycles, 25);
  assert.equal(exact.endFrame, 300 * SR);
  assert.equal(exact.endBeat, 400);
  // Roopak at 90 BPM: 4.667 s cycles; 1 minute → 13 cycles (60.67 s)
  const up = exportPlan({ bpm: 90, cycleBeats: 7, unit: 'min', amount: 1, endOnSam: true, sr: SR });
  assert.equal(up.cycles, 13);
  assert.equal(up.endFrame, Math.round(13 * 7 * 60 / 90 * SR));
  assert.ok(up.totalFrames > up.endFrame, 'a tail after the final sam');
});

test('export length: cycles, exact minutes, tails and the one-hour cap', () => {
  const cycles = exportPlan({ bpm: 120, cycleBeats: 16, unit: 'cycles', amount: 3, sr: SR });
  assert.deepEqual([cycles.onSam, cycles.cycles, cycles.endFrame], [true, 3, 24 * SR]);

  const exact = exportPlan({ bpm: 90, cycleBeats: 7, unit: 'min', amount: 2.5, endOnSam: false, sr: SR });
  assert.deepEqual([exact.onSam, exact.cycles, exact.totalFrames], [false, null, 150 * SR]);

  const plain = exportPlan({ bpm: 120, cycleBeats: 16, unit: 'cycles', amount: 1, sr: SR });
  const drone = exportPlan({ bpm: 120, cycleBeats: 16, unit: 'cycles', amount: 1, tanpura: true, sr: SR });
  const reverb = exportPlan({ bpm: 120, cycleBeats: 16, unit: 'cycles', amount: 1, tanpura: true, reverb: true, sr: SR });
  assert.ok(plain.totalFrames < drone.totalFrames && drone.totalFrames < reverb.totalFrames);

  const long = exportPlan({ bpm: 60, cycleBeats: 16, unit: 'min', amount: 500, endOnSam: true, sr: SR });
  assert.ok(long.endFrame <= MAX_EXPORT_SEC * SR);
  assert.equal(exportPlan({ bpm: 60, cycleBeats: 16, unit: 'cycles', amount: 0, sr: SR }).cycles, 1);
});

test('ending on sam: the lehra stops at the final sam, the tanpura fades after it', () => {
  const plan = exportPlan({ bpm: 120, cycleBeats: 16, unit: 'cycles', amount: 1, tanpura: true, sr: SR });
  const n = plan.totalFrames;
  const lehra = new Float32Array(n).fill(1), tanpura = new Float32Array(n).fill(1);
  // in two chunks, to check the fades don't depend on where chunks split
  const cut = plan.endFrame - 100;
  applyEndFades(plan, SR, 0, lehra.subarray(0, cut), tanpura.subarray(0, cut));
  applyEndFades(plan, SR, cut, lehra.subarray(cut), tanpura.subarray(cut));
  assert.equal(lehra[plan.endFrame - Math.round(0.05 * SR)], 1, 'untouched before the fade');
  assert.ok(lehra[plan.endFrame - 200] > 0 && lehra[plan.endFrame - 200] < 1, 'fading');
  assert.equal(lehra[plan.endFrame], 0);
  assert.equal(lehra[n - 1], 0);
  assert.equal(tanpura[plan.endFrame - 1], 1, 'the drone sounds up to sam');
  assert.ok(tanpura[plan.endFrame + SR / 2] > 0 && tanpura[plan.endFrame + SR / 2] < 1, 'then rings and fades');
  assert.ok(tanpura[n - 1] < 1e-3);
});

test('an exact length fades the mix out at the end', () => {
  const plan = exportPlan({ bpm: 90, cycleBeats: 16, unit: 'min', amount: 0.5, endOnSam: false, sr: SR });
  const ch = new Float32Array(plan.totalFrames).fill(1);
  applyOutputFade(plan, SR, 0, [ch]);
  assert.equal(ch[0], 1);
  assert.equal(ch[plan.totalFrames - 3 * SR], 1);
  assert.ok(ch[plan.totalFrames - SR] > 0.4 && ch[plan.totalFrames - SR] < 0.6);
  assert.ok(ch[plan.totalFrames - 1] < 1e-3);
});

test('metronome ticks fall on the beats, numbered within the loop, and stop at the end', () => {
  const ticks = clickTimes({ bpm: 60, loopBeats: 4, subdivision: 2, endBeat: 6 }, SR, 0, 10 * SR);
  assert.equal(ticks.length, 12, 'beats 0 … 5.5');
  assert.deepEqual(ticks.slice(0, 3).map(t => [t.frame, t.beatIndex, t.subBeat]), [[0, 0, 0], [SR / 2, 0, 1], [SR, 1, 0]]);
  assert.equal(ticks[8].beatIndex, 0, 'beat 4 is sam of the second loop');
  // A window: only the ticks inside it
  const mid = clickTimes({ bpm: 60, loopBeats: 4, endBeat: 100 }, SR, 2.5 * SR, 4.5 * SR);
  assert.deepEqual(mid.map(t => t.frame / SR), [3, 4]);
});

test('WAV: a valid 16-bit PCM header and clipped, interleaved samples', () => {
  const h = new DataView(wavHeader(1000, 2, SR));
  const text = at => String.fromCharCode(...new Uint8Array(h.buffer, at, 4));
  assert.deepEqual([text(0), text(8), text(12), text(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(h.getUint32(4, true), 36 + 4000);
  assert.equal(h.getUint16(20, true), 1, 'PCM');
  assert.equal(h.getUint16(22, true), 2);
  assert.equal(h.getUint32(24, true), SR);
  assert.equal(h.getUint32(28, true), SR * 4);
  assert.equal(h.getUint16(32, true), 4);
  assert.equal(h.getUint16(34, true), 16);
  assert.equal(h.getUint32(40, true), 4000);

  const pcm = toPcm16([Float32Array.of(0, 1, 2, -1), Float32Array.of(0.5, -0.5, -3, 0)]);
  assert.deepEqual([...pcm], [0, 16384, 32767, -16383, 32767, -32767, -32767, 0]);
  assert.equal(estimateBytes('wav', 1000, 2), 4044);
  assert.equal(estimateBytes('mp3', SR * 60, 1), 1440000, '192 kbps');
});

test('names and labels', () => {
  assert.equal(formatDuration(303.4), '5:03');
  assert.equal(formatBytes(7340032), '7.0 MB');
  assert.equal(
    exportFileName({ raag: 'Misra Tilang', instrument: 'Esraj', taal: 'Teentaal', bpm: 90, sa: 'F# (low)', seconds: 303, ext: 'mp3' }),
    'lehra-Misra-Tilang-Esraj-Teentaal-90bpm-Sa-Fsharp-low-5m03s.mp3');
});

test('rendering in chunks is seamless: the same samples as one long render', () => {
  const taal = { beats: 4, tempos: [60, 120] };
  const lens = taal.tempos.map(T => Math.round(taal.beats * 60 / T * SR));
  const pcm = new Float32Array(lens[0] + lens[1] + SR);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / SR);
  const job = () => ({
    sr: SR, beats: taal.beats, tuning: 1, tanpura: null, bpm: 97, pitch: 1.07, tanpuraRatio: 1,
    segs: buildSegments(pcm, SR, taal, 0, segmentPadFor(SR), DEC),
  });
  const whole = renderChunk(exportDsp(job()), 0, 3 * SR).lehra;
  const dsp = exportDsp(job());
  const parts = [renderChunk(dsp, 0, 1000), renderChunk(dsp, 1000, SR), renderChunk(dsp, 1000 + SR, 2 * SR - 1000)];
  const chunked = new Float32Array(3 * SR);
  let at = 0;
  for (const p of parts) { chunked.set(p.lehra, at); at += p.lehra.length; }
  let maxErr = 0;
  for (let i = 0; i < whole.length; i++) maxErr = Math.max(maxErr, Math.abs(whole[i] - chunked[i]));
  assert.equal(maxErr, 0);
  assert.ok(whole.some(x => Math.abs(x) > 0.1), 'it rendered sound');
});
