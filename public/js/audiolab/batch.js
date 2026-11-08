/**
 * Several recordings with the same settings, one after another (the service
 * runs one job at a time anyway). Each row shows its own progress and, when
 * done, the default version's files. Nothing here waits for the others: a
 * failed recording is marked and the next one starts.
 */
import * as api from './api.js';
import { formatBytes, friendlyError } from './format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createBatch({ list, onBusy = () => {} }) {
  const rows = [];
  let running = false;
  let stopped = false;

  function rowFor(file) {
    const li = el('li', 'alab-batch-row');
    const name = el('span', 'alab-batch-name', `${file.name} · ${formatBytes(file.size)}`);
    const status = el('span', 'alab-batch-status', 'Waiting');
    const links = el('span', 'alab-batch-links');
    const bar = el('span', 'alab-batch-bar');
    const fill = el('span', 'alab-batch-fill');
    bar.append(fill);
    li.append(name, status, bar, links);
    list.append(li);
    return { file, li, status, links, fill };
  }

  function show(row, text, fraction, kind = '') {
    row.status.textContent = text;
    row.fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    row.li.dataset.state = kind;
  }

  function done(row, job) {
    const report = job.report;
    const name = report.default_variant;
    const v = report.variants[name];
    show(row, `Done · ${v.label}`, 1, 'done');
    for (const [key, label] of [['mp3', 'MP3'], ['wav', 'WAV'], ['mp4', 'Video']]) {
      if (!v.files[key]) continue;
      const a = el('a', 'header-icon-btn', label);
      a.href = api.fileUrl(job.id, v.files[key], true);
      row.links.append(a);
    }
  }

  function runOne(row, options) {
    return new Promise(resolve => {
      show(row, 'Uploading…', 0, 'busy');
      const up = api.createJob({ tabla: row.file }, options, f => show(row, `Uploading… ${Math.round(f * 100)} %`, f * 0.1, 'busy'));
      up.promise.then(({ job_id: id }) => {
        api.watchJob(id, job => {
          if (job.status === 'queued') show(row, 'Waiting for the studio', 0.1, 'busy');
          else if (job.status === 'running') show(row, job.message || 'Working', 0.1 + 0.9 * job.progress, 'busy');
          else if (job.status === 'done') { done(row, job); resolve(); }
          else if (job.status === 'failed') {
            const e = job.error || {};
            show(row, friendlyError(e.code, e.message), 0, 'failed');
            resolve();
          }
        });
      }).catch(err => {
        show(row, friendlyError(err.code, err.message), 0, 'failed');
        resolve();
      });
    });
  }

  return {
    add(files) {
      for (const f of files) rows.push({ ...rowFor(f), started: false });
    },
    clear() {
      if (running) return;
      rows.length = 0;
      list.replaceChildren();
    },
    count: () => rows.filter(r => !r.started).length,
    async start(options) {
      if (running) return;
      running = true;
      stopped = false;
      onBusy(true);
      for (const row of rows) {
        if (row.started || stopped) continue;
        row.started = true;
        await runOne(row, options);
      }
      running = false;
      onBusy(false);
    },
    stop() { stopped = true; },
    isRunning: () => running,
  };
}
