/**
 * Turns the server's report into the results panel.  Everything from the
 * server goes in through textContent, never as HTML.
 */
import { BAND_LABELS, FILE_KINDS, describeGate, formatClock, formatDb, formatNumber, formatSigned } from './format.js';
import { fileUrl } from './api.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tile(value, label, title) {
  const t = el('div', 'stat-tile');
  t.append(el('span', 'stat-tile-value', value), el('span', 'stat-tile-label', label));
  if (title) t.title = title;
  return t;
}

/** The numbers at a glance, for the selected version (or the input alone for the original). */
export function renderTiles(container, report, name) {
  container.replaceChildren();
  const before = report.before;
  const v = report.variants[name];
  const after = v ? v.after : null;
  const noise = before.noise_floor_db;
  container.append(
    tile(after ? `${formatNumber(before.lufs, 1)} → ${formatNumber(after.lufs, 1)}` : formatNumber(before.lufs, 1), 'Loudness (LUFS)',
      'Integrated loudness, before and after'),
    tile(after ? `${formatNumber(before.true_peak_db, 1)} → ${formatNumber(after.true_peak_db, 1)}` : formatNumber(before.true_peak_db, 1),
      'True peak (dBTP)', 'Peaks above −1 dBTP can distort when Instagram or YouTube re-encode'),
    tile(after ? `${before.clip_events} → ${after.clip_events}` : String(before.clip_events), 'Clipping events',
      'Runs of samples at digital full scale'),
    tile(formatNumber(noise, 0), 'Noise floor (dBFS)', 'The level of the quietest passages'),
  );
  if (report.rhythm && report.rhythm.bpm) {
    container.append(tile(`${Math.round(report.rhythm.bpm)}`, 'Tempo (BPM, est.)', `${report.rhythm.strokes} strokes found. Beat tracking is an estimate.`));
  }
  const p = report.dayan_pitch;
  if (p) {
    const sure = p.support >= 0.35;
    container.append(tile(`${p.note} · ${formatNumber(p.hz, 1)} Hz`, sure ? 'Dayan pitch (est.)' : 'Dayan pitch (unsure)',
      'Where the drum rings, to the nearest note and in hertz. For the lehra player’s Sa field.' + (sure ? '' : ' The recording gave a mixed reading, so treat this loosely.')));
  }
}

export function renderGates(container, report, name) {
  container.replaceChildren();
  const v = report.variants[name];
  if (!v) {
    container.append(el('p', 'modal-hint', 'This is your recording as it came in, brought to the same loudness so the comparison is fair.'));
    return;
  }
  for (const gate of v.gates.map(describeGate)) {
    const row = el('li', `alab-gate ${gate.ok ? 'ok' : 'bad'}${gate.advisory ? ' advisory' : ''}`);
    row.title = `${gate.detail}. Limit: ${gate.limit}`;
    row.append(el('span', 'alab-gate-mark', gate.ok ? '✓' : '✗'), el('span', 'alab-gate-label', gate.label),
      el('span', 'alab-gate-value', gate.value));
    row.firstChild.setAttribute('aria-label', gate.ok ? 'passed' : 'failed');
    container.append(row);
  }
}

/** The band balance, before and after, as paired bars. */
export function renderBands(container, report, name) {
  container.replaceChildren();
  const v = report.variants[name];
  const rows = Object.keys(BAND_LABELS);
  const base = report.baseline && report.baseline.bands_db ? report.baseline.bands_db : report.before.bands_db;
  const note = document.getElementById('alabBandsNote');
  if (note) {
    note.textContent = report.baseline && report.baseline.kind === 'tabla_and_lehra'
      ? 'Before = your tabla and lehra mixed at the same levels, with no processing.'
      : 'Before = your recording as it came in.';
  }
  const scale = db => Math.max(0, Math.min(100, (db + 50) / 50 * 100));
  for (const band of rows) {
    const before = base[band];
    const after = v ? v.after.bands_db[band] : null;
    const row = el('div', 'alab-band');
    const bars = el('div', 'alab-band-bars');
    const b = el('span', 'alab-bar before'); b.style.width = `${scale(before)}%`;
    bars.append(b);
    if (after !== null) {
      const a = el('span', 'alab-bar after'); a.style.width = `${scale(after)}%`;
      bars.append(a);
    }
    const delta = after === null ? '' : ` (${formatSigned(after - before, 1)})`;
    row.append(el('span', 'alab-band-name', BAND_LABELS[band]), bars,
      el('span', 'alab-band-value', `${formatNumber(after === null ? before : after, 0)}${delta}`));
    row.title = `${BAND_LABELS[band]}: ${formatDb(before)}${after === null ? '' : ` → ${formatDb(after)}`} relative to the whole signal`;
    container.append(row);
  }
}

/** Plain-language account of what was done, then anything to be aware of. */
export function renderDecisions(list, warnings, report) {
  list.replaceChildren();
  const add = text => list.append(el('li', '', text));
  const r = report.repairs || {};
  const ed = report.edits || {};
  if (ed.trim) add(`Kept ${formatClock(ed.trim[0])}–${formatClock(ed.trim[1])} of the recording.`);
  if (ed.tempo_factor) add(`Speed changed to ${Math.round(ed.tempo_factor * 100)} % (pitch kept).`);
  if (ed.shift_cents) add(`Whole recording moved ${formatSigned(ed.shift_cents, 0)} cents (speed kept).`);
  const sync = report.sync;
  if (sync) {
    add(`Sound from your second recorder, lined up ${formatSigned(sync.lag_s * 1000, 0)} ms against the video`
      + `${sync.drift_ppm ? ` and its clock corrected by ${formatSigned(sync.drift_ppm, 0)} ppm` : ''}.`);
  }
  if (report.profile && report.profile.name !== 'tabla') add(`Shaped as ${report.profile.label}.`);
  if (report.profile && report.profile.reverb !== 'room') add(`Room: ${report.profile.reverb}.`);
  if (report.separation && report.separation.applied) add('The drums were separated from the song first (Demucs), and only they were processed.');
  if (r.declip && r.declip.applied) add(`Clipped peaks repaired: ${r.declip.runs_repaired} of ${r.declip.clip_events_before}.`);
  if (r.hum && r.hum.applied) add(`Mains hum at ${r.hum.hz} Hz removed with narrow notches.`);
  if (r.noise_reduction && r.noise_reduction.applied) {
    const dry = r.noise_reduction.blended_dry ? ` Some of the original was blended back to protect the dayan’s ring.` : '';
    add(`Light noise reduction (60 %) learned from ${r.noise_reduction.learned_from || 'the quietest passage'}.${dry}`);
  } else if (r.noise_reduction && r.noise_reduction.reason && r.noise_reduction.reason !== 'not needed') {
    add(`Noise reduction skipped: ${r.noise_reduction.reason}.`);
  }
  for (const d of report.eq.decisions) add(d);
  const lehra = report.lehra;
  if (lehra) {
    add(`Lehra levelled ${formatNumber(report.options.lehra_db, 1)} LU against the tabla and ducked by up to ${formatNumber(lehra.level.ducking_max_db, 1)} dB under each stroke.`);
    add(`Lehra offset ${formatNumber(lehra.alignment.offset_used_s, 2)} s — ${lehra.alignment.offset_source}.`);
    const rel = lehra.pitch.relation;
    if (rel && rel.reason === 'dayan_pitch_uncertain') {
      add('The lehra’s pitch was not compared with the dayan: the dayan gave a mixed reading.');
    } else if (rel && rel.offset_cents !== null && rel.offset_cents !== undefined) {
      add(`Lehra pitch is ${formatSigned(rel.offset_cents, 0)} cents from the dayan${lehra.pitch.applied_cents ? `; shifted by ${formatSigned(lehra.pitch.applied_cents, 0)} cents` : ''}.`);
    }
  }
  const ex = report.extras || {};
  if (ex.tanpura) add(`Tanpura added at Sa ${ex.tanpura.note} (${formatNumber(ex.tanpura.sa_hz, 1)} Hz), ${formatSigned(ex.tanpura.level_db, 0)} LU under the tabla.`);
  if (ex.vocal) add(`Vocal track shaped and mixed ${formatSigned(ex.vocal.level_db, 0)} LU against the tabla.`);
  const tw = report.warnings || [];
  warnings.replaceChildren(...tw.map(t => el('li', '', t)));
  warnings.hidden = tw.length === 0;
}

/** One download button per file of the selected version, plus the report. */
export function renderDownloads(container, jobId, report, name) {
  container.replaceChildren();
  const v = report.variants[name];
  if (v) {
    for (const kind of FILE_KINDS) {
      const file = v.files[kind.key];
      if (!file) continue;
      const a = el('a', 'header-icon-btn', kind.label);
      a.href = fileUrl(jobId, file, true);
      a.rel = 'noopener';
      container.append(a);
    }
  }
  if (report.files && report.files.ab_clip) {
    const ab = el('a', 'header-icon-btn', 'Before / after clip');
    ab.href = fileUrl(jobId, report.files.ab_clip, true);
    container.append(ab);
  }
  const json = el('a', 'header-icon-btn', 'Report (JSON)');
  json.href = fileUrl(jobId, 'report.json', true);
  container.append(json);
}
