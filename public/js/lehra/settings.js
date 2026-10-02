/**
 * "Remember my setup": the Lehra selection, tempo, pitch, volumes, FX,
 * metronome options, loop and wake lock are saved to localStorage and
 * restored on load — plus named presets of the same snapshot.
 *
 * A setup can also travel as a link (/lehra#s=…, core/share.js) that opens
 * it on another device — for a teacher sending a student the exact raag,
 * taal, tempo and Sa.
 *
 * Restoring goes through the real UI paths: each control gets its value and
 * the same input/change event a user would fire, and the raag is re-selected
 * with selectByNames(), so labels, state, the audio graph and the raag
 * preload all stay consistent.
 */
import { $ } from '../core/dom.js';
import { decodeShare, encodeShare, hashParam } from '../core/share.js';
import { toast } from '../core/toast.js';
import { setLoop } from './controls.js';
import { selectByNames } from './selection.js';
import { FINE_TUNE_MAX_HZ, FINE_TUNE_MIN_HZ, onSettingsChange, state } from './state.js';
import { setStatus } from './ui.js';

export const SETTINGS_VERSION = 1;
const SETTINGS_KEY = `lehra_settings_v${SETTINGS_VERSION}`;
const PRESETS_KEY = `lehra_presets_v${SETTINGS_VERSION}`;
const MAX_PRESETS = 50;

// Controls saved by element id: 'value' (range / select) or 'checked'.
const controls = new Map([
  ['lehraVol', 'value'], ['tanpuraVol', 'value'], ['metronomeVol', 'value'],
  ['tanpuraStyleSelect', 'value'], ['tanpuraFirstSelect', 'value'], ['tanpuraPaceSelect', 'value'],
  ['fxBass', 'value'], ['fxTreble', 'value'], ['fxReverb', 'value'],
  ['metronomeToggle', 'checked'], ['metronomeSoundSelect', 'value'],
  ['metronomeSubdivisionSelect', 'value'], ['metronomeAccentsToggle', 'checked'], ['countInToggle', 'checked'],
  ['wakeLockToggle', 'checked'], ['mediaOutputToggle', 'checked'],
]);

/** Save another control too (call before initSettings()). */
export function persistControl(id, kind = 'value') {
  controls.set(id, kind);
}

// ── Snapshot ───────────────────────────────────────────────────────
function snapshot() {
  const values = {};
  for (const [id, kind] of controls) {
    const el = $(id);
    if (el) values[id] = kind === 'checked' ? el.checked : el.value;
  }
  return {
    v: SETTINGS_VERSION,
    instrument: state.instrument,
    taal: state.taal,
    raag: state.raag,
    bpm: state.bpm,
    pitchHz: state.pitchHz,
    pitchPreset: $('pitchSelect').value,
    loop: state.isLooping,
    controls: values,
  };
}

/**
 * Validate a stored snapshot (string or object). Returns null for anything
 * unusable (other version, corrupt JSON); drops individual bad fields.
 */
export function parseSettings(raw) {
  let s = raw;
  if (typeof raw === 'string') {
    try { s = JSON.parse(raw); } catch { return null; }
  }
  if (!s || typeof s !== 'object' || s.v !== SETTINGS_VERSION) return null;
  const str = x => (typeof x === 'string' && x ? x : null);
  const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const out = {
    v: SETTINGS_VERSION,
    instrument: str(s.instrument),
    taal: str(s.taal),
    raag: str(s.raag),
    bpm: num(s.bpm),
    pitchHz: num(s.pitchHz),
    pitchPreset: str(s.pitchPreset),
    loop: typeof s.loop === 'boolean' ? s.loop : null,
    controls: {},
  };
  if (out.bpm !== null && out.bpm <= 0) out.bpm = null;
  if (out.pitchHz !== null && (out.pitchHz < FINE_TUNE_MIN_HZ || out.pitchHz > FINE_TUNE_MAX_HZ)) out.pitchHz = null;
  if (s.controls && typeof s.controls === 'object') {
    for (const [id, v] of Object.entries(s.controls)) {
      if (typeof v === 'string' || typeof v === 'boolean') out.controls[id] = v;
    }
  }
  return out;
}

// ── Restore ────────────────────────────────────────────────────────
let applying = false;

function restoreControl(id, v) {
  const el = $(id), kind = controls.get(id);
  if (!el || !kind) return;
  if (kind === 'checked') {
    if (typeof v !== 'boolean' || el.checked === v) return;
    el.checked = v;
  } else {
    if (typeof v !== 'string' || el.value === v) return;
    const prev = el.value;
    el.value = v;
    if (el.tagName === 'SELECT' && el.value !== v) { el.value = prev; return; } // option gone
  }
  el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change', { bubbles: true }));
}

function restorePitch(s) {
  const sel = $('pitchSelect');
  if (s.pitchPreset && [...sel.options].some(o => o.value === s.pitchPreset)) {
    const changed = sel.value !== s.pitchPreset;
    sel.value = s.pitchPreset;
    if (changed || parseFloat(s.pitchPreset) !== state.pitchHz) sel.dispatchEvent(new Event('change'));
  }
  // A fine-tuned Sa that isn't the preset itself
  if (s.pitchHz !== null && Math.abs(s.pitchHz - state.pitchHz) > 1e-6) {
    const ft = $('fineTuneHz');
    ft.value = s.pitchHz.toFixed(2);
    ft.dispatchEvent(new Event('change'));
  }
}

/** Apply a parsed snapshot (saved setup or preset). */
export function applySettings(s) {
  applying = true;
  try {
    for (const [id, v] of Object.entries(s.controls)) restoreControl(id, v);
    restorePitch(s);
    if (s.loop !== null && s.loop !== state.isLooping) setLoop(s.loop);
    if (s.instrument) selectByNames(s.instrument, s.taal, s.raag, s.bpm);
  } finally {
    applying = false;
  }
  saveNow();
}

// ── Save ───────────────────────────────────────────────────────────
let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot()));
  } catch { /* storage full or unavailable (private mode) */ }
}

function saveSoon() {
  if (applying) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

// ── Presets ────────────────────────────────────────────────────────
/** Add or replace (by name) a preset; the list stays sorted by name. */
export function upsertPreset(list, name, settings) {
  return [...list.filter(p => p.name !== name), { name, settings }]
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function removePreset(list, name) {
  return list.filter(p => p.name !== name);
}

/** One-line description of a snapshot, e.g. "Sarangi · Teentaal · Desh · 90 BPM · Sa 146.83 Hz". */
export function presetSummary(s) {
  const taal = s.taal ? s.taal.replace(/\s*\(.*\)$/, '') : null;
  const parts = [s.instrument, taal, s.raag, s.bpm ? `${s.bpm} BPM` : null,
    s.pitchHz ? `Sa ${s.pitchHz.toFixed(2)} Hz` : null];
  return parts.filter(Boolean).join(' · ') || 'Mixer and options only';
}

function loadPresets() {
  try {
    const list = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter(p => p && typeof p.name === 'string' && p.name)
      .map(p => ({ name: p.name, settings: parseSettings(p.settings) }))
      .filter(p => p.settings);
  } catch {
    return [];
  }
}

function storePresets(list) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function renderPresets() {
  const ul = $('presetList');
  ul.innerHTML = '';
  const list = loadPresets();
  if (!list.length) {
    ul.innerHTML = '<li class="empty-hint">No presets yet.</li>';
    return;
  }
  list.forEach(p => {
    const li = document.createElement('li');
    li.className = 'preset-item';
    const info = document.createElement('div');
    info.className = 'preset-info';
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = p.name;
    const sum = document.createElement('span');
    sum.className = 'preset-summary';
    sum.textContent = presetSummary(p.settings);
    info.append(name, sum);

    const apply = document.createElement('button');
    apply.className = 'header-icon-btn';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      applySettings(p.settings);
      $('presetsModal').classList.remove('active');
      setStatus(`Preset “${p.name}” applied`, state.isPlaying ? 'playing' : '');
      toast(`Preset “${p.name}” applied`, { type: 'success' });
    });

    const del = document.createElement('button');
    del.className = 'header-icon-btn preset-delete';
    del.textContent = '×';
    del.title = `Delete “${p.name}”`;
    del.setAttribute('aria-label', `Delete preset ${p.name}`);
    del.addEventListener('click', () => {
      if (!confirm(`Delete the preset “${p.name}”?`)) return;
      storePresets(removePreset(loadPresets(), p.name));
      renderPresets();
    });

    li.append(info, apply, del);
    ul.appendChild(li);
  });
}

function initPresets() {
  $('presetsBtn')?.addEventListener('click', () => {
    renderPresets();
    $('presetShareUrl').value = '';
    $('presetShareStatus').textContent = '';
    $('presetsModal').classList.add('active');
    $('presetName').focus();
  });
  $('presetsClose')?.addEventListener('click', () => $('presetsModal').classList.remove('active'));
  $('presetShareBtn')?.addEventListener('click', copySetupLink);
  $('presetForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('presetName');
    const name = input.value.trim().slice(0, 40);
    if (!name) return;
    const list = loadPresets();
    if (!list.some(p => p.name === name) && list.length >= MAX_PRESETS) {
      alert(`You can keep up to ${MAX_PRESETS} presets. Delete one first.`);
      return;
    }
    if (!storePresets(upsertPreset(list, name, parseSettings(snapshot())))) {
      alert("Couldn't save the preset (browser storage is full or disabled).");
      return;
    }
    input.value = '';
    renderPresets();
    toast(`Preset “${name}” saved`, { type: 'success' });
  });
}

// ── Share links ────────────────────────────────────────────────────
const SETUP_APP = 'swaralaya-lehra';

/** A link that opens this exact setup: /lehra#s=… */
export async function setupShareLink() {
  return `${location.origin}/lehra#s=${await encodeShare({ app: SETUP_APP, s: snapshot() })}`;
}

async function copySetupLink() {
  const field = $('presetShareUrl');
  field.value = await setupShareLink();
  field.select();
  try {
    await navigator.clipboard.writeText(field.value);
    $('presetShareStatus').textContent = 'Link copied — whoever opens it gets this exact setup.';
  } catch {
    $('presetShareStatus').textContent = 'Copy the link above to share this setup.';
  }
}

/** Open a setup shared as a link (#s=…) in the Lehra player. Call after navigation is initialised. */
export async function openSharedSetup() {
  const payload = hashParam(location.hash, 's');
  if (!payload) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  try {
    const obj = await decodeShare(payload);
    const s = obj && obj.app === SETUP_APP ? parseSettings(obj.s) : null;
    if (!s) throw new Error('it isn’t a Lehra setup');
    document.dispatchEvent(new CustomEvent('nav-internal', { detail: { target: 'view-lehra', domain: 'hindustani' } }));
    applySettings(s);
    setStatus(`Opened a shared setup: ${presetSummary(s)}`, '');
    toast(`Opened a shared setup: ${presetSummary(s)}`, { type: 'success', duration: 6000 });
  } catch (err) {
    alert(`This setup link can't be opened: ${err.message}`);
  }
}

// ── Init ───────────────────────────────────────────────────────────
/** Restore the saved setup and keep saving changes. Call after the other Lehra modules are initialised. */
export function initSettings() {
  onSettingsChange(saveSoon);
  const onControl = e => { if (controls.has(e.target.id)) saveSoon(); };
  document.addEventListener('input', onControl);
  document.addEventListener('change', onControl);
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

  let saved = null;
  try { saved = parseSettings(localStorage.getItem(SETTINGS_KEY)); } catch { /* storage unavailable */ }
  if (saved) applySettings(saved);
  initPresets();
}
