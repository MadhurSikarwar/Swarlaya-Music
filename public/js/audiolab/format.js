/**
 * Pure helpers for the Audio Lab page: number and file formatting, the plain
 * wording of the quality gates, waveform peaks, spectrogram colours. No DOM and
 * no Web Audio here, so Node tests import it directly (tests/audiolab.test.js).
 */

const MINUS = '−';

/** −14.0 (a real minus sign); "—" for a missing number. */
export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toFixed(digits);
  return value < 0 && Number(text) !== 0 ? MINUS + text : text;
}

export const formatDb = (v, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${formatNumber(v, digits)} dB`);
export const formatLufs = v => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${formatNumber(v, 1)} LUFS`);

/** +2.0 / −2.0 for sliders and EQ values. */
export function formatSigned(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return (value > 0 ? '+' : '') + formatNumber(value, digits);
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** 83.4 → "1:23" (hours when needed). */
export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "about 18 hours" / "less than an hour" until `expires` (epoch seconds). */
export function timeLeft(expires, now = Date.now() / 1000) {
  const hours = (expires - now) / 3600;
  if (!(hours > 0)) return 'expired';
  if (hours < 1) return 'less than an hour';
  const h = Math.round(hours);
  return `about ${h} hour${h === 1 ? '' : 's'}`;
}

/** Roughly the extension a file will be saved with. */
export function extensionOf(name) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export const ACCEPTED_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'aif', 'aiff', 'wma', 'caf'];

/** Quick check before uploading; the server checks the contents properly. */
export function checkFile(file, maxMb) {
  if (!file) return 'Choose a file first.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxMb * 1024 * 1024) return `That file is ${formatBytes(file.size)}; the limit is ${maxMb} MB.`;
  const ext = extensionOf(file.name);
  if (ext && !ACCEPTED_EXTENSIONS.includes(ext)) return `“.${ext}” files are not supported. Use WAV, MP3, M4A, FLAC, OGG, MP4 or MOV.`;
  return '';
}

// ── Quality gates in plain words ─────────────────────────────────────────────

export const GATE_LABELS = {
  loudness_pyloudnorm: 'Loudness (pyloudnorm)',
  loudness_ffmpeg: 'Loudness (ffmpeg)',
  true_peak: 'True peak',
  no_new_clipping: 'No clipping',
  band_tilt: 'Tone change',
  duration: 'Length',
  duration_video: 'Video length',
  true_peak_mp3: 'True peak after MP3',
  true_peak_aac: 'True peak after AAC',
  dayan_ring: 'Dayan ring kept',
};

const GATE_UNITS = {
  loudness_pyloudnorm: v => formatLufs(v),
  loudness_ffmpeg: v => formatLufs(v),
  true_peak: v => `${formatNumber(v, 2)} dBTP`,
  true_peak_mp3: v => `${formatNumber(v, 2)} dBTP`,
  true_peak_aac: v => `${formatNumber(v, 2)} dBTP`,
  no_new_clipping: v => `${v} events`,
  band_tilt: v => `${formatSigned(v, 1)} dB`,
  duration: v => `${formatSigned(v * 1000, 0)} ms`,
  duration_video: v => `${formatSigned(v * 1000, 0)} ms`,
  dayan_ring: v => `${formatSigned(v, 1)} dB`,
};

const ADVISORY = new Set(['true_peak_mp3', 'true_peak_aac', 'dayan_ring']);

/** {label, ok, advisory, value, limit, detail} for one gate of the report. */
export function describeGate(gate) {
  const fmt = GATE_UNITS[gate.name];
  return {
    name: gate.name,
    label: GATE_LABELS[gate.name] || gate.name,
    ok: !!gate.pass,
    advisory: ADVISORY.has(gate.name),
    value: gate.value === null || gate.value === undefined ? '—' : (fmt ? fmt(gate.value) : String(gate.value)),
    limit: String(gate.limit ?? '').replace(/-/g, MINUS),
    detail: gate.detail || '',
  };
}

export const BAND_LABELS = {
  sub: 'Sub 20–60 Hz', bayan: 'Bayan 60–120 Hz', low_mid: 'Low-mid 120–250 Hz', mud: 'Mud 250–500 Hz',
  mid: 'Mid 0.5–2 kHz', attack: 'Attack 2–5 kHz', brilliance: 'Brilliance 5–10 kHz', air: 'Air 10 kHz+',
};

/** Per-variant file buttons in display order: [{key, label}]. */
export const FILE_KINDS = [
  { key: 'wav', label: 'WAV 24-bit' },
  { key: 'mp3', label: 'MP3 320k' },
  { key: 'aac', label: 'AAC 256k' },
  { key: 'mp4', label: 'Video (MP4)' },
];

/** Variants in a fixed order, the default first. */
export function orderedVariants(report) {
  const names = Object.keys(report?.variants || {});
  const rank = n => (n === report.default_variant ? -1 : ['balanced', 'phone_bass', 'soft_highs'].indexOf(n));
  return names.sort((a, b) => rank(a) - rank(b));
}

/** Gain (linear) that returns a loudness-matched original to its natural level. */
export function naturalLevelGain(originalLufs, targetLufs) {
  if (!Number.isFinite(originalLufs) || !Number.isFinite(targetLufs)) return 1;
  return Math.min(4, 10 ** ((originalLufs - targetLufs) / 20));
}

// ── Pictures ─────────────────────────────────────────────────────────────────

/** Min/max per column of `data` (a Float32Array) for drawing a waveform. */
export function computePeaks(data, columns) {
  const mins = new Float32Array(columns), maxs = new Float32Array(columns);
  const step = data.length / columns;
  for (let c = 0; c < columns; c++) {
    const a = Math.floor(c * step), b = Math.max(a + 1, Math.floor((c + 1) * step));
    let lo = 1, hi = -1;
    const stride = Math.max(1, Math.floor((b - a) / 64));   // enough samples to catch the peak, cheap on long files
    for (let i = a; i < b; i += stride) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    mins[c] = lo > hi ? 0 : lo;
    maxs[c] = lo > hi ? 0 : hi;
  }
  return { mins, maxs };
}

/** base64 → Uint8Array (the server's spectrogram bytes). */
export function decodeBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 0–255 → [r, g, b] along the site's dark → ember → gold gradient. */
export function heatColor(v) {
  const stops = [[0, [9, 8, 6]], [70, [58, 24, 14]], [140, [232, 87, 42]], [215, [245, 166, 35]], [255, [255, 232, 170]]];
  const x = Math.max(0, Math.min(255, v));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1], [x1, c1] = stops[i];
      const t = (x - x0) / (x1 - x0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
    }
  }
  return stops[stops.length - 1][1];
}

/** Plain-language errors for the codes the server uses. */
export function friendlyError(code, fallback) {
  const table = {
    unreadable: 'That file could not be read as audio or video.',
    unsupported: 'That file type is not supported. Use WAV, MP3, M4A, FLAC, OGG, MP4 or MOV.',
    no_audio: 'That file has no audio track.',
    too_large: 'That upload is too large.',
    too_long: 'That recording is too long for this studio.',
    too_short: 'That recording is shorter than one second.',
    silent_input: 'That recording is silent, so there is nothing to master.',
    busy: 'The studio is busy right now. Please try again in a few minutes.',
    too_many: 'You already have recordings processing. Wait for one to finish.',
    gates_failed: 'The result did not pass its quality checks, so no file was released. Try the −14 LUFS target or a gentler setting.',
    no_demucs: 'Drum separation is not installed on this server. Upload the tabla on its own instead.',
    no_matchering: 'Reference matching is not installed on this server.',
    timeout: 'Processing took too long and was stopped.',
    restarted: 'The server restarted while this was processing. Please upload again.',
  };
  return table[code] || fallback || 'Something went wrong. Please try again.';
}

// ── Timing, pitch and preferences ────────────────────────────────────────────

/**
 * The lehra offset (s, in (−period/2, period/2]) from taps on the tabla's sam:
 * the lehra loop (which starts on its sam) should begin at each tap, so the
 * answer is the taps' circular mean modulo the loop period. Null without taps.
 */
export function offsetFromTaps(taps, period) {
  if (!taps.length || !(period > 0)) return null;
  let x = 0, y = 0;
  for (const t of taps) {
    const a = (2 * Math.PI * t) / period;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  let off = (Math.atan2(y, x) / (2 * Math.PI)) * period;
  if (off > period / 2) off -= period;
  if (off <= -period / 2) off += period;
  return off;
}

/** How tightly the taps agree (0–1): 1 = every tap on the same point of the cycle. */
export function tapAgreement(taps, period) {
  if (taps.length < 2 || !(period > 0)) return null;
  let x = 0, y = 0;
  for (const t of taps) {
    const a = (2 * Math.PI * t) / period;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  return Math.hypot(x, y) / taps.length;
}

/** The same pitch class moved by octaves into the lehra player's Sa range (87.31–207.65 Hz). */
export function foldSa(hz, lo = 87.31, hi = 207.65) {
  if (!(hz > 0)) return null;
  while (hz > hi) hz /= 2;
  while (hz < lo) hz *= 2;
  return hz;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 138.59 → { name: 'C#', octave: 3, cents: 0 } */
export function noteOf(hz) {
  if (!(hz > 0)) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const n = Math.round(midi);
  return { name: NOTE_NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1, cents: Math.round((midi - n) * 100) || 0 };
}

export function centsBetween(a, b) {
  return 1200 * Math.log2(a / b);
}

/** Whole cycles to render so the loop is at least `minSeconds` long (and at least two cycles). */
export function cyclesToRender(cycleSeconds, minSeconds = 20) {
  return Math.max(2, Math.ceil(minSeconds / cycleSeconds));
}

/** The version a visitor keeps downloading becomes the one selected first. */
export function learnedDefault(counts, available, fallback) {
  let best = null, most = 2;          // two downloads before it counts as a habit
  for (const name of available) {
    const n = counts?.[name] || 0;
    if (n > most) { best = name; most = n; }
  }
  return best || fallback;
}

/** A preset name a visitor typed, tidied (or null if nothing is left). */
export function cleanPresetName(name) {
  const s = String(name || '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 40);
  return s || null;
}

// ── The serverless build (Vercel): fitting the work to one function's limits ───

/** Seconds of the upload that are mastered: the trim, then a speed change. */
export function keptSeconds(duration, options = {}) {
  const start = Math.max(0, Number(options.trim_start) || 0);
  const end = options.trim_end == null ? duration : Math.min(duration, Number(options.trim_end));
  return Math.max(0, end - start) / (Number(options.tempo_factor) || 1);
}

/**
 * Rough cost of one run, measured on the real recordings (one CPU, the whole
 * pipeline): about 0.25 s per second of audio for what every run does, 0.5 s
 * per second for each version, plus fetching and storing. `speed` scales it for
 * a slower CPU.
 */
export function runSeconds(seconds, versions, { speed = 1.5, overhead = 20 } = {}) {
  return speed * seconds * (0.25 + 0.5 * versions) + overhead;
}

/**
 * Split the versions into runs that each fit one function call: by time
 * (`budget` s) and by temporary disk (`diskMb`: the upload, and per version a
 * 24-bit WAV, the lossy files and, for a video, an MP4 about the upload's size).
 * Runs are as even as possible; the first (the "lead", which also makes the
 * shared files) gets the default version and is never the biggest.
 * Returns [[names…], …] — one run when everything fits.
 */
export function planRuns(variants, { seconds, uploadMb = 0, hasVideo = false, budget = 240, diskMb = 450, speed = 1.5,
  defaultVariant = 'phone_bass' } = {}) {
  const names = [...variants];
  if (names.length <= 1) return [names];
  const perVersionMb = seconds * 0.29 + seconds * 0.05 + (hasVideo ? uploadMb : 0);
  let most = names.length;
  while (most > 1 && (runSeconds(seconds, most, { speed }) > budget || uploadMb + most * perVersionMb > diskMb)) most--;
  const runs = Math.ceil(names.length / most);
  if (runs === 1) return [names];
  const ordered = names.includes(defaultVariant) ? [defaultVariant, ...names.filter(n => n !== defaultVariant)] : names;
  // as even as possible, the spare versions going to the later runs (the lead does more besides)
  const base = Math.floor(names.length / runs), extra = names.length % runs;
  const out = [];
  let at = 0;
  for (let i = 0; i < runs; i++) {
    const size = base + (i >= runs - extra ? 1 : 0);
    out.push(ordered.slice(at, at + size));
    at += size;
  }
  return out;
}

/**
 * Put the runs of one job back together: the lead's report (the shared parts),
 * every run's versions in the order asked for, their spectrograms and files,
 * and every warning once. Each part is { report, spectrograms, files, lead }.
 */
export function mergeRuns(parts, order, defaultVariant = 'phone_bass') {
  const lead = parts.find(p => p.lead) || parts[0];
  const report = JSON.parse(JSON.stringify(lead.report));
  report.variants = {};
  const spectrograms = { before: lead.spectrograms?.before };
  const files = {};
  const warnings = [];
  for (const p of parts) {
    Object.assign(files, p.files || {});
    for (const w of p.report.warnings || []) if (!warnings.includes(w)) warnings.push(w);
  }
  for (const name of order) {
    const from = parts.find(p => p.report.variants?.[name]);
    if (!from) continue;
    report.variants[name] = from.report.variants[name];
    if (from.spectrograms?.[name]) spectrograms[name] = from.spectrograms[name];
  }
  const passed = order.filter(n => report.variants[n]?.passed);
  report.default_variant = passed.includes(defaultVariant) ? defaultVariant : (passed[0] ?? null);
  report.warnings = warnings;
  report.seconds_taken = Math.max(...parts.map(p => p.report.seconds_taken || 0));
  return { report, spectrograms, files, passed };
}
