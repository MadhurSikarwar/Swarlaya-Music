/**
 * Export audio: save the lehra — the selected instrument, taal and raag at
 * the current tempo and Sa — as an MP3 or WAV file of a chosen length.
 *
 * Nothing is recorded in real time. Per chunk of ~20 s:
 *
 *   export.worker.js   the engine's DSP renders the lehra and tanpura
 *         ↓            (the same code as playback, far faster than real time)
 *   OfflineAudioContext  volumes → bass/treble → reverb → compressor, the
 *         ↓            playback chain (audio.js createFxChain), plus the
 *         ↓            metronome if chosen — so the file sounds like
 *         ↓            playback
 *   WAV (here) or MP3 (mp3.worker.js, LAME)
 *
 * Each chunk is mixed with a few seconds of the audio before it, so the
 * filters, reverb and compressor carry on across chunk joins, and memory
 * stays small however long the export is.
 */
import { $ } from '../core/dom.js';
import { BASE_HZ, TANPURA_BASE_HZ, onSettingsChange, state } from './state.js';
import { CATALOGUE } from './catalogue.js';
import { buildSegments, countAdtsFrames, primingOffset } from './engine.js';
import { DEC, segmentPadFor } from './engine.worklet.js';
import { exportDsp, renderChunk } from './export-render.js';
import {
  EXPORT_SR, MP3_KBPS, applyEndFades, applyOutputFade, clickTimes, estimateBytes, exportFileName,
  exportPlan, formatBytes, formatDuration, toPcm16, wavHeader,
} from './export-format.js';
import { createFxChain, reverbImpulse } from './audio.js';
import { reverbLevels } from './mixer.js';
import { decodeClickSounds, playClick } from './metronome.js';
import { persistControl } from './settings.js';
import { droneLoop, styleKey } from './tanpura.js';

const SR = EXPORT_SR;
const CHUNK = 20 * SR;
const WARMUP_SEC = 0.5;         // filters and compressor settle within this
const WARMUP_REVERB_SEC = 3;    // …the reverb needs its whole impulse response (2.5 s)

class Cancelled extends Error {}

let running = null;   // { cancelled } while an export runs
const files = [];     // finished exports: { name, file, url, bytes, secs }

// ── What to export ─────────────────────────────────────────────────
function saLabel() {
  const sel = $('pitchSelect');
  const preset = parseFloat(sel.value);
  if (Math.abs(preset - state.pitchHz) < 1e-6) return sel.options[sel.selectedIndex].text.replace(/\s*\(Original\)/, '');
  return `${state.pitchHz.toFixed(1)} Hz`;
}

function form() {
  const unit = $('exUnit').value;
  return {
    unit,
    amount: parseFloat($('exAmount').value),
    endOnSam: unit === 'cycles' || $('exEndSam').checked,
    format: $('exFormat').value,
    tanpura: $('exTanpura').checked && +$('tanpuraVol').value > 0,
    metronome: $('exMetronome').checked,
  };
}

/** Everything the export needs, read once when it starts (later changes don't affect it). */
function snapshot() {
  const taal = state.taalData;
  const f = form();
  const reverb = reverbLevels(+$('fxReverb').value);
  return {
    ...f,
    instrument: state.instrument,
    taalName: (state.taal || '').replace(/\s*\(.*\)$/, ''),
    raag: state.raag,
    file: CATALOGUE[state.instrument].taals[state.taal].raags[state.raag].file,
    tuning: CATALOGUE[state.instrument].tuningCoeff ?? 1,
    taal,
    bpm: state.bpm,
    pitchHz: state.pitchHz,
    sa: saLabel(),
    volumes: {
      lehra: +$('lehraVol').value / 100,
      tanpura: f.tanpura ? +$('tanpuraVol').value / 100 : 0,
      metronome: +$('metronomeVol').value / 100,
    },
    bass: +$('fxBass').value,
    treble: +$('fxTreble').value,
    reverb,
    channels: reverb.wet > 0 ? 2 : 1, // the reverb is stereo; everything else is mono
    tanpuraKey: f.tanpura ? styleKey() : null,
    click: f.metronome ? {
      sound: state.metronomeSound,
      subdivision: state.metronomeSubdivision || 1,
      accents: state.metronomeAccents,
    } : null,
  };
}

function planFor(s) {
  return exportPlan({
    bpm: s.bpm,
    cycleBeats: s.taal.beats / (s.taal.cycles || 1),
    unit: s.unit, amount: s.amount, endOnSam: s.endOnSam,
    tanpura: s.tanpura, reverb: s.channels === 2,
  });
}

// ── Rendering ──────────────────────────────────────────────────────
/**
 * The DSP renderer: { next(frames) → Promise<{ lehra, tanpura }>, close() }.
 * A module worker, or this thread where the browser can't run one.
 */
async function startRenderer(job) {
  try {
    return await workerRenderer(job);
  } catch (err) {
    if (!err.unsupported) throw err;
    console.warn('Audio export: rendering on the main thread —', err.message);
    const dsp = exportDsp(job);
    let frame = 0;
    return {
      next: async frames => {
        await new Promise(r => setTimeout(r)); // let the page update between chunks
        const out = renderChunk(dsp, frame, frames);
        frame += frames;
        return out;
      },
      close() {},
    };
  }
}

function workerRenderer(job) {
  return new Promise((resolve, reject) => {
    let worker, loaded = false, pending = null;
    const fail = (message, unsupported) => {
      const err = new Error(message);
      err.unsupported = unsupported;
      worker.terminate();
      if (pending) { pending.reject(err); pending = null; } else reject(err);
    };
    try {
      worker = new Worker(new URL('./export.worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(Object.assign(err, { unsupported: true }));
      return;
    }
    worker.onerror = e => {
      e.preventDefault();
      fail(e.message || 'the export worker failed', !loaded);
    };
    worker.onmessage = ({ data }) => {
      if (data.type === 'loaded') {
        loaded = true;
        const transfer = job.segs.flatMap(s => [s.buf.buffer, s.dec.buffer]);
        if (job.tanpura) transfer.push(job.tanpura.buf.buffer);
        worker.postMessage({ type: 'start', job }, transfer);
      } else if (data.type === 'ready') {
        resolve({
          next: frames => new Promise((res, rej) => {
            pending = { resolve: res, reject: rej };
            worker.postMessage({ type: 'next', frames });
          }),
          close: () => worker.terminate(),
        });
      } else if (data.type === 'chunk') {
        const p = pending;
        pending = null;
        p?.resolve(data);
      } else if (data.type === 'error') {
        fail(data.message, false);
      }
    };
  });
}

// ── Encoders: start(), push(channels) (one call at a time), finish() → Blob, close() ──
function wavEncoder(channels, frames) {
  const parts = [wavHeader(frames, channels, SR)];
  return {
    start: async () => {},
    push: async pcm => { parts.push(toPcm16(pcm)); },
    finish: async () => new Blob(parts, { type: 'audio/wav' }),
    close() {},
  };
}

function mp3Encoder(channels) {
  const worker = new Worker(new URL('./mp3.worker.js', import.meta.url));
  let waiting = null;
  const call = (msg, transfer = []) => new Promise((resolve, reject) => {
    waiting = { resolve, reject };
    worker.postMessage(msg, transfer);
  });
  const settle = (fn, value) => { const w = waiting; waiting = null; if (w) w[fn](value); };
  worker.onmessage = ({ data }) => {
    if (data.type === 'error') settle('reject', new Error(data.message));
    else settle('resolve', data);
  };
  worker.onerror = e => {
    e.preventDefault();
    settle('reject', new Error('The MP3 encoder stopped unexpectedly. Try a WAV instead.'));
  };
  return {
    start: () => call({ type: 'start', channels, sr: SR, kbps: MP3_KBPS }),
    push: pcm => {
      const planar = pcm.map(ch => toPcm16([ch]));
      return call({ type: 'data', pcm: planar }, planar.map(p => p.buffer));
    },
    finish: () => call({ type: 'end' }).then(d => d.blob),
    close: () => worker.terminate(),
  };
}

// ── Mixing: the playback chain, offline ────────────────────────────
/**
 * Mix one chunk. `input` holds `warm` frames of earlier audio followed by
 * the chunk (which starts at export frame `start`); returns the chunk's
 * mixed channels.
 */
async function mixChunk(s, input, warm, start, ir, clickSounds, plan) {
  const len = input.lehra.length;
  const ctx = new OfflineAudioContext(s.channels, len, SR);
  const fx = createFxChain(ctx, ir);
  fx.bass.gain.value = s.bass;
  fx.treble.gain.value = s.treble;
  fx.dry.gain.value = s.reverb.dry;
  fx.wet.gain.value = s.reverb.wet;
  if (s.reverb.wet > 0) {
    fx.treble.connect(fx.reverb);
    fx.reverb.connect(fx.wet);
  }
  fx.compressor.connect(ctx.destination);

  const play = (samples, gain) => {
    if (!(gain > 0)) return;
    const buffer = ctx.createBuffer(1, len, SR);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(fx.mix);
    src.start(0);
  };
  play(input.lehra, s.volumes.lehra);
  play(input.tanpura, s.volumes.tanpura);
  const from = start - warm;

  // Like playback, the metronome bypasses the effects.
  if (s.click && s.volumes.metronome > 0) {
    const ticks = clickTimes({ bpm: s.bpm, loopBeats: s.taal.beats, subdivision: s.click.subdivision, endBeat: plan.endBeat }, SR, from, from + len);
    if (ticks.length) {
      const met = ctx.createGain();
      met.gain.value = s.volumes.metronome;
      met.connect(ctx.destination);
      for (const t of ticks) {
        playClick(ctx, met, (t.frame - from) / SR, {
          taal: s.taal, beatIndex: t.beatIndex, subBeat: t.subBeat,
          sound: s.click.sound, accents: s.click.accents, sounds: clickSounds,
        });
      }
    }
  }

  const out = await ctx.startRendering();
  return Array.from({ length: s.channels }, (_, c) => out.getChannelData(c).slice(warm));
}

function joined(a, b) {
  if (!a || !a.length) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// ── The export ─────────────────────────────────────────────────────
async function exportAudio(s, job, progress) {
  const check = () => { if (job.cancelled) throw new Cancelled(); };
  const plan = planFor(s);
  const total = plan.totalFrames;

  // Assets, decoded at the export's sample rate
  progress('Preparing the raag…', 0);
  const decoder = new OfflineAudioContext(1, 1, SR);
  const bytesOf = async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
    return res.arrayBuffer();
  };
  const decode = async url => decoder.decodeAudioData(await bytesOf(url));

  const bytes = await bytesOf(`/assets/${encodeURIComponent(s.file)}.aac`);
  const adts = countAdtsFrames(bytes);
  const raag = await decoder.decodeAudioData(bytes.slice(0));
  const segs = buildSegments(raag.getChannelData(0), raag.sampleRate, s.taal,
    primingOffset(raag.length, raag.sampleRate, adts), segmentPadFor(raag.sampleRate), DEC);
  check();

  let tanpura = null;
  if (s.tanpuraKey) {
    const { loop, sa } = await droneLoop(s.tanpuraKey, decode);
    tanpura = { buf: loop.buf, loopLen: loop.loopLen, pre: loop.pre, scale: TANPURA_BASE_HZ / sa };
  }
  const clickSounds = s.click && s.click.sound === 'classic'
    ? await decodeClickSounds(b => decoder.decodeAudioData(b)) : null;
  check();

  const encoder = s.format === 'mp3' ? mp3Encoder(s.channels) : wavEncoder(s.channels, total);
  job.cleanup.push(() => encoder.close());
  if (s.format === 'mp3') progress('Loading the MP3 encoder…', 0);
  await encoder.start();
  check();

  const renderer = await startRenderer({
    sr: SR, beats: s.taal.beats, tuning: s.tuning, segs, tanpura,
    bpm: s.bpm, pitch: s.pitchHz / BASE_HZ, tanpuraRatio: s.pitchHz / TANPURA_BASE_HZ,
  });
  job.cleanup.push(() => renderer.close());

  const ir = s.channels === 2 ? reverbImpulse(SR) : null;
  const warmMax = Math.round(Math.max(WARMUP_SEC, s.channels === 2 ? WARMUP_REVERB_SEC : 0) * SR);
  let history = null; // the last warmMax frames of mixer input
  let encoding = Promise.resolve();
  let nextRaw = renderer.next(Math.min(CHUNK, total));

  for (let start = 0; start < total;) {
    const raw = await nextRaw;
    check();
    const frames = raw.lehra.length;
    const end = start + frames;
    // The worker renders the next chunk while this one is mixed and encoded
    if (end < total) nextRaw = renderer.next(Math.min(CHUNK, total - end));

    applyEndFades(plan, SR, start, raw.lehra, tanpura ? raw.tanpura : null);
    const input = { lehra: joined(history?.lehra, raw.lehra), tanpura: joined(history?.tanpura, raw.tanpura) };
    const warm = input.lehra.length - frames;
    const mixed = await mixChunk(s, input, warm, start, ir, clickSounds, plan);
    check();
    history = {
      lehra: input.lehra.slice(Math.max(0, input.lehra.length - warmMax)),
      tanpura: input.tanpura.slice(Math.max(0, input.tanpura.length - warmMax)),
    };
    applyOutputFade(plan, SR, start, mixed);

    await encoding;
    check();
    encoding = encoder.push(mixed);
    start = end;
    progress(`Rendering… ${formatDuration(end / SR)} of ${formatDuration(total / SR)}`, end / total);
  }
  await encoding;
  check();
  progress(s.format === 'mp3' ? 'Finishing the MP3…' : 'Finishing the WAV…', 1);
  const blob = await encoder.finish();
  return { blob, seconds: total / SR, plan };
}

// ── UI ─────────────────────────────────────────────────────────────
function setProgress(text, fraction) {
  $('exStatus').textContent = text;
  $('exBar').style.width = (Math.max(0, Math.min(1, fraction)) * 100).toFixed(1) + '%';
}

/** The export's summary: what, how long, how big. */
function describe() {
  const ready = !!(state.raag && state.taalData && state.instrument);
  $('exBtn').disabled = !ready && !running;
  $('exEndSam').disabled = $('exUnit').value === 'cycles';
  if (!ready) {
    $('exSummary').textContent = 'Choose an instrument, taal and raag first.';
    return;
  }
  const s = snapshot();
  const plan = planFor(s);
  const what = `${s.raag} · ${s.instrument} · ${s.taalName} · ${s.bpm} BPM · Sa ${s.sa}`;
  const cycles = plan.cycles ? ` · ${plan.cycles} cycle${plan.cycles === 1 ? '' : 's'}` : '';
  const size = formatBytes(estimateBytes(s.format, plan.totalFrames, s.channels));
  $('exSummary').textContent = `${what} — ${formatDuration(plan.totalFrames / SR)}${cycles}, about ${size}`;
}

function renderFiles() {
  const ul = $('exList');
  ul.innerHTML = '';
  files.forEach(f => {
    const li = document.createElement('li');
    li.className = 'take-item';
    const head = document.createElement('div');
    head.className = 'take-head';
    const name = document.createElement('span');
    name.className = 'take-name';
    name.textContent = `${f.file} · ${formatDuration(f.secs)} · ${formatBytes(f.bytes)}`;
    name.title = f.file;
    const dl = document.createElement('a');
    dl.className = 'header-icon-btn';
    dl.href = f.url;
    dl.download = f.file;
    dl.textContent = 'Download';
    const del = document.createElement('button');
    del.className = 'header-icon-btn preset-delete';
    del.textContent = '×';
    del.title = `Remove ${f.file}`;
    del.setAttribute('aria-label', `Remove ${f.file}`);
    del.addEventListener('click', () => {
      URL.revokeObjectURL(f.url);
      files.splice(files.indexOf(f), 1);
      renderFiles();
    });
    head.append(name, dl, del);
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'metadata';
    player.src = f.url;
    li.append(head, player);
    ul.appendChild(li);
  });
}

function download(url, file) {
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function start() {
  if (running || !state.raag || !state.taalData) return;
  const s = snapshot();
  const job = { cancelled: false, cleanup: [] };
  running = job;
  $('exBtn').textContent = 'Cancel';
  $('exBtn').classList.add('active');
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed now */ }

  try {
    const { blob, seconds } = await exportAudio(s, job, setProgress);
    const file = exportFileName({
      raag: s.raag, instrument: s.instrument, taal: s.taalName, bpm: s.bpm,
      sa: s.sa, seconds, ext: s.format,
    });
    const url = URL.createObjectURL(blob);
    files.unshift({ file, url, bytes: blob.size, secs: seconds });
    renderFiles();
    download(url, file);
    setProgress(`Saved ${file} (${formatBytes(blob.size)}).`, 1);
  } catch (err) {
    if (err instanceof Cancelled) setProgress('Export cancelled.', 0);
    else {
      console.error('Audio export failed:', err);
      setProgress(`Export failed: ${err.message}`, 0);
    }
  } finally {
    job.cleanup.forEach(fn => fn());
    lock?.release().catch(() => {});
    running = null;
    $('exBtn').textContent = 'Export';
    $('exBtn').classList.remove('active');
    describe();
  }
}

export function initExport() {
  $('exBtn').addEventListener('click', () => {
    if (running) running.cancelled = true;
    else start();
  });
  $('exUnit').addEventListener('change', () => {
    const cycles = $('exUnit').value === 'cycles';
    const amount = $('exAmount');
    amount.step = cycles ? '1' : '0.5';
    amount.min = cycles ? '1' : '0.5';
    describe();
  });
  ['exAmount', 'exFormat', 'exEndSam', 'exTanpura', 'exMetronome', 'tanpuraVol', 'fxReverb'].forEach(id => {
    $(id).addEventListener('input', describe);
    $(id).addEventListener('change', describe);
  });
  $('pitchSelect').addEventListener('change', describe);
  onSettingsChange(describe);
  ['exAmount', 'exUnit', 'exFormat'].forEach(id => persistControl(id));
  ['exEndSam', 'exTanpura', 'exMetronome'].forEach(id => persistControl(id, 'checked'));
  // An export in progress would be lost
  window.addEventListener('beforeunload', e => {
    if (running) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  describe();
}
