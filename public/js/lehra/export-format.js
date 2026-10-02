/**
 * Lehra audio export (export.js): how long an export runs and how it ends,
 * where its metronome ticks fall, and the WAV file format. No browser APIs,
 * so all of it is unit-tested (tests/export.test.js).
 *
 * Frame 0 of an export is the sam of the first cycle, and the tempo is
 * constant, so beat b sounds at frame b × 60 × sr / bpm — exactly where the
 * engine's musical clock puts it during playback.
 */

export const EXPORT_SR = 44100;
export const MAX_EXPORT_SEC = 60 * 60;   // one hour
export const MP3_KBPS = 192;

const LEHRA_END_FADE_SEC = 0.04;  // the lehra stops on sam, like playback with loop off …
const DRONE_TAIL_SEC = 1.5;       // … while the tanpura rings on and fades away
const REVERB_TAIL_SEC = 2.5;      // the reverb's impulse response
const MIN_TAIL_SEC = 0.3;
const EXACT_FADE_SEC = 2;         // an exact length (not ending on sam) fades out

/**
 * The length of an export, in frames at `sr`:
 *   unit 'cycles'  `amount` whole taal cycles, ending on sam;
 *   unit 'min'     `amount` minutes — rounded up to whole cycles (ending on
 *                  sam) if `endOnSam`, else exactly, fading out at the end.
 * `cycleBeats` = matras in one taal cycle. An ending on sam is followed by a
 * tail for the tanpura and the reverb to ring out. Capped at an hour.
 */
export function exportPlan({ bpm, cycleBeats, unit, amount, endOnSam, tanpura = false, reverb = false, sr = EXPORT_SR }) {
  const cycleSec = cycleBeats * 60 / bpm;
  const maxCycles = Math.max(1, Math.floor(MAX_EXPORT_SEC / cycleSec));
  const wanted = Number.isFinite(amount) && amount > 0 ? amount : 1;
  let cycles = null;
  let endSec = 0;
  if (unit === 'cycles') {
    cycles = Math.min(maxCycles, Math.max(1, Math.round(wanted)));
  } else {
    endSec = Math.min(MAX_EXPORT_SEC, wanted * 60);
    if (endOnSam) cycles = Math.min(maxCycles, Math.max(1, Math.ceil(endSec / cycleSec - 1e-9)));
  }
  if (cycles !== null) {
    const endFrame = Math.round(cycles * cycleSec * sr);
    const tail = Math.max(MIN_TAIL_SEC, tanpura ? DRONE_TAIL_SEC : 0, reverb ? REVERB_TAIL_SEC : 0);
    return { onSam: true, cycles, endBeat: cycles * cycleBeats, endFrame, totalFrames: endFrame + Math.round(tail * sr) };
  }
  const endFrame = Math.round(endSec * sr);
  return { onSam: false, cycles: null, endBeat: endSec * bpm / 60, endFrame, totalFrames: endFrame };
}

/**
 * Ending on sam: the lehra fades out over 40 ms into the final sam and the
 * tanpura fades over the tail after it. Applied in place to one rendered
 * chunk whose first frame is `start` (tanpura may be null).
 */
export function applyEndFades(plan, sr, start, lehra, tanpura) {
  if (!plan.onSam) return;
  const fade = Math.round(LEHRA_END_FADE_SEC * sr);
  const from = plan.endFrame - fade;
  if (start + lehra.length <= from) return;
  const tail = Math.max(1, plan.totalFrames - plan.endFrame);
  for (let i = Math.max(0, from - start); i < lehra.length; i++) {
    const f = start + i;
    lehra[i] *= Math.max(0, (plan.endFrame - f) / fade);
    if (tanpura && f >= plan.endFrame) tanpura[i] *= Math.cos(Math.min(1, (f - plan.endFrame) / tail) * Math.PI / 2);
  }
}

/** An exact-length export fades out over its last seconds: in place, on a mixed chunk starting at `start`. */
export function applyOutputFade(plan, sr, start, channels) {
  if (plan.onSam) return;
  const len = Math.max(1, Math.min(Math.round(EXACT_FADE_SEC * sr), Math.floor(plan.totalFrames / 4)));
  const from = plan.totalFrames - len;
  for (const ch of channels) {
    for (let i = Math.max(0, from - start); i < ch.length; i++) {
      ch[i] *= Math.max(0, (plan.totalFrames - (start + i)) / len);
    }
  }
}

/**
 * Metronome ticks in frames [from, to), before `endBeat`:
 * [{ frame, beatIndex, subBeat }] with beatIndex the 0-based beat in the
 * recorded loop of `loopBeats` (as the live scheduler numbers them).
 */
export function clickTimes({ bpm, loopBeats, subdivision = 1, endBeat }, sr, from, to) {
  const framesPerBeat = 60 * sr / bpm;
  const ticks = [];
  for (let k = Math.max(0, Math.ceil(from / framesPerBeat * subdivision - 1e-9)); ; k++) {
    const beat = k / subdivision;
    const frame = beat * framesPerBeat;
    if (beat >= endBeat - 1e-9 || frame >= to) break;
    ticks.push({ frame, beatIndex: Math.floor(beat + 1e-6) % loopBeats, subBeat: k % subdivision });
  }
  return ticks;
}

/** The 44-byte header of a 16-bit PCM WAV file of `frames` frames. */
export function wavHeader(frames, channels, sr) {
  const dataBytes = frames * channels * 2;
  const v = new DataView(new ArrayBuffer(44));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);                 // fmt chunk size
  v.setUint16(20, 1, true);                  // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * channels * 2, true);  // bytes per second
  v.setUint16(32, channels * 2, true);       // bytes per frame
  v.setUint16(34, 16, true);                 // bits per sample
  text(36, 'data');
  v.setUint32(40, dataBytes, true);
  return v.buffer;
}

/** Float samples (±1) to 16-bit, channels interleaved (one channel: as is). */
export function toPcm16(channels) {
  const c = channels.length, n = channels[0].length;
  const out = new Int16Array(n * c);
  for (let ch = 0; ch < c; ch++) {
    const x = channels[ch];
    for (let i = 0; i < n; i++) {
      const s = x[i] > 1 ? 1 : x[i] < -1 ? -1 : x[i];
      out[i * c + ch] = Math.round(s * 32767);
    }
  }
  return out;
}

/** Roughly how big the file will be. */
export function estimateBytes(format, frames, channels, sr = EXPORT_SR) {
  return format === 'wav' ? 44 + frames * channels * 2 : Math.round(frames / sr * MP3_KBPS * 125);
}

/** 303.4 → "5:03" */
export function formatDuration(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 7340032 → "7.0 MB" */
export function formatBytes(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** lehra-Charukeshi-Sarangi-Roopak-90bpm-Sa-D-5m03s.mp3 */
export function exportFileName({ raag, instrument, taal, bpm, sa, seconds, ext }) {
  const clean = s => String(s || '').replace(/#/g, 'sharp').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const s = Math.round(seconds);
  const length = `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return ['lehra', raag, instrument, taal, `${bpm}bpm`, `Sa ${sa}`, length].map(clean).filter(Boolean).join('-') + '.' + ext;
}
