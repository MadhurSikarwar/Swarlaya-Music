/**
 * The Audio Lab on Vercel (audio_lab/serverless.py): the same calls as api.js
 * makes to the Docker service, for a server that keeps nothing between requests.
 *
 *   upload    each recording goes straight to Vercel Blob (a signed URL from
 *             /api/master-upload; the browser never holds a credential), under
 *             audio-lab/<job>/in/<role>.<ext> — <job> is 128 random bits made here
 *   run       POST /api/master/run streams one run's progress as JSON lines and
 *             ends with its report and the Blob URLs of its files
 *   split     a long recording is mastered as several runs at once (planRuns),
 *             retried when a server is busy, and put back together (mergeRuns)
 *
 * The job's state lives in this page (and its finished result in localStorage,
 * so a reload can show it again); the files are deleted from Blob after a day.
 */
import { keptSeconds, mergeRuns, planRuns } from './format.js';

const UPLOAD_URL = '/api/master-upload';
const MB = 1024 * 1024;
const SAVED_KEY = 'swaralaya.audiolab.serverlessJob';
const BUSY_RETRY_MS = [3000, 6000];
const BUSY_GIVE_UP_MS = 10 * 60 * 1000;
const HARD_GATES = new Set(['loudness_pyloudnorm', 'loudness_ffmpeg', 'true_peak', 'no_new_clipping', 'band_tilt', 'duration',
  'duration_video']);

const TYPES = {
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
  webm: 'video/webm', avi: 'video/x-msvideo', aif: 'audio/aiff', aiff: 'audio/aiff', wma: 'audio/x-ms-wma', caf: 'audio/x-caf',
};
const FROM_TYPE = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
};

let base = '/api/master';
let health = null;
const jobs = new Map();

export function configure(address, info) {
  base = address;
  health = info;
}

const hex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

function failure(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

/** The extension a recording is stored under (the server reads the contents, not the name). */
export function storedExtension(file) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(file.name || '');
  const ext = m ? m[1].toLowerCase() : '';
  if (TYPES[ext]) return ext;
  return FROM_TYPE[(file.type || '').split(';')[0]] || 'mp4';
}

/** How long a recording plays, from the browser's own decoder (null if it cannot tell). */
function mediaDuration(file) {
  return new Promise(resolve => {
    const el = document.createElement((file.type || '').startsWith('audio') ? 'audio' : 'video');
    const url = URL.createObjectURL(file);
    const done = value => { clearTimeout(timer); URL.revokeObjectURL(url); el.removeAttribute('src'); resolve(value); };
    const timer = setTimeout(() => done(null), 8000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

// ── The job registry: what index.js reads through getJob / watchJob ──────────

function publicJob(job) {
  const out = {
    id: job.id, status: job.status, stage: job.stage, progress: job.progress, message: job.message,
    queue_position: 0, error: job.error, name: job.name, kind: job.kind, rev: job.rev,
    expires: job.created + (health?.serverless?.ttl_hours ?? 24) * 3600, has_video: job.hasVideo,
  };
  if (job.status === 'done') out[job.kind === 'analyse' ? 'analysis' : 'report'] = job.report;
  return out;
}

function update(job, changes) {
  Object.assign(job, changes);
  job.rev += 1;
  const view = publicJob(job);
  for (const fn of [...job.listeners]) fn(view);
}

function newJob({ kind, name, folder, inputs = {}, hasVideo = false, duration = null }) {
  const job = {
    id: hex(16), kind, name, folder, inputs: { ...inputs }, hasVideo, duration,
    status: 'queued', stage: 'queued', progress: 0, message: 'Waiting for the studio', error: null,
    report: null, spectrograms: null, files: {}, outputs: [], created: Date.now() / 1000, rev: 0,
    listeners: new Set(), controllers: new Set(), gone: false,
  };
  jobs.set(job.id, job);
  return job;
}

function save(job) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({
      id: job.id, kind: job.kind, name: job.name, folder: job.folder, inputs: job.inputs, created: job.created,
      report: job.report, spectrograms: job.spectrograms, files: job.files, outputs: job.outputs, hasVideo: job.hasVideo,
      uploadMb: job.uploadMb,
    }));
  } catch { /* storage full or unavailable: a reload just won't show it again */ }
}

function restore(id) {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
    if (!saved || saved.id !== id) return null;
    const job = newJob(saved);
    jobs.delete(job.id);
    Object.assign(job, saved, { status: 'done', stage: 'done', progress: 1, message: 'Finished' });
    jobs.set(job.id, job);
    return job;
  } catch {
    return null;
  }
}

// ── Uploading ─────────────────────────────────────────────────────────────────

async function uploadAll(job, files, onProgress, signal) {
  const list = Object.entries(files).filter(([, f]) => f);
  if (!list.length) return;
  const { uploadPresigned } = await import('../vendor/vercel-blob-client.js');
  const total = list.reduce((s, [, f]) => s + f.size, 0) || 1;
  let sent = 0;
  for (const [role, file] of list) {
    const ext = storedExtension(file);
    // a new name for every upload: a replaced lehra must never be served from a cache as the old one
    const pathname = `audio-lab/${job.folder}/in/${role}-${hex(4)}.${ext}`;
    try {
      await uploadPresigned(pathname, file, {
        access: 'public', handleUploadUrl: UPLOAD_URL, contentType: TYPES[ext], abortSignal: signal,
        multipart: file.size > 100 * MB,
        onUploadProgress: e => onProgress(Math.min(1, (sent + (e.loaded || 0)) / total)),
      });
    } catch (err) {
      if (signal.aborted) throw failure('Cancelled.', 'aborted');
      throw failure(`The upload failed: ${err && err.message ? err.message : 'the connection dropped'}.`, 'network');
    }
    job.inputs[role] = pathname;
    sent += file.size;
    onProgress(sent / total);
  }
}

/**
 * Upload what is needed and start the work. Same contract as api.createJob:
 * resolves { job_id, kind } once the recordings are uploaded; returns { promise, abort }.
 */
export function createJob(files, options, onProgress = () => {}, { mode = 'master', from = null } = {}) {
  const ctl = new AbortController();
  const promise = (async () => {
    let job;
    if (from) {
      const src = jobs.get(from) || restore(from);
      if (!src || src.gone || !src.inputs.tabla) throw failure('That analysed recording was not found. Upload it again.', 'not_found', 404);
      job = newJob({ kind: 'master', name: src.name, folder: src.folder, inputs: src.inputs, hasVideo: src.hasVideo,
        duration: src.report?.duration_s ?? src.duration });
      job.uploadMb = src.uploadMb || 0;
      await uploadAll(job, { lehra: files.lehra, reference: files.reference, vocal: files.vocal }, onProgress, ctl.signal);
    } else {
      if (!files.tabla) throw failure('Choose a tabla recording to process.', 'no_file', 400);
      job = newJob({ kind: mode === 'analyse' ? 'analyse' : 'master', name: files.tabla.name || 'recording', folder: hex(16),
        hasVideo: (files.tabla.type || '').startsWith('video') || /\.(mp4|mov|mkv|webm|avi)$/i.test(files.tabla.name || '') });
      if (job.kind === 'master') job.duration = await mediaDuration(files.tabla);
      job.uploadMb = files.tabla.size / MB;
      await uploadAll(job, files, onProgress, ctl.signal);
    }
    job.options = options || {};
    (job.kind === 'analyse' ? runAnalysis : runMaster)(job);
    return { job_id: job.id, kind: job.kind };
  })();
  return { promise, abort: () => ctl.abort() };
}

// ── Running ───────────────────────────────────────────────────────────────────

const pause = ms => new Promise(r => setTimeout(r, ms));

/**
 * One run on the server: POST and read its JSON lines. Resolves the result
 * line; rejects with .code (busy, timeout, …). `onProgress(fraction, message)`.
 */
async function call(job, body, onProgress) {
  const ctl = new AbortController();
  job.controllers.add(ctl);
  try {
    let res;
    try {
      res = await fetch(`${base}/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
        cache: 'no-store',
      });
    } catch {
      throw failure('The connection to the studio dropped.', ctl.signal.aborted ? 'aborted' : 'network');
    }
    if (!res.ok || !res.body) {
      let err = {};
      try { err = await res.json(); } catch { /* not JSON */ }
      throw failure(err.error || `The studio answered ${res.status}.`, err.code || (res.status === 504 ? 'timeout' : 'server'), res.status);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        throw failure('The connection to the studio dropped while it was working. Please try again.', ctl.signal.aborted ? 'aborted' : 'network');
      }
      if (chunk.done) break;
      buffer += chunk.value;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'progress') onProgress(msg.progress, msg.message);
        else if (msg.type === 'result') return msg;
        else if (msg.type === 'error') throw failure(msg.message, msg.code);
      }
    }
    throw failure('The studio stopped before it finished (it may have run out of time). Try a shorter recording.', 'timeout');
  } finally {
    job.controllers.delete(ctl);
  }
}

/** call(), waiting and trying again while every server is busy with someone else's recording. */
async function callWhenFree(job, body, onProgress) {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      return await call(job, body, onProgress);
    } catch (err) {
      if (err.code !== 'busy' || job.gone || Date.now() - started > BUSY_GIVE_UP_MS) throw err;
      onProgress(0, 'Waiting for a free studio');
      const [lo, hi] = BUSY_RETRY_MS;
      await pause(lo + Math.random() * (hi - lo) * Math.min(1 + attempt / 3, 3));
    }
  }
}

function fail(job, err) {
  if (job.gone || job.status === 'failed') return;
  for (const c of job.controllers) c.abort();
  update(job, { status: 'failed', message: err.message, error: { code: err.code || 'internal', message: err.message } });
}

async function runAnalysis(job) {
  update(job, { status: 'running', stage: 'start', progress: 0.01, message: 'Starting' });
  try {
    const result = await callWhenFree(job, {
      job: job.folder, run: hex(8), mode: 'analyse', inputs: job.inputs, options: {}, name: job.name,
    }, (p, message) => !job.gone && update(job, { progress: p, message: message || job.message }));
    if (job.gone) return;
    job.files = result.files;
    job.outputs = Object.values(result.files).map(f => f.pathname);
    update(job, { status: 'done', stage: 'done', progress: 1, message: 'Ready', report: result.report });
  } catch (err) {
    fail(job, err);
  }
}

async function runMaster(job) {
  update(job, { status: 'running', stage: 'start', progress: 0.01, message: 'Starting' });
  const opts = job.options;
  const order = opts.variants?.length ? [...opts.variants] : ['balanced', 'phone_bass', 'soft_highs'];
  const s = health?.serverless || {};
  const seconds = Number.isFinite(job.duration) ? keptSeconds(job.duration, opts) : null;
  if (seconds !== null && s.max_seconds && seconds > s.max_seconds + 0.5) {
    fail(job, failure(`On this site a recording can be up to ${(s.max_seconds / 60).toFixed(1)} minutes long (this one is `
      + `${(seconds / 60).toFixed(1)}). Trim it in step 2, or run the Audio Lab on your own computer for longer recordings.`, 'over_limit'));
    return;
  }
  // without a length (the browser could not read it) every version gets a run of its own: always fits
  const runs = seconds === null ? order.map(n => [n]) : planRuns(order, {
    seconds, uploadMb: job.uploadMb || 0, hasVideo: job.hasVideo, budget: Math.max(60, (s.budget_s || 280) - 40),
    diskMb: Math.max(200, (s.tmp_free_mb || 500) - 60),
  });
  const progress = runs.map(() => 0);
  const show = (i, p, message) => {
    if (job.gone) return;
    progress[i] = Math.max(progress[i], p || 0);
    const total = progress.reduce((a, b) => a + b, 0) / runs.length;
    const label = runs.length > 1 ? `${message || 'Working'} (${runs.length} versions at once)` : (message || 'Working');
    update(job, { progress: Math.max(0.02, total), message: i === 0 || runs.length === 1 ? label : job.message });
  };
  const one = (variants, lead, i) => callWhenFree(job, {
    job: job.folder, run: hex(8), mode: 'master', inputs: job.inputs, name: job.name,
    options: { ...opts, variants, ab_clip: lead ? opts.ab_clip : false }, lead, require_pass: false,
  }, (p, m) => show(i, p, m)).then(r => ({ ...r, lead }));
  try {
    const parts = await Promise.all(runs.map(async (variants, i) => {
      try {
        return [await one(variants, i === 0, i)];
      } catch (err) {
        if (err.code !== 'timeout' || variants.length === 1) throw err;
        // too much for one call after all: the same versions one by one
        return Promise.all(variants.map((v, k) => one([v], i === 0 && k === 0, i)));
      }
    }));
    if (job.gone) return;
    const flat = parts.flat();
    const merged = mergeRuns(flat.map(r => ({ report: r.report, spectrograms: r.spectrograms, files: r.files, lead: r.lead })), order);
    job.outputs = flat.flatMap(r => Object.values(r.files).map(f => f.pathname));
    if (!merged.passed.length) {
      const failed = Object.values(merged.report.variants)
        .map(v => `${v.label}: ${v.gates.filter(g => !g.pass && HARD_GATES.has(g.name)).map(g => g.name).join(', ')}`).join('; ');
      fail(job, failure(`Every version failed its quality checks (${failed}).`, 'gates_failed'));
      return;
    }
    job.files = merged.files;
    job.spectrograms = merged.spectrograms;
    job.files['report.json'] = { url: URL.createObjectURL(new Blob([JSON.stringify(merged.report, null, 1)], { type: 'application/json' })) };
    job.files['report.json'].download = job.files['report.json'].url;
    update(job, { status: 'done', stage: 'done', progress: 1, message: 'Finished', report: merged.report });
    save(job);
  } catch (err) {
    fail(job, err);
  }
}

// ── What index.js calls ──────────────────────────────────────────────────────

export function fileUrl(jobId, name, download = false) {
  const f = (jobs.get(jobId) || restore(jobId))?.files?.[name];
  if (!f) return '';
  return download ? f.download || f.url : f.url;
}

export async function getJob(jobId) {
  const job = jobs.get(jobId) || restore(jobId);
  if (!job || job.gone) throw failure('That job was not found. Results are kept for a day, in the browser that made them.', 'not_found', 404);
  return publicJob(job);
}

export async function getSpectrograms(jobId) {
  return (jobs.get(jobId) || restore(jobId))?.spectrograms || null;
}

export async function deleteJob(jobId) {
  const job = jobs.get(jobId) || restore(jobId);
  if (!job) return false;
  job.gone = true;
  for (const c of job.controllers) c.abort();
  for (const other of jobs.values()) if (other.folder === job.folder) other.gone = true;   // they share the uploads
  const paths = [...Object.values(job.inputs), ...job.outputs].filter(Boolean);
  for (const other of jobs.values()) if (other.folder === job.folder) paths.push(...other.outputs);
  try { localStorage.removeItem(SAVED_KEY); } catch { /* unavailable */ }
  const res = await fetch(`${base}/delete`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: job.folder, paths: [...new Set(paths)] }),
  });
  return res.ok;
}

export function watchJob(jobId, onUpdate) {
  const job = jobs.get(jobId) || restore(jobId);
  if (!job) {
    onUpdate({ id: jobId, status: 'failed', error: { code: 'gone', message: 'This job has expired or was removed.' }, progress: 0, message: '' });
    return () => {};
  }
  const listener = view => onUpdate(view);
  job.listeners.add(listener);
  queueMicrotask(() => job.listeners.has(listener) && onUpdate(publicJob(job)));
  return () => job.listeners.delete(listener);
}
