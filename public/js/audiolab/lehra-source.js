/**
 * A Swaralaya lehra as the Audio Lab's lehra: pick instrument, taal and raag
 * from the site's catalogue, set the tempo and Sa (or take both from the
 * tabla), and it is rendered here with the Lehra Player's own engine — the
 * same DSP as playback and export — as whole cycles starting on sam. The
 * server then loops it, and because it starts on sam the sams are known
 * exactly (for alignment and the sam-accuracy report).
 */
import { CATALOGUE } from '../lehra/catalogue.js';
import { BASE_HZ, FINE_TUNE_MAX_HZ, FINE_TUNE_MIN_HZ } from '../lehra/state.js';
import { buildSegments, countAdtsFrames, primingOffset } from '../lehra/engine.js';
import { DEC, segmentPadFor } from '../lehra/engine.worklet.js';
import { exportDsp, renderChunk } from '../lehra/export-render.js';
import { EXPORT_SR, toPcm16, wavHeader } from '../lehra/export-format.js';
import { cyclesToRender } from './format.js';

export const SA_RANGE = { min: FINE_TUNE_MIN_HZ, max: FINE_TUNE_MAX_HZ };

export function instruments() {
  return Object.keys(CATALOGUE);
}

export function taalsFor(instrument) {
  return Object.keys(CATALOGUE[instrument]?.taals || {});
}

export function raagsFor(instrument, taal) {
  return Object.keys(CATALOGUE[instrument]?.taals?.[taal]?.raags || {});
}

export function taalInfo(instrument, taal) {
  const t = CATALOGUE[instrument]?.taals?.[taal];
  if (!t) return null;
  const cycles = t.cycles || 1;
  return { beats: t.beats, beatsPerCycle: t.beats / cycles, minTempo: t.minTempo, maxTempo: t.maxTempo, tempos: t.tempos };
}

/** A tempo the taal's recordings can play: clamped to its range. */
export function clampTempo(instrument, taal, bpm) {
  const t = taalInfo(instrument, taal);
  if (!t || !(bpm > 0)) return bpm;
  return Math.round(Math.min(t.maxTempo, Math.max(t.minTempo, bpm)));
}

/** A tabla tempo (which a beat tracker may report at half or double) brought into the taal's range. */
export function tempoFromTabla(instrument, taal, tablaBpm) {
  const t = taalInfo(instrument, taal);
  if (!t || !(tablaBpm > 0)) return null;
  let bpm = tablaBpm;
  while (bpm < t.minTempo && bpm * 2 <= t.maxTempo) bpm *= 2;
  while (bpm > t.maxTempo && bpm / 2 >= t.minTempo) bpm /= 2;
  return clampTempo(instrument, taal, bpm);
}

const cache = new Map();   // asset file → { segs, sr }

async function segmentsFor(file, taal) {
  if (cache.has(file)) return cache.get(file);
  const url = `/assets/${encodeURIComponent(file)}.aac`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    res = await fetch(url, { cache: 'reload' });     // one retry: a dropped connection is not worth an error
  }
  if (!res.ok) throw new Error(`Could not load the lehra recording (${res.status}).`);
  const bytes = await res.arrayBuffer();
  const adts = countAdtsFrames(bytes);
  const decoder = new OfflineAudioContext(1, 1, EXPORT_SR);
  const audio = await decoder.decodeAudioData(bytes.slice(0));
  const segs = buildSegments(audio.getChannelData(0), audio.sampleRate, taal,
    primingOffset(audio.length, audio.sampleRate, adts), segmentPadFor(audio.sampleRate), DEC);
  const entry = { segs };
  cache.set(file, entry);
  return entry;
}

/**
 * Render whole cycles (at least ~20 s) of the chosen lehra at `bpm` and `saHz`.
 * Resolves { file: File (WAV), meta: { bpm, beats, name }, seconds, cycleSeconds }.
 */
export async function renderLehra({ instrument, taal, raag, bpm, saHz }) {
  const inst = CATALOGUE[instrument];
  const t = inst?.taals?.[taal];
  const r = t?.raags?.[raag];
  if (!r) throw new Error('Choose an instrument, taal and raag.');
  const info = taalInfo(instrument, taal);
  const tempo = clampTempo(instrument, taal, bpm);
  const sa = Math.min(SA_RANGE.max, Math.max(SA_RANGE.min, saHz));
  const { segs } = await segmentsFor(r.file, t);
  const cycleSeconds = info.beatsPerCycle * 60 / tempo;
  const cycles = cyclesToRender(cycleSeconds);
  const frames = Math.round(cycles * cycleSeconds * EXPORT_SR);
  // the DSP consumes its segment buffers: give it copies so the cache stays usable
  const job = {
    sr: EXPORT_SR, beats: t.beats, tuning: inst.tuningCoeff ?? 1,
    segs: segs.map(s => ({ ...s, buf: s.buf.slice(), dec: s.dec.slice() })),
    tanpura: null, bpm: tempo, pitch: sa / BASE_HZ, tanpuraRatio: 1,
  };
  const dsp = exportDsp(job);
  const pcm = new Float32Array(frames);
  const CHUNK = EXPORT_SR * 5;
  for (let i = 0; i < frames; i += CHUNK) {
    const n = Math.min(CHUNK, frames - i);
    pcm.set(renderChunk(dsp, i, n).lehra, i);
    await new Promise(res => setTimeout(res));         // keep the page responsive
  }
  // a whisper of fade at the very ends; the server crossfades the loop seam
  const edge = Math.round(0.005 * EXPORT_SR);
  for (let i = 0; i < edge; i++) { pcm[i] *= i / edge; pcm[frames - 1 - i] *= i / edge; }
  const blob = new Blob([wavHeader(frames, 1, EXPORT_SR), toPcm16([pcm])], { type: 'audio/wav' });
  const name = `${raag} · ${taal.replace(/\s*\(.*\)$/, '')} · ${instrument} · ${tempo} BPM`;
  const file = new File([blob], `lehra-${raag}-${tempo}bpm.wav`.replace(/\s+/g, '-'), { type: 'audio/wav' });
  return {
    file, seconds: frames / EXPORT_SR, cycleSeconds,
    meta: { bpm: tempo, beats: info.beatsPerCycle, name },
  };
}
