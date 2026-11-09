/**
 * Talking to the Audio Lab service (audio_lab/server.py): find it, upload,
 * follow a job's progress, fetch results.  Nothing here touches the page.
 *
 * On Vercel the same address answers from a function (audio_lab/serverless.py,
 * /health says "serverless"), which keeps nothing between requests; then every
 * call below is handled by serverless.js instead, with the same results.
 */
import { AUDIO_LAB_API, LOCAL_FALLBACK } from './config.js';
import * as sls from './serverless.js';

let base = null;   // the address that answered /health
let serverless = false;

function candidates() {
  const list = [AUDIO_LAB_API];
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (local && LOCAL_FALLBACK !== AUDIO_LAB_API) list.push(LOCAL_FALLBACK);
  return list;
}

async function getJson(url, { timeout = 6000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON: a static host's HTML page, say */ }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How long the site's own address may take to answer /health. On Vercel the
 * first request after a deploy or a quiet spell starts the Python function
 * (a large bundle), which can take well over the usual few seconds.
 */
export const WAKE_TIMEOUT_MS = 45000;

/**
 * Look for the service. Resolves { ok: true, info } once /health answers as
 * the Audio Lab (and remembers where), else { ok: false, reason }.
 * `onSlow()` is called once if the answer takes longer than `slowAfterMs`.
 */
export async function detect({ onSlow = () => {}, slowAfterMs = 4000 } = {}) {
  const slow = setTimeout(onSlow, slowAfterMs);
  try {
    for (const [i, candidate] of candidates().entries()) {
      // the site's own address may be waking up; the local fallback answers at once or is not there
      const timeout = i === 0 ? WAKE_TIMEOUT_MS : 6000;
      const { ok, body } = await getJson(`${candidate}/health`, { timeout }).catch(() => ({}));
      if (ok && body && body.service === 'audio-lab' && body.status === 'ok') {
        base = candidate;
        serverless = !!body.serverless;
        if (serverless) sls.configure(candidate, body);
        return { ok: true, info: body };
      }
    }
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(slow);
  }
}

export const isAvailable = () => base !== null;

const need = () => {
  if (base === null) throw new Error('The Audio Lab service has not been found.');
  return base;
};

export const fileUrl = (jobId, name, download = false) => (serverless ? sls.fileUrl(jobId, name, download)
  : `${need()}/jobs/${jobId}/files/${name}${download ? '?download=1' : ''}`);

/**
 * Upload recordings and start a job. `files` = { tabla, lehra?, reference?, recorder?, vocal? },
 * `options` the settings object, `mode` 'master' or 'analyse' (a quick look first).
 * With `from` = an analysed job's id nothing is uploaded again: that job's
 * recordings are mastered (only a lehra, reference or vocal may be added).
 * `onProgress(0–1)` follows the upload. Resolves { job_id, kind }, rejects with
 * an Error that carries .code and .status. Returns { promise, abort }.
 */
export function createJob(files, options, onProgress = () => {}, { mode = 'master', from = null } = {}) {
  if (serverless) return sls.createJob(files, options, onProgress, { mode, from });
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    const keys = from ? ['lehra', 'reference', 'vocal'] : ['tabla', 'lehra', 'reference', 'recorder', 'vocal'];
    for (const key of keys) {
      if (files[key]) form.append(key, files[key], files[key].name);
    }
    form.append('options', JSON.stringify(options));
    if (!from) form.append('mode', mode);
    xhr.open('POST', from ? `${need()}/jobs/${from}/master` : `${need()}/jobs`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && body && body.job_id) return resolve(body);
      const err = new Error((body && body.error) || `The upload failed (${xhr.status}).`);
      err.code = body && body.code;
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(Object.assign(new Error('The connection dropped during the upload.'), { code: 'network' }));
    xhr.onabort = () => reject(Object.assign(new Error('Cancelled.'), { code: 'aborted' }));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export async function getJob(jobId) {
  if (serverless) return sls.getJob(jobId);
  const { ok, status, body } = await getJson(`${need()}/jobs/${jobId}`, { timeout: 10000 });
  if (!ok) throw Object.assign(new Error((body && body.error) || 'Could not read the job.'), { status, code: body && body.code });
  return body;
}

export async function getSpectrograms(jobId) {
  if (serverless) return sls.getSpectrograms(jobId);
  const { ok, body } = await getJson(fileUrl(jobId, 'spectrograms.json'), { timeout: 20000 });
  return ok ? body : null;
}

export async function deleteJob(jobId) {
  if (serverless) return sls.deleteJob(jobId);
  const res = await fetch(`${need()}/jobs/${jobId}`, { method: 'DELETE' });
  return res.ok;
}

/**
 * Follow a job. Server-sent events when available (each change arrives at
 * once); if the stream drops or the host buffers it, fall back to asking every
 * 1.5 s. `onUpdate(job)` gets every status; the last has status done/failed.
 * Returns stop().
 */
export function watchJob(jobId, onUpdate) {
  if (serverless) return sls.watchJob(jobId, onUpdate);
  let stopped = false;
  let source = null;
  let poll = 0;
  let lastRev = -1;

  const deliver = job => {
    if (stopped || job.rev === lastRev && job.status !== 'done' && job.status !== 'failed') return;
    lastRev = job.rev;
    onUpdate(job);
    if (job.status === 'done' || job.status === 'failed') stop();
  };

  const startPolling = () => {
    if (stopped || poll) return;
    const tick = async () => {
      if (stopped) return;
      try {
        deliver(await getJob(jobId));
      } catch (err) {
        if (err.status === 404) {
          stop();
          onUpdate({ id: jobId, status: 'failed', error: { code: 'gone', message: 'This job has expired or was removed.' }, progress: 0, message: '' });
          return;
        }
      }
      if (!stopped) poll = setTimeout(tick, 1500);
    };
    poll = setTimeout(tick, 0);
  };

  function stop() {
    stopped = true;
    if (source) { source.close(); source = null; }
    clearTimeout(poll);
  }

  if (typeof EventSource === 'undefined') {
    startPolling();
  } else {
    source = new EventSource(`${need()}/jobs/${jobId}/events`);
    source.addEventListener('update', e => {
      try { deliver(JSON.parse(e.data)); } catch { /* ignore a malformed event */ }
    });
    source.addEventListener('gone', () => startPolling());
    source.onerror = () => {   // the stream broke (or a proxy buffers it): keep going by polling
      if (source) { source.close(); source = null; }
      startPolling();
    };
  }
  return stop;
}
