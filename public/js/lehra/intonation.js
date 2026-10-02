/**
 * Intonation report for a riyaz take: the voice alone (the recorder keeps a
 * microphone-only copy) pitch-tracked offline (tuner/analysis.js) against
 * the Sa it was sung to, drawn as a pitch graph over the swar lines, with how
 * much of each held note was in tune. Glides between notes aren't judged.
 */
import { ANALYSIS_SR, intonationReport, pitchTrackAsync } from '../tuner/analysis.js';

const TOLERANCE = 20;   // cents either side of a swar that count as in tune
// Just-intonation cents of the shuddha swaras, labelled Bhatkhande-style
const LINES = [['S', 0], ['R', 204], ['G', 386], ['M', 498], ['P', 702], ['D', 884], ['N', 1088]];
const COLORS = { tune: '#5fd38d', off: '#f5a623', glide: 'rgba(237,224,204,0.28)' };

/** Decode and analyse a voice recording (Blob) sung to Sa `sa` Hz. */
export async function analyseTake(blob, sa, progress = () => {}) {
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_SR);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const track = await pitchTrackAsync(audio.getChannelData(0), ANALYSIS_SR, progress);
  return { report: intonationReport(track, sa, { tolerance: TOLERANCE }), seconds: audio.duration };
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const signed = c => `${c >= 0 ? '+' : '−'}${Math.abs(Math.round(c))}`;

/** Label for a swar line `octave` saptaks from madhya: taar gets a dot above, mandra below. */
function lineLabel(name, octave) {
  return name + (octave > 0 ? '̇'.repeat(octave) : octave < 0 ? '̣'.repeat(-octave) : '');
}

function draw(canvas, report, seconds) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 180;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);

  // Pitch range: what was sung (5th–95th percentile), at least madhya Sa to taar Sa
  const sorted = report.points.map(p => p.cents).sort((a, b) => a - b);
  const pct = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const lo = Math.max(-1200, Math.min(-100, pct(0.05) - 100));
  const hi = Math.min(2400, Math.max(1300, pct(0.95) + 100));
  const left = 26, right = 6, top = 6, bottom = 16;
  const x = t => left + (t / Math.max(seconds, 1e-3)) * (w - left - right);
  const y = c => top + (1 - (c - lo) / (hi - lo)) * (h - top - bottom);

  g.font = '10px Outfit, sans-serif';
  g.textBaseline = 'middle';
  for (let octave = -1; octave <= 2; octave++) {
    for (const [name, c] of LINES) {
      const cents = octave * 1200 + c;
      if (cents < lo || cents > hi) continue;
      const sa = name === 'S';
      g.strokeStyle = sa ? 'rgba(245,166,35,0.45)' : 'rgba(255,255,255,0.08)';
      g.lineWidth = sa ? 1 : 0.5;
      g.beginPath();
      g.moveTo(left, y(cents));
      g.lineTo(w - right, y(cents));
      g.stroke();
      g.fillStyle = sa ? '#f5a623' : 'rgba(237,224,204,0.55)';
      g.fillText(lineLabel(name, octave), 4, y(cents));
    }
  }
  for (const p of report.points) {
    if (p.cents < lo || p.cents > hi) continue;
    g.fillStyle = !p.held ? COLORS.glide : p.inTune ? COLORS.tune : COLORS.off;
    g.fillRect(x(p.t) - 1, y(p.cents) - 1, 2, 2);
  }
  g.fillStyle = 'rgba(237,224,204,0.5)';
  g.textBaseline = 'alphabetic';
  g.fillText('0:00', left, h - 3);
  g.textAlign = 'right';
  g.fillText(fmt(seconds), w - right, h - 3);
}

/** Show `result` (from analyseTake) in `el`. */
export function renderReport(el, { report, seconds }) {
  el.innerHTML = '';
  if (report.heldSec < 1.5) {
    const p = document.createElement('p');
    p.className = 'tool-status';
    p.textContent = 'Not enough clear, held singing to judge. Sing some sustained swaras — and use headphones, so the microphone hears only you.';
    el.appendChild(p);
    return;
  }
  const summary = document.createElement('p');
  summary.className = 'report-summary';
  summary.innerHTML = `<strong>${Math.round(report.inTune * 100)}%</strong> of held notes in tune (±${TOLERANCE} cents) · on average <strong>${Math.round(report.meanAbsCents)}</strong> cents from the swar`;
  const canvas = document.createElement('canvas');
  canvas.className = 'report-graph';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Pitch of your singing over the swar lines: green in tune, amber off, grey glides');
  const legend = document.createElement('p');
  legend.className = 'report-legend';
  legend.innerHTML = '<span class="dot tune"></span>in tune <span class="dot off"></span>off <span class="dot glide"></span>glide (not judged)';
  const list = document.createElement('ul');
  list.className = 'report-swaras';
  for (const s of report.swaras.filter(s => s.sec >= 0.4).slice(0, 7)) {
    const li = document.createElement('li');
    const drift = Math.abs(s.meanCents) >= 10 ? (s.meanCents > 0 ? ' sharp' : ' flat') : '';
    li.className = drift ? 'drift' : '';
    li.textContent = `${s.qualifier ? s.qualifier + ' ' : ''}${s.name} ${signed(s.meanCents)}¢${drift}`;
    li.title = `${s.sec.toFixed(1)} s held`;
    list.appendChild(li);
  }
  el.append(summary, canvas, legend, list);
  requestAnimationFrame(() => draw(canvas, report, seconds));
  draw(canvas, report, seconds); // also now, in case frames are paused (hidden tab)
}
