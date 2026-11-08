/**
 * The Audio Lab's settings: reading the controls into the options the service
 * takes, putting saved options back into the controls, and presets ("my sound")
 * kept in this browser. What belongs to one recording — trim, noise sample,
 * lehra offset — is not part of a preset.
 */
import { $, fillSlider } from '../core/dom.js';
import { cleanPresetName } from './format.js';

const PRESETS_KEY = 'swaralaya_audiolab_presets';
const DOWNLOADS_KEY = 'swaralaya_audiolab_downloads';

/** [element id, option key, kind, (control → option), (option → control)] */
export const FIELDS = [
  ['alabProfile', 'profile', 'select'],
  ['alabReverb', 'reverb', 'select'],
  ['alabCustomLufs', 'custom_lufs', 'range'],
  ['alabBrightness', 'brightness_db', 'range'],
  ['alabBass', 'bass_db', 'range'],
  ['alabShift', 'shift_cents', 'range'],
  ['alabSpeed', 'tempo_factor', 'range', v => v / 100, v => Math.round(v * 100)],
  ['alabLehraDb', 'lehra_db', 'range'],
  ['alabVocalDb', 'vocal_db', 'range'],
  ['alabTanpuraDb', 'tanpura_db', 'range'],
  ['alabDenoise', 'denoise', 'select'],
  ['alabHum', 'hum_removal', 'checkbox', on => (on ? 'auto' : 'off'), v => v !== 'off'],
  ['alabMatchPitch', 'match_pitch', 'checkbox'],
  ['alabMatchTempo', 'match_tempo', 'checkbox'],
  ['alabFadeIn', 'fade_in_ms', 'range'],
  ['alabFadeOut', 'fade_out_ms', 'range'],
  ['alabVideoFormat', 'video_format', 'select'],
  ['alabAudioVideo', 'audio_video', 'checkbox'],
  ['alabAbClip', 'ab_clip', 'checkbox'],
];

function readField([id, , kind, to]) {
  const el = $(id);
  if (!el) return undefined;
  const raw = kind === 'checkbox' ? el.checked : kind === 'range' ? +el.value : el.value;
  return to ? to(raw) : raw;
}

/** The options from the controls (the per-recording parts are added by the caller). */
export function readControls() {
  const o = {};
  for (const f of FIELDS) {
    const v = readField(f);
    if (v !== undefined) o[f[1]] = v;
  }
  if (!$('alabTanpuraOn').checked) o.tanpura_db = null;
  const sa = parseFloat($('alabSa').value);
  o.sa_hz = Number.isFinite(sa) && sa > 0 ? sa : null;
  o.title = $('alabTitle').value.trim();
  o.vocal_offset = parseFloat($('alabVocalOffset').value) || 0;
  o.separate_drums = $('alabDrums').checked && !$('alabDrums').disabled;
  return o;
}

/** Put saved options back into the controls (unknown keys are ignored). */
export function applyControls(o) {
  for (const [id, key, kind, , from] of FIELDS) {
    if (!(key in o) || o[key] === null || o[key] === undefined) continue;
    const el = $(id);
    if (!el) continue;
    const v = from ? from(o[key]) : o[key];
    if (kind === 'checkbox') el.checked = !!v;
    else el.value = String(v);
    el.dispatchEvent(new Event(kind === 'checkbox' || kind === 'select' ? 'change' : 'input'));
    if (kind === 'range') fillSlider(el);
  }
  if ('tanpura_db' in o) {
    $('alabTanpuraOn').checked = o.tanpura_db !== null && o.tanpura_db !== undefined;
    $('alabTanpuraOn').dispatchEvent(new Event('change'));
  }
  if ('title' in o) $('alabTitle').value = o.title || '';
}

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function listPresets() {
  const list = load(PRESETS_KEY, []);
  return Array.isArray(list) ? list.filter(p => p && typeof p.name === 'string' && p.options) : [];
}

/** Save (or replace) a preset; returns its tidied name, or null. */
export function savePreset(name, options) {
  const clean = cleanPresetName(name);
  if (!clean) return null;
  const list = listPresets().filter(p => p.name !== clean);
  list.push({ name: clean, options });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return save(PRESETS_KEY, list.slice(0, 40)) ? clean : null;
}

export function deletePreset(name) {
  save(PRESETS_KEY, listPresets().filter(p => p.name !== name));
}

/** Count a download of a version, so the one you keep choosing is shown first next time. */
export function countDownload(variant) {
  const counts = load(DOWNLOADS_KEY, {});
  counts[variant] = (counts[variant] || 0) + 1;
  save(DOWNLOADS_KEY, counts);
}

export function downloadCounts() {
  return load(DOWNLOADS_KEY, {});
}
