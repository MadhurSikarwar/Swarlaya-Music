/** Instrument → taal → raag pickers and the tempo panel. */
import { $ } from '../core/dom.js';
import { CATALOGUE } from './catalogue.js';
import { applyTempoChange, preloadSelectedRaag, switchPlayingRaag } from './player.js';
import { renderBeatDots, updateMatraDisplay, showMatraRow } from './scheduler.js';
import { settingsChanged, state } from './state.js';
import { updateNowPlaying } from './visuals.js';

// The tempo slider has 210 steps across the taal's range, like the app.
const SLIDER_STEPS = 210;

// ── Catalogue ──────────────────────────────────────────────────────
export function renderInstruments() {
  const list = $('instrumentList');
  list.innerHTML = '';
  Object.entries(CATALOGUE).forEach(([name, data]) => {
    const btn = document.createElement('button');
    btn.className = 'selector-btn';
    btn.dataset.name = name;
    const tc = Object.keys(data.taals).length;
    btn.innerHTML = `<span>${name}</span><span class="btn-badge">${tc} taal${tc !== 1 ? 's' : ''}</span>`;
    btn.addEventListener('click', () => selectInstrument(name, btn));
    list.appendChild(btn);
  });
}

function selectInstrument(name, btn) {
  state.instrument = name;
  state.taal = null; state.taalData = null; state.raag = null;
  document.querySelectorAll('#instrumentList .selector-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTaals();
  $('raagList').innerHTML = '<p class="empty-hint">← Select a taal first</p>';
  clearTempoPanel();
  updateNowPlaying();
  renderBeatDots(0);
  updateMatraDisplay(0, 0);
  showMatraRow(false);
  settingsChanged();
}

function renderTaals() {
  const list = $('taalList');
  list.innerHTML = '';
  Object.entries(CATALOGUE[state.instrument].taals).forEach(([name, data]) => {
    const btn = document.createElement('button');
    btn.className = 'selector-btn';
    btn.dataset.name = name;
    btn.innerHTML = `<span>${name}</span><span class="btn-badge">${data.beats} beats</span>`;
    btn.addEventListener('click', () => selectTaal(name, data, btn));
    list.appendChild(btn);
  });
}

function selectTaal(name, data, btn) {
  state.taal = name; state.taalData = data; state.raag = null;
  document.querySelectorAll('#taalList .selector-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRaags(data.raags);
  clearTempoPanel();
  renderBeatDots(data.beats);
  updateNowPlaying();
  updateMatraDisplay(0, data.beats);
  $('matraTotal').textContent = data.beats;
  settingsChanged();
}

function renderRaags(raags) {
  const list = $('raagList');
  list.innerHTML = '';
  Object.keys(raags).forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'selector-btn';
    btn.dataset.name = name;
    btn.textContent = name;
    btn.addEventListener('click', () => selectRaag(name, btn));
    list.appendChild(btn);
  });
}

function selectRaag(name, btn) {
  state.raag = name;
  document.querySelectorAll('#raagList .selector-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Keep the current tempo, clamped to this taal's range (as the app does in
  // calculationForInstrumentRecord), so switching raag mid-riyaz doesn't jump.
  setBpm(state.bpm);
  buildTempoPanel(state.taalData);
  updateNowPlaying();
  applyTempoChange();
  if (state.isPlaying) switchPlayingRaag();
  else preloadSelectedRaag();
}

function buttonNamed(listId, name) {
  return [...$(listId).querySelectorAll('.selector-btn')].find(b => b.dataset.name === name) || null;
}

/**
 * Select instrument → taal → raag by name through the same code paths as
 * clicking them (UI, tempo panel, preload / live raag switch). Stops at the
 * first name that no longer exists in the catalogue; `bpm` is applied with
 * the raag (clamped to the taal's range). Returns how many levels matched.
 */
export function selectByNames(instrument, taal, raag, bpm) {
  const instBtn = CATALOGUE[instrument] && buttonNamed('instrumentList', instrument);
  if (!instBtn) return 0;
  selectInstrument(instrument, instBtn);
  const taalData = CATALOGUE[instrument].taals[taal];
  const taalBtn = taalData && buttonNamed('taalList', taal);
  if (!taalBtn) return 1;
  selectTaal(taal, taalData, taalBtn);
  const raagBtn = taalData.raags[raag] && buttonNamed('raagList', raag);
  if (!raagBtn) return 2;
  if (bpm > 0) state.bpm = bpm;
  selectRaag(raag, raagBtn);
  return 3;
}

// ── Tempo panel ────────────────────────────────────────────────────
function clearTempoPanel() {
  $('tempoPills').innerHTML = '<p class="empty-hint">Select instrument → taal → raag</p>';
  $('tempoSliderWrap').style.display = 'none';
  $('tempoRangeLabel').textContent = '';
  $('sliderTicks').innerHTML = '';
}

function buildTempoPanel(taalData) {
  const { tempos, minTempo, maxTempo } = taalData;
  $('tempoRangeLabel').textContent = `${minTempo}–${maxTempo} BPM`;

  const pills = $('tempoPills');
  pills.innerHTML = '';
  tempos.forEach(t => {
    const pill = document.createElement('button');
    pill.className = 'tempo-preset-pill' + (t === state.bpm ? ' active' : '');
    pill.textContent = t;
    pill.dataset.bpm = t;
    pill.addEventListener('click', () => changeTempo(t));
    pills.appendChild(pill);
  });

  $('tempoSliderWrap').style.display = '';
  buildSliderTicks(tempos, minTempo, maxTempo);
  syncSlider();

  // Sync the typed input range bounds when a new taal is selected
  const tvEl = $('tempoValue');
  if (tvEl) {
    tvEl.min = minTempo;
    tvEl.max = maxTempo;
    tvEl.value = state.bpm;
  }
}

function buildSliderTicks(tempos, minTempo, maxTempo) {
  const wrap = $('sliderTicks');
  wrap.innerHTML = '';
  wrap.style.position = 'relative'; wrap.style.height = '28px';
  const range = maxTempo - minTempo;
  tempos.forEach(t => {
    const tick = document.createElement('div');
    tick.className = 'slider-tick';
    tick.dataset.bpm = t;
    tick.style.position = 'absolute';
    tick.style.left = ((t - minTempo) / range * 100) + '%';
    tick.style.transform = 'translateX(-50%)';
    tick.innerHTML = `<div class="slider-tick-line"></div><div class="slider-tick-label">${t}</div>`;
    tick.addEventListener('click', () => changeTempo(t));
    wrap.appendChild(tick);
  });
}

/** Clamp to the taal's range and store (does not apply it). */
export function setBpm(bpm) {
  if (!state.taalData) return;
  const { minTempo, maxTempo } = state.taalData;
  state.bpm = Math.max(minTempo, Math.min(maxTempo, Math.round(bpm)));
}

/** Set, show and apply a new tempo. */
export function changeTempo(bpm) {
  if (!state.taalData) return;
  setBpm(bpm);
  syncSlider();
  applyTempoChange();
}

export function bpmToProgress(bpm) {
  const { minTempo, maxTempo } = state.taalData;
  return (bpm - minTempo) / (maxTempo - minTempo) * SLIDER_STEPS;
}

export function progressToBpm(progress) {
  const { minTempo, maxTempo } = state.taalData;
  return Math.round(minTempo + (progress / SLIDER_STEPS) * (maxTempo - minTempo));
}

/** Reflect state.bpm in the slider, typed input, and nearest preset pill/tick. */
export function syncSlider() {
  if (!state.taalData) return;
  const progress = bpmToProgress(state.bpm);
  const slider = $('tempoSlider');
  slider.value = progress;
  slider.style.setProperty('--slider-pct', (progress / SLIDER_STEPS * 100).toFixed(1) + '%');
  const tvEl = $('tempoValue');
  if (tvEl) tvEl.value = state.bpm;

  const nearest = state.taalData.tempos.reduce((a, b) =>
    Math.abs(b - state.bpm) < Math.abs(a - state.bpm) ? b : a
  );
  document.querySelectorAll('.tempo-preset-pill').forEach(p =>
    p.classList.toggle('active', +p.dataset.bpm === nearest));
  document.querySelectorAll('.slider-tick').forEach(t =>
    t.classList.toggle('active', +t.dataset.bpm === nearest));
  updateNowPlaying();
}
