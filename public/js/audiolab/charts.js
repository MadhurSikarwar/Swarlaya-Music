/**
 * The riyaz insights in the results: tempo over time, how evenly the strokes
 * are played, the stroke families, sam timing and tuning. Canvas charts in
 * the site's colours; every value from the server goes in as text, never HTML.
 */
import { formatClock, formatNumber, formatSigned } from './format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function colour(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.font = `${11 * dpr}px Outfit, sans-serif`;
  return { g, w, h, dpr };
}

/** Tempo over time: the curve, the average, rushed (warm) and dragged (cool) stretches. */
export function drawLaya(canvas, laya) {
  const { g, w, h, dpr } = setup(canvas);
  if (!laya || !laya.curve.length) return;
  const pad = { l: 40 * dpr, r: 8 * dpr, t: 8 * dpr, b: 18 * dpr };
  const ts = laya.curve.map(p => p[0]), bs = laya.curve.map(p => p[1]);
  const t0 = ts[0], t1 = ts[ts.length - 1] || 1;
  const lo = Math.min(...bs, laya.bpm * 0.9), hi = Math.max(...bs, laya.bpm * 1.1);
  const x = t => pad.l + ((t - t0) / (t1 - t0 || 1)) * (w - pad.l - pad.r);
  const y = b => pad.t + (1 - (b - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);
  for (const s of laya.sections || []) {
    g.fillStyle = s.kind === 'rushing' ? 'rgba(232,87,42,0.16)' : 'rgba(120,160,220,0.14)';
    g.fillRect(x(s.from_s), pad.t, Math.max(dpr, x(s.to_s) - x(s.from_s)), h - pad.t - pad.b);
  }
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.setLineDash([4 * dpr, 4 * dpr]);
  g.beginPath(); g.moveTo(pad.l, y(laya.bpm)); g.lineTo(w - pad.r, y(laya.bpm)); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = colour('--gold', '#f5a623');
  g.lineWidth = 2 * dpr;
  g.beginPath();
  laya.curve.forEach(([t, b], i) => (i ? g.lineTo(x(t), y(b)) : g.moveTo(x(t), y(b))));
  g.stroke();
  g.fillStyle = colour('--text-sub', '#86775f');
  g.textAlign = 'right';
  g.fillText(`${Math.round(hi)}`, pad.l - 6 * dpr, pad.t + 9 * dpr);
  g.fillText(`${Math.round(lo)}`, pad.l - 6 * dpr, h - pad.b);
  g.textAlign = 'left';
  g.fillText(formatClock(t0), pad.l, h - 4 * dpr);
  g.textAlign = 'right';
  g.fillText(formatClock(t1), w - pad.r, h - 4 * dpr);
}

/** Each stroke's level against the loudest tenth: a level band shows the spread. */
export function drawStrokeLevels(canvas, strokes) {
  const { g, w, h, dpr } = setup(canvas);
  if (!strokes || !strokes.series.length) return;
  const pad = { l: 40 * dpr, r: 8 * dpr, t: 8 * dpr, b: 18 * dpr };
  const ts = strokes.series.map(p => p[0]);
  const t0 = ts[0], t1 = ts[ts.length - 1] || 1;
  const lo = -24, hi = 3;
  const x = t => pad.l + ((t - t0) / (t1 - t0 || 1)) * (w - pad.l - pad.r);
  const y = v => pad.t + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (h - pad.t - pad.b);
  g.fillStyle = 'rgba(245,166,35,0.08)';
  g.fillRect(pad.l, y(0), w - pad.l - pad.r, y(-strokes.spread_db) - y(0));
  g.fillStyle = colour('--gold', '#f5a623');
  for (const [t, v] of strokes.series) g.fillRect(x(t) - dpr, y(v) - dpr, 2.5 * dpr, 2.5 * dpr);
  g.fillStyle = colour('--text-sub', '#86775f');
  g.textAlign = 'right';
  g.fillText('0 dB', pad.l - 6 * dpr, y(0) + 4 * dpr);
  g.fillText(`${lo}`, pad.l - 6 * dpr, h - pad.b);
}

function stat(value, label, title) {
  const t = el('div', 'stat-tile');
  t.append(el('span', 'stat-tile-value', value), el('span', 'stat-tile-label', label));
  if (title) t.title = title;
  return t;
}

/** The whole insights block: returns false if there is nothing to show. */
export function renderInsights(root, insights) {
  const { laya, strokes, stroke_types: types, sam, tuning } = insights || {};
  const box = root.querySelector('[data-insight="tiles"]');
  box.replaceChildren();
  if (laya) {
    box.append(stat(`${Math.round(laya.start_bpm)} → ${Math.round(laya.end_bpm)}`, 'Tempo start → end',
      `${formatSigned(laya.drift_pct, 1)} % over the recording. ${laya.note}`));
    box.append(stat(`±${formatNumber(laya.variation_pct, 1)} %`, 'Tempo wobble', 'How much the beat-to-beat tempo moves around its average'));
  }
  if (strokes) {
    box.append(stat(`${formatNumber(strokes.spread_db, 1)} dB`, 'Stroke level spread',
      'Between the softest and loudest tenth of the strokes: smaller is more even'));
    box.append(stat(`${formatSigned(strokes.trend_db_per_min, 1)} dB/min`, 'Getting louder / softer',
      'The trend of stroke loudness across the recording'));
  }
  if (sam && sam.mean_ms !== null && sam.mean_ms !== undefined) {
    box.append(stat(`${formatSigned(sam.mean_ms, 0)} ms`, 'On sam (+ late, − early)',
      `Average over ${sam.hit} of ${sam.sams} sams; ${formatNumber(sam.within_30ms_pct, 0)} % within 30 ms`));
  }
  if (tuning) {
    box.append(stat(`${formatSigned(tuning.cents, 0)} cents`, `Dayan vs ${tuning.tuned_to}`,
      tuning.in_tune ? 'Within 15 cents: in tune' : 'More than 15 cents away: worth retuning'));
  }

  const layaBox = root.querySelector('[data-insight="laya"]');
  layaBox.hidden = !laya;
  if (laya) {
    requestAnimationFrame(() => drawLaya(layaBox.querySelector('canvas'), laya));
    const list = layaBox.querySelector('ul');
    list.replaceChildren(...(laya.sections || []).slice(0, 6).map(s => el('li', '',
      `${s.kind === 'rushing' ? 'Rushing' : 'Dragging'} ${formatClock(s.from_s)}–${formatClock(s.to_s)} (${formatSigned(s.by_pct, 1)} %)`)));
  }
  const levelBox = root.querySelector('[data-insight="levels"]');
  levelBox.hidden = !strokes;
  if (strokes) requestAnimationFrame(() => drawStrokeLevels(levelBox.querySelector('canvas'), strokes));

  const typeBox = root.querySelector('[data-insight="types"]');
  typeBox.hidden = !types;
  if (types) {
    const bars = typeBox.querySelector('.alab-types');
    bars.replaceChildren();
    for (const [key, label] of Object.entries(types.labels)) {
      const row = el('div', 'alab-type');
      const bar = el('span', 'alab-type-bar');
      const fill = el('span', `alab-type-fill alab-type-${key}`);
      fill.style.width = `${Math.round(types.share[key] * 100)}%`;
      bar.append(fill);
      row.append(el('span', 'alab-type-name', label), bar, el('span', 'alab-type-value', `${Math.round(types.share[key] * 100)} %`));
      bars.append(row);
    }
    typeBox.querySelector('.alab-type-note').textContent = types.note;
  }
  const any = !!(laya || strokes || types || sam || tuning);
  root.hidden = !any;
  return any;
}
