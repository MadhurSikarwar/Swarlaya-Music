/**
 * Rendering for the Lehra audio export: the real-time engine's DSP
 * (LehraDSP, engine.worklet.js) driven offline, so an exported file sounds
 * exactly like playback — at ~70–90× real time. Runs in export.worker.js,
 * or on the main thread where module workers aren't available.
 *
 * job = { sr, beats, tuning, segs, tanpura: { buf, loopLen, pre, scale } | null,
 *         bpm, pitch, tanpuraRatio }  (segs and the drone as for LehraEngine)
 */
import { LehraDSP } from './engine.worklet.js';

const BLOCK = 512; // the DSP's largest block; the output doesn't depend on it

/** A LehraDSP playing `job` from sam at frame 0, looping. */
export function exportDsp(job) {
  const dsp = new LehraDSP(job.sr);
  dsp.handle({ type: 'raag', id: 'export', beats: job.beats, tuning: job.tuning, segs: job.segs });
  if (job.tanpura) dsp.handle({ type: 'tanpura', ...job.tanpura });
  dsp.handle({
    type: 'play', id: 'export', session: 1, seq: 1, startFrame: 0,
    bpm: job.bpm, pitch: job.pitch, tanpuraRatio: job.tanpuraRatio, loop: true,
  });
  return dsp;
}

/** Frames [start, start + frames) of the lehra and tanpura outputs. */
export function renderChunk(dsp, start, frames) {
  const lehra = new Float32Array(frames), tanpura = new Float32Array(frames);
  const l = new Float32Array(BLOCK), t = new Float32Array(BLOCK);
  for (let i = 0; i < frames; i += BLOCK) {
    const n = Math.min(BLOCK, frames - i);
    dsp.render(l, t, n, start + i);
    lehra.set(n === BLOCK ? l : l.subarray(0, n), i);
    tanpura.set(n === BLOCK ? t : t.subarray(0, n), i);
  }
  return { lehra, tanpura };
}
