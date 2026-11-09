/**
 * Audio Lab (/audio): a raw tabla recording (and a lehra, a second recorder,
 * a vocal…) cleaned, mixed and mastered by the audio_lab service, with a
 * prepare step in between and riyaz insights after.
 *
 *   api.js           the service: upload, analyse, master, progress, files
 *   recorder.js      record straight into the page
 *   lehra-source.js  a Swaralaya lehra rendered at your tempo and Sa
 *   prepare.js       trim, noise sample, tap-on-sam alignment with live preview
 *   settings.js      the controls ↔ options, presets, learned preferences
 *   batch.js         several recordings with the same settings
 *   player.js        the A/B player          report.js / charts.js  the results
 *   format.js        pure helpers (tested in tests/audiolab.test.js)
 *
 * The processing runs on the service, not in the page; if the page cannot find
 * it, it says so and the rest of the site is unaffected.
 */
import { $, trackSliderFill } from '../core/dom.js';
import { toast } from '../core/toast.js';
import * as api from './api.js';
import { createBatch } from './batch.js';
import { renderInsights } from './charts.js';
import { DEFAULT_LIMITS } from './config.js';
import {
  centsBetween, checkFile, foldSa, formatBytes, formatClock, formatNumber, formatSigned, friendlyError, learnedDefault,
  noteOf, orderedVariants, timeLeft,
} from './format.js';
import { SA_RANGE, instruments, raagsFor, renderLehra, taalInfo, taalsFor, tempoFromTabla } from './lehra-source.js';
import { createPlayer } from './player.js';
import { createPreparer } from './prepare.js';
import { canRecord, startRecording } from './recorder.js';
import { renderBands, renderDecisions, renderDownloads, renderGates, renderTiles } from './report.js';
import {
  applyControls, countDownload, deletePreset, downloadCounts, listPresets, readControls, savePreset,
} from './settings.js';
import { drawSpectrogram } from './spectrogram.js';
import { createSyncEditor } from './sync-editor.js';

const STORE_KEY = 'swaralaya_audiolab_job';
const TARGET_LUFS = { reel: -14, youtube: -14, loud: -11, spotify: -14, apple: -16, podcast: -16 };

const state = {
  info: null,
  searched: false,
  files: { tabla: null, lehra: null, reference: null, recorder: null, vocal: null },
  lehraMode: 'none',
  rendered: null,            // { file, meta, cycleSeconds, key } — the Swaralaya lehra as rendered
  rendering: null,
  analysis: null,
  analysisId: null,
  analyseUpload: null,
  stopAnalysis: null,
  target: 'reel',
  busy: false,
  upload: null,
  stopWatching: null,
  jobId: null,
  report: null,
  spectrograms: null,
  selected: null,
  player: null,
  prep: null,
  recording: null,
  batch: null,
};

let wired = false;

function remember(id) {
  try { if (id) localStorage.setItem(STORE_KEY, id); else localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
}
function remembered() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

const limits = () => ({ ...DEFAULT_LIMITS, ...(state.info ? state.info.limits : {}) });
const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

// ── The service ───────────────────────────────────────────────────────────────

function showServer(text, { code = '', retry = false, ok = false } = {}) {
  const box = $('alabServer');
  box.hidden = ok && !text;
  $('alabServerText').textContent = text;
  $('alabServerCmd').hidden = !code;
  $('alabServerCmd').textContent = code;
  $('alabServerRetry').hidden = !retry;
}

async function findServer() {
  showServer('Looking for the audio studio…');
  const found = await api.detect({
    onSlow: () => showServer('Waking up the audio studio — after a quiet spell this takes up to a minute or two…'),
  });
  state.searched = true;
  if (found.ok) {
    state.info = found.info;
    const f = found.info.features || {};
    showServer('', { ok: true });
    $('alabDrums').disabled = !f.demucs;
    $('alabDrumsNote').hidden = !!f.demucs;
    $('alabReferenceBox').hidden = !f.matchering;
    if (f.tanpura === false) $('alabTanpuraOn').disabled = true;
    $('alabTablaHint').textContent = `Drop it here or tap to choose — audio or video, up to ${limits().max_upload_mb} MB`;
    $('alabBatchStart').disabled = !state.batch.count();
    if (state.files.tabla && !state.analysis) analyse();
  } else if (isLocal()) {
    showServer('The audio studio is not running on this computer yet. Start it from the webapp folder, then try again:', {
      code: 'python -m uvicorn audio_lab.server:app --port 8100', retry: true,
    });
  } else {
    showServer('The audio studio is not connected to this site yet — the processing needs its own server (Python and ffmpeg). Everything else on Swaralaya works as usual.', { retry: true });
  }
  updateGo();
}

// ── Files ─────────────────────────────────────────────────────────────────────

function showError(text) {
  $('alabError').textContent = text;
  $('alabError').hidden = !text;
}

function setTabla(file) {
  if (file) {
    const problem = checkFile(file, limits().max_upload_mb);
    if (problem) { showError(problem); return; }
  }
  showError('');
  state.files.tabla = file || null;
  $('alabTablaName').textContent = file ? `${file.name} · ${formatBytes(file.size)}` : '';
  $('alabTablaName').hidden = !file;
  $('alabTablaDrop').classList.toggle('has-file', !!file);
  $('alabTablaClear').hidden = !file;
  resetAnalysis();
  if (file && state.info) analyse();
  updateGo();
}

function setSide(kind, file, ids) {
  if (file) {
    const problem = checkFile(file, kind === 'recorder' ? limits().max_upload_mb : limits().max_side_upload_mb);
    if (problem) { showError(problem); return false; }
  }
  showError('');
  state.files[kind] = file || null;
  $(ids.name).textContent = file ? `${file.name} · ${formatBytes(file.size)}` : '';
  $(ids.name).hidden = !file;
  $(ids.clear).hidden = !file;
  return true;
}

function bindDrop(labelId, inputId, onFile) {
  const label = $(labelId), input = $(inputId);
  input.addEventListener('change', () => { onFile(input.files[0] || null); input.value = ''; });
  const over = on => label.classList.toggle('dragging', on);
  ['dragenter', 'dragover'].forEach(t => label.addEventListener(t, e => { e.preventDefault(); over(true); }));
  ['dragleave', 'drop'].forEach(t => label.addEventListener(t, e => { e.preventDefault(); over(false); }));
  label.addEventListener('drop', e => {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

// ── Recording here ────────────────────────────────────────────────────────────

async function record() {
  if (state.recording) return;
  try {
    state.recording = await startRecording({
      onLevel: (level, secs) => {
        $('alabRecLevel').style.width = `${Math.round(Math.min(1, level) * 100)}%`;
        $('alabRecLevel').classList.toggle('hot', level > 0.97);
        $('alabRecTime').textContent = formatClock(secs);
      },
    });
  } catch (err) {
    showError(err && err.name === 'NotAllowedError'
      ? 'The microphone was not allowed. Allow it in the browser’s site settings and try again.'
      : 'The microphone could not be started.');
    return;
  }
  $('alabRecBox').hidden = false;
  $('alabRecord').hidden = true;
  updateGo();
}

async function stopRecording(keep) {
  const rec = state.recording;
  if (!rec) return;
  state.recording = null;
  $('alabRecBox').hidden = true;
  $('alabRecord').hidden = false;
  if (!keep) { rec.cancel(); updateGo(); return; }
  try {
    setTabla(await rec.stop());
    toast('Recording ready.');
  } catch (err) {
    showError(err.message || 'Nothing was recorded.');
    updateGo();
  }
}

// ── Analysis (as soon as a recording is chosen) ───────────────────────────────

function resetAnalysis() {
  if (state.stopAnalysis) state.stopAnalysis();
  if (state.analyseUpload) state.analyseUpload.abort();
  state.stopAnalysis = null;
  state.analyseUpload = null;
  state.analysis = null;
  state.analysisId = null;
  $('alabPrepare').hidden = true;
  $('alabAnalyseStatus').textContent = '';
  $('alabCatBpmTabla').disabled = true;
  $('alabSaTabla').disabled = true;
  if (state.prep) state.prep.stop();
  steps();
}

function analyse() {
  resetAnalysis();
  const files = { tabla: state.files.tabla, recorder: state.files.recorder };
  if (!files.tabla) return;
  $('alabAnalyseStatus').textContent = 'Uploading for a first look…';
  const up = api.createJob(files, {}, f => {
    $('alabAnalyseStatus').textContent = `Uploading for a first look… ${Math.round(f * 100)} %`;
  }, { mode: 'analyse' });
  state.analyseUpload = up;
  up.promise.then(({ job_id: id }) => {
    if (state.analyseUpload !== up) return;
    state.analyseUpload = null;
    state.stopAnalysis = api.watchJob(id, job => {
      if (job.status === 'done') {
        state.stopAnalysis = null;
        showAnalysis(id, job.analysis);
      } else if (job.status === 'failed') {
        state.stopAnalysis = null;
        const e = job.error || {};
        $('alabAnalyseStatus').textContent = '';
        showError(friendlyError(e.code, e.message));
      } else {
        $('alabAnalyseStatus').textContent = job.status === 'queued' ? 'Waiting for a first look…' : `${job.message || 'Analysing'}…`;
      }
    });
  }).catch(err => {
    if (state.analyseUpload === up) state.analyseUpload = null;
    if (err.code === 'aborted') return;
    $('alabAnalyseStatus').textContent = '';
    showError(friendlyError(err.code, err.message));
  });
}

function chip(text, title) {
  const c = document.createElement('span');
  c.className = 'alab-chip';
  c.textContent = text;
  if (title) c.title = title;
  return c;
}

async function showAnalysis(id, a) {
  state.analysis = a;
  state.analysisId = id;
  const b = a.before;
  $('alabAnalyseStatus').textContent = `Analysed in ${formatNumber(a.seconds_taken, 0)} s.`;
  const chips = $('alabChips');
  chips.replaceChildren(
    chip(formatClock(a.duration_s), 'Length'),
    chip(`${formatNumber(b.lufs, 1)} LUFS`, 'Integrated loudness as recorded'),
    chip(`peak ${formatNumber(b.true_peak_db, 1)} dBTP`, 'True peak as recorded'),
    chip(`noise ${formatNumber(b.noise_floor_db, 0)} dBFS`, 'The level of the quietest passages'),
  );
  if (b.clip_events) chips.append(chip(`${b.clip_events} clipped`, 'Runs of samples at full scale: they will be rebuilt'));
  if (b.hum) chips.append(chip(`${b.hum.hz} Hz hum`, 'Mains hum: it will be notched out'));
  if (a.rhythm && a.rhythm.bpm) chips.append(chip(`≈${Math.round(a.rhythm.bpm)} BPM`, 'From a beat tracker: an estimate'));
  if (a.dayan_pitch) chips.append(chip(`dayan ${a.dayan_pitch.note} · ${formatNumber(a.dayan_pitch.hz, 1)} Hz`, 'Where the dayan rings'));
  if (a.sync) chips.append(chip(`recorder ${formatSigned(a.sync.lag_s * 1000, 0)} ms${a.sync.drift_ppm ? `, ${formatSigned(a.sync.drift_ppm, 0)} ppm` : ''}`, 'How your second recorder was lined up'));
  $('alabCatBpmTabla').disabled = !(a.rhythm && a.rhythm.bpm);
  $('alabSaTabla').disabled = !a.suggested_sa;
  if (a.suggested_sa && !$('alabSa').value) setSa(a.suggested_sa.hz);
  if (state.lehraMode === 'catalogue' && a.rhythm && a.rhythm.bpm && !$('alabCatBpm').dataset.touched) useTablaTempo();
  for (const w of a.warnings || []) toast(w);
  $('alabPrepare').hidden = false;
  steps();
  try {
    await state.prep.loadTabla(api.fileUrl(id, a.files.preview));
  } catch {
    $('alabTrimLabel').textContent = 'The preview could not be loaded; trimming and alignment are unavailable, but you can still master.';
  }
  updateAlign();
  tuneLine();
}

// ── The lehra ─────────────────────────────────────────────────────────────────

function setLehraMode(mode) {
  state.lehraMode = mode;
  document.querySelectorAll('#alabLehraMode [data-lehra-mode]').forEach(b => {
    const on = b.dataset.lehraMode === mode;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('active', on);
  });
  $('alabLehraUploadBox').hidden = mode !== 'upload';
  $('alabCatBox').hidden = mode !== 'catalogue';
  const done = () => updateAlign();
  if (mode === 'none') state.prep.setLehra(null).then(done);
  else if (mode === 'upload') state.prep.setLehra(state.files.lehra).then(done).catch(done);
  else {
    if (state.rendered) state.prep.setLehra(state.rendered.file, state.rendered.cycleSeconds).then(done);
    if (state.analysis && !$('alabCatBpm').dataset.touched) useTablaTempo();
    scheduleRender();
  }
}

function fillSelect(sel, values, keep) {
  sel.replaceChildren(...values.map(v => { const o = document.createElement('option'); o.value = v; o.textContent = v.replace(/\s*\(.*\)$/, ''); return o; }));
  if (keep && values.includes(keep)) sel.value = keep;
}

function catalogueChoice() {
  return { instrument: $('alabCatInstrument').value, taal: $('alabCatTaal').value, raag: $('alabCatRaag').value };
}

function refreshCatalogue(changed) {
  const c = catalogueChoice();
  if (changed === 'instrument' || changed === 'init') fillSelect($('alabCatTaal'), taalsFor(c.instrument), c.taal || 'Teentaal (16 beats)');
  const taal = $('alabCatTaal').value;
  if (changed !== 'raag') fillSelect($('alabCatRaag'), raagsFor(c.instrument, taal), c.raag);
  const info = taalInfo(c.instrument, taal);
  if (info) { $('alabCatBpm').min = info.minTempo; $('alabCatBpm').max = info.maxTempo; }
  scheduleRender();
}

function setSa(hz) {
  const v = Math.min(SA_RANGE.max, Math.max(SA_RANGE.min, foldSa(hz)));
  $('alabSa').value = v.toFixed(2);
  saNote();
}

function saNote() {
  const n = noteOf(parseFloat($('alabSa').value));
  $('alabSaNote').textContent = n ? `${n.name}${n.cents ? ` ${formatSigned(n.cents, 0)}¢` : ''}` : '';
  tuneLine();
  if (state.lehraMode === 'catalogue') scheduleRender();
}

function useTablaTempo() {
  const a = state.analysis;
  if (!a || !a.rhythm || !a.rhythm.bpm) return;
  const c = catalogueChoice();
  const bpm = tempoFromTabla(c.instrument, c.taal, a.rhythm.bpm);
  if (bpm) { $('alabCatBpm').value = bpm; scheduleRender(); }
}

let renderTimer = 0;
function scheduleRender() {
  if (state.lehraMode !== 'catalogue') return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderCatalogue, 350);
}

async function renderCatalogue() {
  const c = catalogueChoice();
  const sa = parseFloat($('alabSa').value);
  const bpm = parseFloat($('alabCatBpm').value);
  if (!c.raag || !(sa > 0) || !(bpm > 0)) {
    $('alabCatStatus').textContent = sa > 0 ? 'Choose a raag.' : 'Set a Sa (or take it from the dayan once the recording is analysed).';
    return;
  }
  const key = JSON.stringify([c, bpm, sa.toFixed(2)]);
  if (state.rendered && state.rendered.key === key) return;
  const mine = (state.rendering = key);
  $('alabCatStatus').textContent = 'Making the lehra…';
  try {
    const r = await renderLehra({ ...c, bpm, saHz: sa });
    if (state.rendering !== mine) return;
    state.rendered = { ...r, key };
    $('alabCatStatus').textContent = `${r.meta.name}, Sa ${formatNumber(sa, 1)} Hz — ${Math.round(r.seconds)} s of whole cycles, starting on sam.`;
    await state.prep.setLehra(r.file, r.cycleSeconds);
    updateAlign();
  } catch (err) {
    if (state.rendering === mine) $('alabCatStatus').textContent = `Could not make the lehra: ${err.message}`;
  }
}

function lehraFile() {
  if (state.lehraMode === 'upload') return state.files.lehra;
  if (state.lehraMode === 'catalogue') return state.rendered ? state.rendered.file : null;
  return null;
}

// ── Prepare ───────────────────────────────────────────────────────────────────

function updateAlign() {
  $('alabAlignBox').hidden = !(state.analysis && state.prep && state.prep.hasLehra());
}

function onPrep(ev) {
  $('alabPrevTime').textContent = `${formatClock(ev.position)} / ${formatClock(ev.duration)}`;
  $('alabPrevPlayIcon').style.display = ev.playing ? 'none' : '';
  $('alabPrevStopIcon').style.display = ev.playing ? '' : 'none';
  $('alabTapSam').disabled = !(ev.playing && state.prep && state.prep.hasLehra());
  $('alabTrimReset').hidden = !ev.trim;
  $('alabNoiseClear').hidden = !ev.noise;
  const parts = [];
  if (ev.trim) parts.push(`Keeping ${formatClock(ev.trim.start)}–${formatClock(ev.trim.end)} (${formatNumber(ev.trim.end - ev.trim.start, 1)} s).`);
  if (ev.noise) parts.push(`Noise learned from ${formatNumber(ev.noise.start, 1)}–${formatNumber(ev.noise.end, 1)} s.`);
  if (parts.length) $('alabTrimLabel').textContent = parts.join(' ');
  if (ev.offset === null) {
    $('alabOffsetLabel').textContent = 'Offset: automatic';
    $('alabOffsetAuto').checked = true;
  } else {
    $('alabOffsetLabel').textContent = `Offset: ${formatSigned(ev.offset, 3)} s${ev.taps ? ` (${ev.taps} tap${ev.taps === 1 ? '' : 's'})` : ''}`;
    $('alabOffsetAuto').checked = false;
  }
}

function tuneLine() {
  const a = state.analysis;
  const sa = parseFloat($('alabSa').value);
  const p = a && a.dayan_pitch;
  $('alabShiftToSa').hidden = !(p && sa > 0);
  if (!p || !(sa > 0)) { $('alabTuneLine').textContent = ''; return; }
  const rel = ((centsBetween(p.hz, sa) % 1200) + 1200) % 1200;
  let best = ['Sa', rel];
  for (const [name, c] of [['Pa', 702], ['Ma', 498], ['Sa', 1200]]) if (Math.abs(rel - c) < Math.abs(best[1])) best = [name, rel - c];
  const cents = best[1];
  const n = noteOf(sa);
  const against = best[0] === 'Sa' ? 'your Sa' : `${best[0]} of your Sa`;
  $('alabTuneLine').textContent = `The dayan rings at ${formatNumber(p.hz, 1)} Hz: ${formatSigned(cents, 0)} cents from ${against} (${n.name}, ${formatNumber(sa, 1)} Hz)${Math.abs(cents) <= 15 ? ' — in tune.' : ' — “Tune to Sa” moves the whole recording onto it.'}`;
  $('alabShiftToSa').dataset.cents = String(Math.round(-cents));
}

function steps() {
  const prep = !$('alabPrepare').hidden;
  $('alabStepSound').textContent = prep ? '3' : '2';
  $('alabStepOutput').textContent = prep ? '4' : '3';
}

// ── Settings ──────────────────────────────────────────────────────────────────

function sliderValue(id, fmt) {
  const input = $(id), out = $(`${id}Val`);
  const update = () => { out.textContent = fmt(+input.value); };
  input.addEventListener('input', update);
  trackSliderFill(input);
  update();
}

function setTarget(target) {
  state.target = target;
  document.querySelectorAll('#alabTargets [data-target-name]').forEach(b => {
    const on = b.dataset.targetName === target;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('active', on);
  });
  $('alabCustomBox').hidden = target !== 'custom';
  const lufs = target === 'custom' ? +$('alabCustomLufs').value : TARGET_LUFS[target];
  $('alabTargetNote').textContent = {
    reel: 'Instagram Reels and YouTube Shorts both play at about −14 LUFS.',
    youtube: 'YouTube turns everything to about −14 LUFS.',
    loud: '−11 LUFS: louder on phone speakers, at the cost of some dynamics.',
    spotify: 'Spotify’s default is about −14 LUFS.',
    apple: 'Apple Music plays at about −16 LUFS.',
    podcast: 'Podcasts usually aim at about −16 LUFS.',
    custom: `Your own target: ${formatNumber(lufs, 1)} LUFS.`,
  }[target];
}

function options() {
  const o = { ...readControls(), target: state.target };
  const p = state.prep ? state.prep.state() : null;
  if (p && state.analysis) {
    if (p.trim) { o.trim_start = p.trim.start; o.trim_end = p.trim.end; }
    if (p.noise) o.noise_region = [p.noise.start, p.noise.end];
    if (p.offset !== null && lehraFile()) o.offset_seconds = p.offset;
  }
  if (state.lehraMode === 'catalogue' && state.rendered) o.lehra_meta = state.rendered.meta;
  return o;
}

function refreshPresets(selected = '') {
  const opts = [new Option('My settings…', '')];
  for (const p of listPresets()) opts.push(new Option(p.name, p.name));
  $('alabPreset').replaceChildren(...opts);
  $('alabPreset').value = selected;
  $('alabPresetDelete').hidden = !selected;
}

// ── Running a job ─────────────────────────────────────────────────────────────

function updateGo() {
  const ready = !!state.info && !!state.files.tabla && !state.busy && !state.recording;
  $('alabGo').disabled = !ready;
  $('alabGo').textContent = state.busy ? 'Working…' : 'Clean up & master';
}

function setProgress(fraction, stage, detail = '') {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  $('alabBar').style.width = `${pct}%`;
  $('alabProgressBar').setAttribute('aria-valuenow', String(pct));
  $('alabStage').textContent = stage;
  $('alabStageDetail').textContent = detail;
}

function setBusy(busy) {
  state.busy = busy;
  $('alabProgress').hidden = !busy;
  $('alabCancel').hidden = !busy;
  document.querySelectorAll('#alabForm input, #alabForm select, #alabForm button.alab-setting').forEach(n => {
    if (n.closest('#alabBatch') || n.id === 'alabNotify') return;
    n.disabled = busy;
  });
  if (!busy) {
    if (state.info) $('alabDrums').disabled = !(state.info.features || {}).demucs;
    $('alabTanpuraDb').disabled = !$('alabTanpuraOn').checked;
  }
  updateGo();
}

function notify(title, body) {
  if (!$('alabNotify').checked || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try { new Notification(title, { body, icon: '/public/icons/icon-192.png' }); } catch { /* not allowed here */ }
}

function onJob(job) {
  if (job.status === 'queued') {
    const pos = job.queue_position;
    setProgress(0.02, pos > 1 ? `Waiting — number ${pos} in the queue` : 'Waiting for the studio', 'Your recording is uploaded.');
  } else if (job.status === 'running') {
    setProgress(job.progress, job.message || 'Working', 'Longer recordings take longer — you can leave this tab open.');
  } else if (job.status === 'done') {
    setBusy(false);
    $('alabProgress').hidden = true;
    showResult(job);
    notify('Your master is ready', job.name || 'Audio Lab');
  } else if (job.status === 'failed') {
    setBusy(false);
    remember(null);
    state.jobId = null;
    const e = job.error || {};
    showError(friendlyError(e.code, e.message || job.message));
    notify('Audio Lab: it didn’t work', friendlyError(e.code, e.message));
  }
}

async function start() {
  if (state.busy || !state.files.tabla) return;
  showError('');
  if (state.lehraMode === 'catalogue' && !state.rendered) {
    await renderCatalogue();
    if (!state.rendered) { showError('The Swaralaya lehra is not ready: check its tempo and Sa.'); return; }
  }
  if (state.lehraMode === 'upload' && !state.files.lehra) { showError('Choose your lehra file, or pick “No lehra”.'); return; }
  if (state.prep) state.prep.stop();
  hideResult();
  setBusy(true);
  const opts = options();
  const from = state.analysisId;
  const files = from
    ? { lehra: lehraFile(), reference: state.files.reference, vocal: state.files.vocal }
    : { tabla: state.files.tabla, lehra: lehraFile(), reference: state.files.reference, recorder: state.files.recorder, vocal: state.files.vocal };
  setProgress(0, from ? 'Starting…' : 'Uploading…', from ? 'Your recording is already on the server.' : formatBytes(state.files.tabla.size));
  state.upload = api.createJob(files, opts, f => setProgress(f, `Uploading… ${Math.round(f * 100)} %`), { from });
  try {
    const { job_id: id } = await state.upload.promise;
    state.upload = null;
    state.jobId = id;
    remember(id);
    setProgress(0.02, 'Waiting for the studio', 'Your recording is uploaded.');
    state.stopWatching = api.watchJob(id, onJob);
  } catch (err) {
    state.upload = null;
    setBusy(false);
    if (err.status === 404 && from) {         // the analysis expired: upload everything again
      state.analysisId = null;
      start();
      return;
    }
    if (err.code !== 'aborted') showError(friendlyError(err.code, err.message));
  }
}

async function cancel() {
  if (state.upload) { state.upload.abort(); return; }
  if (state.stopWatching) { state.stopWatching(); state.stopWatching = null; }
  const id = state.jobId;
  state.jobId = null;
  remember(null);
  setBusy(false);
  if (id) { try { await api.deleteJob(id); } catch { /* it expires on its own */ } }
  toast('Cancelled.');
}

// ── Results ───────────────────────────────────────────────────────────────────

function hideResult() {
  $('alabResult').hidden = true;
  if (state.player) state.player.stop();
}

function variantLabel(name) {
  return name === 'original' ? 'Original' : state.report.variants[name].label;
}

function renderSelected() {
  const name = state.selected;
  const report = state.report;
  $('alabVariantNote').textContent = name === 'original'
    ? 'Your recording as it came in (after your trim and edits), brought to the same loudness.'
    : report.variants[name].description;
  renderGates($('alabGates'), report, name);
  renderTiles($('alabTiles'), report, name);
  renderBands($('alabBands'), report, name);
  renderDownloads($('alabDownloads'), state.jobId, report, name === 'original' ? report.default_variant : name);
  document.querySelectorAll('#alabVariants button').forEach(b => {
    const on = b.dataset.variant === name;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('active', on);
  });
  if (state.spectrograms) {
    drawSpectrogram($('alabSpecBefore'), state.spectrograms.before);
    const after = name === 'original' ? null : state.spectrograms[name];
    $('alabSpecAfterBox').hidden = !after;
    if (after) drawSpectrogram($('alabSpecAfter'), after);
  }
}

function buildVariantButtons(report) {
  const box = $('alabVariants');
  box.replaceChildren();
  for (const name of ['original', ...orderedVariants(report)]) {
    const v = report.variants[name];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-tap alab-variant';
    b.setAttribute('role', 'radio');
    b.dataset.variant = name;
    b.textContent = name === 'original' ? 'Original' : v.label;
    if (v && !v.passed) { b.disabled = true; b.title = 'This version did not pass its quality checks'; }
    b.addEventListener('click', () => select(name));
    box.append(b);
  }
}

function select(name) {
  if (!state.report || name === state.selected) return;
  state.selected = name;
  renderSelected();
  state.player.select(name).catch(() => toast('Could not load that version.', { type: 'error' }));
}

async function showResult(job) {
  const report = job.report;
  state.report = report;
  state.jobId = job.id;
  remember(job.id);
  state.spectrograms = null;
  const names = orderedVariants(report).filter(n => report.variants[n].passed);
  state.selected = learnedDefault(downloadCounts(), names, names.includes(report.default_variant) ? report.default_variant : names[0]);

  $('alabResultTitle').textContent = job.name || 'Your recording';
  $('alabExpires').textContent = `Kept on the server for ${timeLeft(job.expires)}, then deleted.`;
  buildVariantButtons(report);
  renderDecisions($('alabDecisions'), $('alabWarnings'), report);
  $('alabResult').hidden = false;
  renderInsights($('alabInsights'), report.insights);
  $('alabLoadNote').textContent = 'Loading the versions for listening…';
  $('alabResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (!state.player) {
    state.player = createPlayer({ canvas: $('alabWave'), onChange: onPlayer });
    $('alabMatch').addEventListener('change', e => state.player.setMatchLoudness(e.target.checked));
    $('alabPhone').addEventListener('change', e => state.player.setPhoneSpeaker(e.target.checked));
  }
  state.player.setMatchLoudness($('alabMatch').checked);
  state.player.setPhoneSpeaker($('alabPhone').checked);
  api.getSpectrograms(job.id).then(s => { state.spectrograms = s; renderSelected(); }).catch(() => {});

  const sources = { original: { url: api.fileUrl(job.id, 'original.mp3'), label: 'Original' } };
  for (const n of names) sources[n] = { url: api.fileUrl(job.id, report.variants[n].files.mp3), label: report.variants[n].label };
  renderSelected();
  try {
    await state.player.load(sources, state.selected, { original: report.before.lufs, target: report.target.lufs });
  } catch {
    $('alabLoadNote').textContent = 'The versions could not be loaded for listening. You can still download them below.';
  }
}

function onPlayer(ev) {
  if (ev.type === 'time') {
    $('alabTime').textContent = `${formatClock(ev.position)} / ${formatClock(ev.duration)}`;
  } else if (ev.type === 'ready') {
    $('alabLoadNote').textContent = 'Switch versions while it plays — it carries on from the same moment.';
    $('alabPlay').disabled = false;
  } else if (ev.type === 'loaded') {
    $('alabLoadNote').textContent = 'All versions loaded — switching is instant.';
  } else if (ev.type === 'play' || ev.type === 'pause' || ev.type === 'ended') {
    const playing = ev.type === 'play';
    $('alabPlayIcon').style.display = playing ? 'none' : '';
    $('alabPauseIcon').style.display = playing ? '' : 'none';
    $('alabPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  } else if (ev.type === 'loading') {
    $('alabLoadNote').textContent = `Loading ${variantLabel(ev.name)}…`;
  } else if (ev.type === 'select') {
    $('alabLoadNote').textContent = 'Switch versions while it plays — it carries on from the same moment.';
  }
}

async function deleteNow() {
  const id = state.jobId;
  if (!id || !window.confirm('Delete this recording and all its versions from the server now? Downloaded files are not affected.')) return;
  try {
    await api.deleteJob(id);
  } catch {
    toast('Could not reach the server to delete it. It will be removed automatically.', { type: 'error' });
    return;
  }
  if (state.player) state.player.stop();
  state.jobId = null;
  state.report = null;
  remember(null);
  hideResult();
  toast('Deleted from the server.');
}

async function resume() {
  const id = remembered();
  if (!id || state.jobId || state.busy || !api.isAvailable()) return;
  try {
    const job = await api.getJob(id);
    state.jobId = id;
    if (job.status === 'done' && job.report) {
      showResult(job);
    } else if (job.status === 'queued' || job.status === 'running') {
      setBusy(true);
      onJob(job);
      state.stopWatching = api.watchJob(id, onJob);
    } else {
      remember(null);
    }
  } catch {
    remember(null);
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────

export function leaveAudioLab() {
  if (state.player) state.player.pause();
  if (state.prep) state.prep.stop();
}

function wireFiles() {
  bindDrop('alabTablaDrop', 'alabTablaFile', setTabla);
  $('alabTablaClear').addEventListener('click', () => setTabla(null));
  bindDrop('alabLehraDrop', 'alabLehraFile', file => {
    if (!setSide('lehra', file, { name: 'alabLehraName', clear: 'alabLehraClear' })) return;
    $('alabLehraDrop').classList.toggle('has-file', !!file);
    state.prep.setLehra(file).then(updateAlign).catch(() => showError('That lehra file could not be played here.'));
  });
  $('alabLehraClear').addEventListener('click', () => {
    setSide('lehra', null, { name: 'alabLehraName', clear: 'alabLehraClear' });
    $('alabLehraDrop').classList.remove('has-file');
    state.prep.setLehra(null).then(updateAlign);
  });
  const side = (kind, input, name, clear, after = () => {}) => {
    $(input).addEventListener('change', e => { if (setSide(kind, e.target.files[0] || null, { name, clear })) after(); e.target.value = ''; });
    $(clear).addEventListener('click', () => { setSide(kind, null, { name, clear }); after(); });
  };
  side('recorder', 'alabRecorderFile', 'alabRecorderName', 'alabRecorderClear', () => { if (state.files.tabla && state.info) analyse(); });
  side('vocal', 'alabVocalFile', 'alabVocalName', 'alabVocalClear', () => { $('alabVocalOptions').hidden = !state.files.vocal; });
  side('reference', 'alabReferenceFile', 'alabReferenceName', 'alabReferenceClear');

  $('alabRecord').hidden = !canRecord();
  $('alabRecord').addEventListener('click', record);
  $('alabRecStop').addEventListener('click', () => stopRecording(true));
  $('alabRecCancel').addEventListener('click', () => stopRecording(false));
}

function wireLehra() {
  document.querySelectorAll('#alabLehraMode [data-lehra-mode]').forEach(b => b.addEventListener('click', () => setLehraMode(b.dataset.lehraMode)));
  fillSelect($('alabCatInstrument'), instruments(), 'Sitar');
  refreshCatalogue('init');
  $('alabCatInstrument').addEventListener('change', () => refreshCatalogue('instrument'));
  $('alabCatTaal').addEventListener('change', () => refreshCatalogue('taal'));
  $('alabCatRaag').addEventListener('change', () => refreshCatalogue('raag'));
  $('alabCatBpm').addEventListener('change', () => { $('alabCatBpm').dataset.touched = '1'; scheduleRender(); });
  $('alabCatBpmTabla').addEventListener('click', useTablaTempo);
  $('alabSa').addEventListener('change', saNote);
  $('alabSaTabla').addEventListener('click', () => { if (state.analysis && state.analysis.suggested_sa) setSa(state.analysis.suggested_sa.hz); });
}

function wirePrepare() {
  state.prep = createPreparer({ canvas: $('alabEditor'), onChange: onPrep });
  $('alabPrevPlay').addEventListener('click', () => state.prep.toggle());
  const mode = m => {
    state.prep.setMode(m);
    $('alabModeTrim').setAttribute('aria-checked', String(m === 'trim'));
    $('alabModeNoise').setAttribute('aria-checked', String(m === 'noise'));
    $('alabModeTrim').classList.toggle('active', m === 'trim');
    $('alabModeNoise').classList.toggle('active', m === 'noise');
  };
  $('alabModeTrim').addEventListener('click', () => mode('trim'));
  $('alabModeNoise').addEventListener('click', () => mode('noise'));
  mode('trim');
  $('alabTrimReset').addEventListener('click', () => state.prep.resetTrim());
  $('alabNoiseClear').addEventListener('click', () => state.prep.clearNoise());
  $('alabWithLehra').addEventListener('change', e => state.prep.setWithLehra(e.target.checked));
  $('alabTapSam').addEventListener('click', () => state.prep.tapSam());
  $('alabNudgeMinus').addEventListener('click', () => state.prep.nudge(-10));
  $('alabNudgePlus').addEventListener('click', () => state.prep.nudge(10));
  $('alabOffsetAuto').addEventListener('change', e => { if (e.target.checked) state.prep.setAuto(true); else state.prep.setOffset(0); });
  $('alabLehraDb').addEventListener('input', e => state.prep.setLehraLevel(+e.target.value));
  state.sync = createSyncEditor({ overlay: $('alabSyncModal'), onApply: applySync });
  $('alabSyncOpen').addEventListener('click', openSync);
}

/** The sync editor on the analysed tabla and the chosen lehra (both already decoded for the preview). */
function openSync() {
  const b = state.prep.buffers();
  if (!b.tabla || !b.lehra) { toast('Choose a lehra and wait for the first look at the tabla.'); return; }
  state.prep.stop();
  const meta = state.lehraMode === 'catalogue' && state.rendered ? state.rendered.meta : null;
  const lehra = lehraFile();
  state.sync.open({
    tablaBuffer: b.tabla, lehraBuffer: b.lehra,
    names: { tabla: state.files.tabla ? state.files.tabla.name : 'tabla', lehra: lehra ? lehra.name : 'lehra' },
    start: { offset: b.offset, lehraDb: b.lehraDb, beats: meta && meta.beats, bpm: meta && meta.bpm },
  });
}

/** "Use this sync": the offset (and the lehra level) go to the preview and on to the mastering. */
function applySync({ offset, lehraDb }) {
  state.prep.setOffset(offset);
  $('alabOffsetAuto').checked = false;
  const level = $('alabLehraDb');
  level.value = String(lehraDb);
  level.dispatchEvent(new Event('input', { bubbles: true }));
  toast(`Lehra synced: it starts at ${formatNumber(offset, 3)} s.`);
}

function wireSettings() {
  document.querySelectorAll('#alabTargets [data-target-name]').forEach(b => b.addEventListener('click', () => setTarget(b.dataset.targetName)));
  sliderValue('alabCustomLufs', v => `${formatNumber(v, 1)} LUFS`);
  $('alabCustomLufs').addEventListener('input', () => setTarget('custom'));
  setTarget('reel');
  sliderValue('alabLehraDb', v => `${formatSigned(v, 0)} dB`);
  sliderValue('alabVocalDb', v => `${formatSigned(v, 0)} dB`);
  sliderValue('alabBrightness', v => `${formatSigned(v, 1)} dB`);
  sliderValue('alabBass', v => `${formatSigned(v, 1)} dB`);
  sliderValue('alabShift', v => `${formatSigned(v, 0)}¢`);
  sliderValue('alabSpeed', v => `${v} %`);
  sliderValue('alabTanpuraDb', v => `${formatSigned(v, 0)} dB`);
  sliderValue('alabFadeIn', v => (v ? `${formatNumber(v / 1000, 1)} s` : 'none'));
  sliderValue('alabFadeOut', v => (v ? `${formatNumber(v / 1000, 1)} s` : 'none'));
  $('alabSpeed').addEventListener('input', () => {
    const video = state.analysis ? state.analysis.input.has_video : /^video\//.test((state.files.tabla && state.files.tabla.type) || '');
    $('alabSpeedNote').hidden = !(video && +$('alabSpeed').value !== 100);
  });
  $('alabTanpuraOn').addEventListener('change', e => {
    $('alabTanpuraDb').disabled = !e.target.checked;
    if (e.target.checked && !(parseFloat($('alabSa').value) > 0)) {
      toast('Set a Sa for the tanpura (under “Swaralaya lehra”) — or it is taken from the dayan once the recording is analysed.');
    }
  });
  $('alabShiftToSa').addEventListener('click', () => {
    $('alabShift').value = Math.max(-100, Math.min(100, +$('alabShiftToSa').dataset.cents || 0));
    $('alabShift').dispatchEvent(new Event('input'));
  });
  refreshPresets();
  $('alabPreset').addEventListener('change', e => {
    const p = listPresets().find(x => x.name === e.target.value);
    $('alabPresetDelete').hidden = !p;
    if (!p) return;
    applyControls(p.options);
    if (p.options.target) setTarget(p.options.target);
    toast(`Preset “${p.name}” applied.`);
  });
  $('alabPresetSave').addEventListener('click', () => {
    const name = window.prompt('A name for these settings:', $('alabPreset').value || 'My sound');
    if (name === null) return;
    const saved = savePreset(name, { ...readControls(), target: state.target });
    if (saved) { refreshPresets(saved); toast(`Saved “${saved}” on this device.`); } else toast('Could not save the preset here.', { type: 'error' });
  });
  $('alabPresetDelete').addEventListener('click', () => {
    const name = $('alabPreset').value;
    if (!name) return;
    deletePreset(name);
    refreshPresets();
    toast(`Deleted “${name}”.`);
  });
  $('alabNotify').addEventListener('change', async e => {
    if (!e.target.checked || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* older browsers */ }
    }
    if (Notification.permission !== 'granted') {
      e.target.checked = false;
      toast('Notifications are blocked for this site in the browser’s settings.');
    }
  });
}

function wireBatch() {
  state.batch = createBatch({
    list: $('alabBatchList'),
    onBusy: busy => {
      $('alabBatchStart').disabled = busy || !state.info;
      $('alabBatchStop').hidden = !busy;
      $('alabBatchClear').hidden = busy;
    },
  });
  $('alabBatchFiles').addEventListener('change', e => {
    const files = [...e.target.files].filter(f => !checkFile(f, limits().max_upload_mb));
    const skipped = e.target.files.length - files.length;
    state.batch.add(files);
    e.target.value = '';
    if (skipped) toast(`${skipped} file${skipped === 1 ? '' : 's'} skipped (type or size).`);
    $('alabBatchStart').disabled = !state.info || !state.batch.count();
    $('alabBatchClear').hidden = false;
  });
  $('alabBatchStart').addEventListener('click', () => {
    state.batch.start({ ...readControls(), target: state.target });
  });
  $('alabBatchStop').addEventListener('click', () => { state.batch.stop(); toast('The batch will stop after this recording.'); });
  $('alabBatchClear').addEventListener('click', () => { state.batch.clear(); $('alabBatchClear').hidden = true; $('alabBatchStart').disabled = true; });
}

export function initAudioLab() {
  if (wired || !$('view-audio')) return;
  wired = true;

  wireFiles();
  wirePrepare();
  wireLehra();
  wireSettings();
  wireBatch();
  setLehraMode('none');

  $('alabGo').addEventListener('click', start);
  $('alabCancel').addEventListener('click', cancel);
  $('alabServerRetry').addEventListener('click', async () => { await findServer(); resume(); });
  $('alabPlay').addEventListener('click', () => { if (state.player) state.player.toggle(); });
  $('alabDelete').addEventListener('click', deleteNow);
  $('alabDownloads').addEventListener('click', e => {
    if (e.target.closest('a') && state.selected && state.selected !== 'original') countDownload(state.selected);
  });
  $('alabAnother').addEventListener('click', () => {
    hideResult();
    state.report = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('alabPlay').disabled = true;
}

/** The page is showing (main.js calls this; it loads this module the first time the page opens). */
export async function enterAudioLab() {
  if (!state.searched) await findServer();
  resume();
  setTimeout(() => {
    if (state.player && state.report) state.player.redraw();
    if (state.prep) state.prep.redraw();
  }, 50);
}
