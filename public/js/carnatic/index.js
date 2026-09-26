/**
 * Carnatic suite: a shruti box and a talam metronome sharing the page's
 * AudioContext and master output (so lock-screen controls work here too).
 * Settings are remembered in localStorage.
 */
import { $, trackSliderFill } from '../core/dom.js';
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput, startMediaOutput, stopMediaOutput } from '../core/audio-output.js';
import { clearMediaSession, setMediaPlaybackState, showMediaSession } from '../core/media-session.js';
import { setShrutiOutput, setShrutiSa, shrutiPlaying, startShruti, stopShruti } from './shruti.js';
import { KATTAI, TALAS } from './talas.js';
import { setNadai, setTala, setTalamOutput, setTalamTempo, startTalam, stopTalam, talamRunning } from './talam.js';

const SETTINGS_KEY = 'carnatic_settings_v1';
const DEFAULTS = {
  tala: 'adi', family: 'triputa', jati: 'chatusra', kalai: 1, bpm: 80, nadai: 1,
  kattai: 2, fineHz: null, sound: 'tanpura', first: 'pa', pace: 'medium', shrutiVol: 70, talamVol: 80,
};
let settings = { ...DEFAULTS };
let shrutiGain = null;
let talamGain = null;
let resumeWhat = null; // what a lock-screen "play" restarts after a pause

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (typeof s[k] === typeof DEFAULTS[k] || (k === 'fineHz' && typeof s[k] === 'number')) settings[k] = s[k];
  } catch { /* storage unavailable */ }
  if (!TALAS[settings.tala] && settings.tala !== 'custom') settings.tala = 'adi';
}

function save() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

/** Sa in Hz: the kattai's pitch, or the fine-tuned value. */
export function carnaticSa() {
  return settings.fineHz || KATTAI[settings.kattai][2];
}

function outputs() {
  if (!shrutiGain) {
    const ctx = getAudioContext();
    shrutiGain = ctx.createGain();
    talamGain = ctx.createGain();
    shrutiGain.connect(getMasterOutput());
    talamGain.connect(getMasterOutput());
    setShrutiOutput(shrutiGain);
    setTalamOutput(talamGain);
    applyVolumes();
  }
}

function applyVolumes() {
  if (!shrutiGain) return;
  const t = getAudioContext().currentTime;
  shrutiGain.gain.setTargetAtTime(settings.shrutiVol / 100, t, 0.02);
  talamGain.gain.setTargetAtTime(settings.talamVol / 100, t, 0.02);
}

function talaDef() {
  return settings.tala === 'custom'
    ? { family: settings.family, jati: settings.jati }
    : TALAS[settings.tala];
}

// ── Lock-screen controls ───────────────────────────────────────────
const MEDIA_ACTIONS = {
  play: () => resume(),
  pause: () => pauseAll(),
  stop: () => stopAll(),
};

function mediaInfo() {
  const [k, note] = KATTAI[settings.kattai];
  const parts = [];
  if (talamRunning()) parts.push(`${$('talamName').textContent} talam`);
  if (shrutiPlaying()) parts.push(`Shruti ${note} (${k} kattai)`);
  return { title: parts[0] || 'Carnatic practice', artist: parts.slice(1).join(' · ') || 'Swaralaya', album: 'Swaralaya Carnatic' };
}

function updateSession() {
  if (talamRunning() || shrutiPlaying()) showMediaSession(mediaInfo(), MEDIA_ACTIONS);
  else if (resumeWhat) setMediaPlaybackState('paused');
  else clearMediaSession(MEDIA_ACTIONS);
}

function pauseAll() {
  resumeWhat = { talam: talamRunning(), shruti: shrutiPlaying() };
  stopTalam();
  stopShruti();
  syncButtons();
  updateSession();
}

function resume() {
  const what = resumeWhat || { talam: true, shruti: false };
  resumeWhat = null;
  outputs();
  startMediaOutput();
  if (what.shruti) playShruti();
  if (what.talam) startTalam();
  syncButtons();
  updateSession();
}

/** Stop everything (leaving the page, or the lock-screen stop button). */
export function stopAll() {
  const wasActive = talamRunning() || shrutiPlaying() || resumeWhat;
  resumeWhat = null;
  stopTalam();
  stopShruti();
  syncButtons();
  updateSession();
  if (wasActive) stopMediaOutput(); // hand the output back from the lock-screen element
}

// ── UI ─────────────────────────────────────────────────────────────
function playShruti() {
  outputs();
  $('shrutiStatus').textContent = settings.sound === 'tanpura' ? 'Tuning the tanpura…' : '';
  startShruti({ sound: settings.sound, sa: carnaticSa(), first: settings.first, pace: settings.pace })
    .then(() => { $('shrutiStatus').textContent = ''; })
    .catch(err => {
      $('shrutiStatus').textContent = `Couldn't load the tanpura: ${err.message}`;
      syncButtons();
      updateSession();
    });
}

function syncButtons() {
  $('shrutiBtn').textContent = shrutiPlaying() ? 'Stop' : 'Start';
  $('shrutiBtn').classList.toggle('active', shrutiPlaying());
  $('talamBtn').textContent = talamRunning() ? 'Stop' : 'Start';
  $('talamBtn').classList.toggle('active', talamRunning());
}

function showSa() {
  const [k, note] = KATTAI[settings.kattai];
  $('shrutiSaLabel').textContent = settings.fineHz
    ? `Sa = ${carnaticSa().toFixed(2)} Hz (fine-tuned)`
    : `Sa = ${note} · ${k} kattai · ${carnaticSa().toFixed(2)} Hz`;
}

function showTala() {
  const custom = settings.tala === 'custom';
  $('talaCustom').hidden = !custom;
  setTala(talaDef(), settings.kalai);
}

function bind(id, key, parse, after) {
  const el = $(id);
  el.value = String(settings[key] ?? '');
  el.addEventListener('change', () => {
    settings[key] = parse(el.value);
    save();
    after && after();
  });
}

export function initCarnatic() {
  if (!$('view-carnatic') || !$('talamBtn')) return;
  load();

  // Shruti
  const sel = $('shrutiKattai');
  KATTAI.forEach(([k, note, hz], i) => sel.add(new Option(`${k} kattai · ${note} (${hz.toFixed(2)} Hz)`, String(i))));
  bind('shrutiKattai', 'kattai', v => parseInt(v, 10), () => {
    settings.fineHz = null;
    $('shrutiFine').value = '';
    save();
    showSa();
    setShrutiSa(carnaticSa());
  });
  $('shrutiFine').value = settings.fineHz ? settings.fineHz.toFixed(2) : '';
  $('shrutiFine').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    settings.fineHz = v >= 60 && v <= 520 ? v : null;
    e.target.value = settings.fineHz ? settings.fineHz.toFixed(2) : '';
    save();
    showSa();
    setShrutiSa(carnaticSa());
  });
  const restartShruti = () => { if (shrutiPlaying()) playShruti(); };
  bind('shrutiSound', 'sound', v => v, restartShruti);
  bind('shrutiFirst', 'first', v => v, restartShruti);
  bind('shrutiPace', 'pace', v => v, restartShruti);
  bind('shrutiVol', 'shrutiVol', v => parseInt(v, 10), applyVolumes);
  $('shrutiVol').addEventListener('input', e => { settings.shrutiVol = +e.target.value; applyVolumes(); });
  $('shrutiBtn').addEventListener('click', () => {
    if (shrutiPlaying()) stopShruti();
    else { outputs(); startMediaOutput(); playShruti(); }
    resumeWhat = null;
    syncButtons();
    updateSession();
    if (!talamRunning() && !shrutiPlaying()) stopMediaOutput();
  });

  // Talam
  const talaSel = $('talaSelect');
  Object.entries(TALAS).forEach(([id, t]) => talaSel.add(new Option(t.name, id)));
  talaSel.add(new Option('Other suladi tala…', 'custom'));
  bind('talaSelect', 'tala', v => v, showTala);
  bind('talaFamily', 'family', v => v, showTala);
  bind('talaJati', 'jati', v => v, showTala);
  bind('talaKalai', 'kalai', v => parseInt(v, 10), showTala);
  bind('talamNadai', 'nadai', v => parseInt(v, 10), () => setNadai(settings.nadai));
  bind('talamVol', 'talamVol', v => parseInt(v, 10), applyVolumes);
  $('talamVol').addEventListener('input', e => { settings.talamVol = +e.target.value; applyVolumes(); });
  const setBpm = v => {
    settings.bpm = Math.max(20, Math.min(300, Math.round(v) || DEFAULTS.bpm));
    $('talamBpm').value = settings.bpm;
    setTalamTempo(settings.bpm);
    save();
  };
  $('talamBpm').value = settings.bpm;
  $('talamBpm').addEventListener('change', e => setBpm(parseInt(e.target.value, 10)));
  $('talamMinus').addEventListener('click', () => setBpm(settings.bpm - 2));
  $('talamPlus').addEventListener('click', () => setBpm(settings.bpm + 2));
  $('talamBtn').addEventListener('click', () => {
    if (talamRunning()) stopTalam();
    else { outputs(); startMediaOutput(); startTalam(); }
    resumeWhat = null;
    syncButtons();
    updateSession();
    if (!talamRunning() && !shrutiPlaying()) stopMediaOutput();
  });

  trackSliderFill($('shrutiVol'));
  trackSliderFill($('talamVol'));
  setTalamTempo(settings.bpm);
  setNadai(settings.nadai);
  showTala();
  showSa();
  syncButtons();
}
