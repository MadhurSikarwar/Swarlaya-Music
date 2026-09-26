/**
 * Record your riyaz: the microphone together with the lehra/tanpura mix
 * (post-FX, without the metronome) through a MediaStreamAudioDestinationNode
 * into a MediaRecorder (webm/opus where supported). Takes are kept in this
 * tab as Blob URLs, to play back or download — nothing leaves the browser.
 * The microphone is recorded, never played back.
 *
 * You play along with what you hear, which is later than what is rendered
 * (the output latency) and reaches the recorder later still (the input
 * latency), so the lehra is delayed by both before it's mixed in.
 */
import { $ } from '../core/dom.js';
import { isMediaOutputActive, outputLatency } from '../core/audio-output.js';
import { acquireMic, micSupported, releaseMic } from '../core/mic.js';
import { audio, ensureAudio } from './audio.js';
import { state } from './state.js';

const MIX_LEVEL = 0.8;                 // lehra/tanpura under the voice
const MEDIA_ELEMENT_EXTRA_SEC = 0.015; // measured 9–19 ms for the lock-screen output path
const DEFAULT_INPUT_LATENCY = 0.01;

/** First container/codec the browser can record, preferring webm/opus. */
export function pickMimeType(isSupported) {
  const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
  return types.find(t => { try { return isSupported(t); } catch { return false; } }) || '';
}

export function extensionFor(mime) {
  if (/ogg/.test(mime)) return 'ogg';
  if (/mp4|aac/.test(mime)) return 'm4a';
  return 'webm';
}

/** e.g. riyaz-2026-09-26-1432-Kedar.webm */
export function takeFileName(date, raag, ext) {
  const p = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  const name = (raag || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `riyaz-${stamp}${name ? '-' + name : ''}.${ext}`;
}

/** Seconds to delay the lehra so it lines up with what was played over it. */
export function syncDelay({ output, input, mediaElement }) {
  return Math.max(0, Math.min(0.5, output + (input || DEFAULT_INPUT_LATENCY) + (mediaElement ? MEDIA_ELEMENT_EXTRA_SEC : 0)));
}

let rec = null;     // the recording in progress
const takes = [];   // { url, name, file, secs, downloaded }
let takeCount = 0;

function fmt(secs) {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setStatus(text) {
  $('recStatus').textContent = text;
}

async function startRecording() {
  if (rec) return;
  if (!micSupported() || typeof MediaRecorder === 'undefined') {
    setStatus('This browser can’t record audio.');
    return;
  }
  rec = { starting: true };
  $('recBtn').disabled = true;
  try {
    await ensureAudio(); // the lehra graph, for its mix
    const stream = await acquireMic();
    if (!rec) { releaseMic(); return; } // stopped meanwhile
    const ctx = audio.ctx;
    const dest = ctx.createMediaStreamDestination();
    const mic = ctx.createMediaStreamSource(stream);
    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    mic.connect(dest);
    mic.connect(meter);
    const delay = ctx.createDelay(1);
    const settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
    delay.delayTime.value = syncDelay({ output: outputLatency(), input: settings.latency, mediaElement: isMediaOutputActive() });
    const mix = ctx.createGain();
    mix.gain.value = MIX_LEVEL;
    audio.analyser.connect(delay);
    delay.connect(mix);
    mix.connect(dest);

    const mimeType = pickMimeType(t => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
    const chunks = [];
    const session = { recorder, chunks, mic, meter, delay, mix, dest, started: performance.now(), raag: state.raag, date: new Date(), raf: 0 };
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => finishTake(session);
    recorder.start(1000);
    rec = session;
    $('recBtn').textContent = '■ Stop';
    $('recBtn').classList.add('active', 'recording');
    setStatus(state.isPlaying ? 'Recording you with the lehra…' : 'Recording… start the lehra whenever you like.');
    drawMeter();
  } catch (err) {
    rec = null;
    setStatus(err && err.name === 'NotAllowedError'
      ? 'Microphone permission was refused. Allow it in the browser’s site settings to record.'
      : `Couldn't start recording: ${err.message || err}`);
  } finally {
    $('recBtn').disabled = false;
  }
}

/** Stop (and keep) the recording in progress, if any. */
export function stopRecording() {
  if (!rec) return;
  const s = rec;
  rec = null;
  $('recBtn').textContent = '● Record';
  $('recBtn').classList.remove('active', 'recording');
  $('recMeter').style.width = '0%';
  if (!s.recorder) return; // still starting
  cancelAnimationFrame(s.raf);
  s.secs = (performance.now() - s.started) / 1000;
  if (s.recorder.state !== 'inactive') s.recorder.stop();
  try { audio.analyser.disconnect(s.delay); } catch { /* already disconnected */ }
  [s.mic, s.meter, s.delay, s.mix].forEach(n => n.disconnect());
  releaseMic();
}

function finishTake(s) {
  if (!s.chunks.length) { setStatus('Nothing was recorded.'); return; }
  const type = s.recorder.mimeType || s.chunks[0].type || 'audio/webm';
  const blob = new Blob(s.chunks, { type });
  takeCount++;
  takes.unshift({
    url: URL.createObjectURL(blob),
    name: `Take ${takeCount}${s.raag ? ' · ' + s.raag : ''}`,
    file: takeFileName(s.date, s.raag, extensionFor(type)),
    secs: s.secs,
    bytes: blob.size,
    downloaded: false,
  });
  setStatus('Saved in this tab — download the takes you want to keep.');
  renderTakes();
}

function drawMeter() {
  if (!rec || !rec.meter) return;
  const data = new Float32Array(rec.meter.fftSize);
  rec.meter.getFloatTimeDomainData(data);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const db = 20 * Math.log10(peak || 1e-6);
  $('recMeter').style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)).toFixed(0) + '%';
  $('recTime').textContent = fmt((performance.now() - rec.started) / 1000);
  rec.raf = requestAnimationFrame(drawMeter);
}

function renderTakes() {
  const ul = $('takeList');
  ul.innerHTML = '';
  takes.forEach(t => {
    const li = document.createElement('li');
    li.className = 'take-item';
    const head = document.createElement('div');
    head.className = 'take-head';
    const name = document.createElement('span');
    name.className = 'take-name';
    name.textContent = `${t.name} · ${fmt(t.secs)}`;
    const dl = document.createElement('a');
    dl.className = 'header-icon-btn';
    dl.href = t.url;
    dl.download = t.file;
    dl.textContent = 'Download';
    dl.addEventListener('click', () => { t.downloaded = true; });
    const del = document.createElement('button');
    del.className = 'header-icon-btn preset-delete';
    del.textContent = '×';
    del.title = `Delete ${t.name}`;
    del.setAttribute('aria-label', `Delete ${t.name}`);
    del.addEventListener('click', () => {
      if (!t.downloaded && !confirm(`Delete ${t.name}? It hasn't been downloaded.`)) return;
      URL.revokeObjectURL(t.url);
      takes.splice(takes.indexOf(t), 1);
      renderTakes();
    });
    head.append(name, dl, del);
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'metadata';
    player.src = t.url;
    li.append(head, player);
    ul.appendChild(li);
  });
}

export function initRecorder() {
  $('recBtn').addEventListener('click', () => (rec ? stopRecording() : startRecording()));
  // Don't lose takes that were never downloaded
  window.addEventListener('beforeunload', e => {
    if (rec || takes.some(t => !t.downloaded)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
