/**
 * Raag finder: one search box across the whole catalogue (instrument, taal
 * and raag at once), with favourites and the recently played a tap away —
 * instead of walking the three lists every time.
 *
 * Choosing a result goes through selectByNames(), the same path as clicking
 * the lists, so the tempo panel, the preload and a live raag switch all
 * behave exactly as they do there. Favourites and recents are kept in this
 * browser (localStorage).
 */
import { $ } from '../core/dom.js';
import { CATALOGUE } from './catalogue.js';
import { selectByNames } from './selection.js';
import { on, onSettingsChange, state } from './state.js';

const FAVOURITES_KEY = 'lehra_favourites_v1';
const RECENTS_KEY = 'lehra_recents_v1';
const MAX_FAVOURITES = 24;
const MAX_RECENTS = 6;
const MAX_RESULTS = 8;

// ── Pure helpers (unit-tested) ─────────────────────────────────────
const shortTaal = taal => taal.replace(/\s*\(.*\)$/, '');

/**
 * Lower-case, punctuation-free, and blind to the usual spelling variants of
 * transliterated names: Bageshree / Bageshri, Bhoopali / Bhupali, Teentaal /
 * Tintal, Madhuwanti / Madhuvanti.
 */
export function fold(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a').replace(/w/g, 'v')
    .trim();
}

export const entryKey = (instrument, taal, raag) => `${instrument}|${taal}|${raag}`;

/** Every raag in the catalogue as { key, instrument, taal, taalShort, raag, beats, … }. */
export function catalogueEntries(catalogue) {
  const out = [];
  for (const [instrument, inst] of Object.entries(catalogue)) {
    for (const [taal, data] of Object.entries(inst.taals)) {
      for (const raag of Object.keys(data.raags)) {
        const taalShort = shortTaal(taal);
        const words = fold(`${raag} ${instrument} ${taalShort} ${data.beats} beats`);
        out.push({
          key: entryKey(instrument, taal, raag), instrument, taal, taalShort, raag, beats: data.beats,
          raagFolded: fold(raag),
          haystack: `${words} ${words.replace(/ /g, '')}`, // also matches "teen taal" typed as two words
        });
      }
    }
  }
  return out;
}

/**
 * Entries matching every word of `query`, best first: raags that start with
 * the first word, then raags that contain it, then matches on the instrument
 * or taal; alphabetical within each.
 */
export function searchEntries(entries, query, limit = MAX_RESULTS) {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const rank = e => (e.raagFolded.startsWith(words[0]) ? 0 : e.raagFolded.includes(words[0]) ? 1 : 2);
  return entries
    .filter(e => words.every(w => e.haystack.includes(w)))
    .sort((a, b) => rank(a) - rank(b) || a.raag.localeCompare(b.raag) || a.instrument.localeCompare(b.instrument))
    .slice(0, limit);
}

/** `key` added to the front of `list`, or removed if it was there; at most `max` kept. */
export function toggleInList(list, key, max = MAX_FAVOURITES) {
  return list.includes(key) ? list.filter(k => k !== key) : [key, ...list].slice(0, max);
}

/** `key` moved to the front of `list` (most recent first), at most `max` kept. */
export function pushRecent(list, key, max = MAX_RECENTS) {
  return [key, ...list.filter(k => k !== key)].slice(0, max);
}

// ── Storage ────────────────────────────────────────────────────────
const entries = catalogueEntries(CATALOGUE);
const byKey = new Map(entries.map(e => [e.key, e]));

function load(storageKey) {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey) || '[]');
    // Raags that have since left the catalogue are dropped
    return Array.isArray(list) ? list.filter(k => byKey.has(k)) : [];
  } catch {
    return [];
  }
}

function store(storageKey, list) {
  try { localStorage.setItem(storageKey, JSON.stringify(list)); } catch { /* storage full or unavailable */ }
}

const currentKey = () => (state.raag ? entryKey(state.instrument, state.taal, state.raag) : null);

// ── Choosing ───────────────────────────────────────────────────────
/** Bring the selected buttons into view inside their own lists (without scrolling the page). */
function revealSelection() {
  for (const id of ['instrumentList', 'taalList', 'raagList']) {
    const list = $(id), btn = list?.querySelector('.selector-btn.active');
    if (!btn) continue;
    const box = list.getBoundingClientRect(), b = btn.getBoundingClientRect();
    if (b.top < box.top) list.scrollTop -= box.top - b.top + 6;
    else if (b.bottom > box.bottom) list.scrollTop += b.bottom - box.bottom + 6;
  }
}

function choose(entry) {
  if (!entry) return;
  if (entry.key !== currentKey()) selectByNames(entry.instrument, entry.taal, entry.raag);
  revealSelection();
}

// ── Search box (a combobox with a listbox of results) ──────────────
let results = [];
let active = -1;

function setActive(i) {
  const input = $('raagSearch'), list = $('raagResults');
  active = i;
  [...list.querySelectorAll('[role="option"]')].forEach((li, n) => li.setAttribute('aria-selected', String(n === i)));
  if (i >= 0) input.setAttribute('aria-activedescendant', `raagOption${i}`);
  else input.removeAttribute('aria-activedescendant');
}

function closeResults() {
  const input = $('raagSearch'), list = $('raagResults');
  list.hidden = true;
  list.replaceChildren();
  results = [];
  input.setAttribute('aria-expanded', 'false');
  setActive(-1);
}

function renderResults() {
  const input = $('raagSearch'), list = $('raagResults');
  const query = input.value.trim();
  if (!query) { closeResults(); return; }
  results = searchEntries(entries, query);
  list.replaceChildren();
  if (!results.length) {
    const li = document.createElement('li');
    li.className = 'finder-empty';
    li.textContent = `No raag, taal or instrument matches “${query}”.`;
    list.appendChild(li);
  }
  results.forEach((e, i) => {
    const li = document.createElement('li');
    li.id = `raagOption${i}`;
    li.className = 'finder-option';
    li.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.className = 'finder-option-name';
    name.textContent = e.raag;
    const where = document.createElement('span');
    where.className = 'finder-option-where';
    where.textContent = `${e.instrument} · ${e.taalShort} · ${e.beats} beats`;
    li.append(name, where);
    // pointerdown, not click: the input must not lose focus (and close the list) first
    li.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      pick(i);
    });
    list.appendChild(li);
  });
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  setActive(results.length ? 0 : -1);
}

function pick(i) {
  const entry = results[i];
  if (!entry) return;
  $('raagSearch').value = '';
  closeResults();
  choose(entry);
}

function initSearch() {
  const input = $('raagSearch');
  input.addEventListener('input', renderResults);
  input.addEventListener('focus', renderResults);
  input.addEventListener('blur', closeResults);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      e.stopPropagation(); // not the tempo shortcut
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      if (input.value) {
        e.stopPropagation();
        input.value = '';
        closeResults();
      } else {
        input.blur();
      }
    }
  });
}

// ── Favourites and recents ─────────────────────────────────────────
function chip(entry, favourite) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'finder-chip' + (favourite ? ' favourite' : '') + (entry.key === currentKey() ? ' active' : '');
  b.title = `${entry.raag} · ${entry.instrument} · ${entry.taalShort}`;
  const name = document.createElement('span');
  name.className = 'finder-chip-name';
  name.textContent = (favourite ? '★ ' : '') + entry.raag;
  const where = document.createElement('span');
  where.className = 'finder-chip-where';
  where.textContent = entry.taalShort;
  b.append(name, where);
  b.setAttribute('aria-label', `${favourite ? 'Favourite' : 'Recent'}: ${entry.raag}, ${entry.instrument}, ${entry.taalShort}`);
  b.addEventListener('click', () => choose(entry));
  return b;
}

function renderChips() {
  const host = $('raagChips');
  if (!host) return;
  const favourites = load(FAVOURITES_KEY);
  const recents = load(RECENTS_KEY).filter(k => !favourites.includes(k));
  host.replaceChildren(
    ...favourites.map(k => chip(byKey.get(k), true)),
    ...recents.map(k => chip(byKey.get(k), false)),
  );
  if (!favourites.length && !recents.length) {
    const hint = document.createElement('span');
    hint.className = 'finder-hint';
    hint.textContent = 'Star a raag to keep it here; the ones you play are remembered too.';
    host.appendChild(hint);
  }
}

function renderFavouriteButton() {
  const btn = $('favBtn');
  if (!btn) return;
  const key = currentKey();
  btn.hidden = !key;
  if (!key) return;
  const starred = load(FAVOURITES_KEY).includes(key);
  btn.setAttribute('aria-pressed', String(starred));
  btn.title = starred ? 'Remove from favourites' : 'Add to favourites';
  btn.setAttribute('aria-label', `${starred ? 'Remove' : 'Add'} ${state.raag} ${starred ? 'from' : 'to'} favourites`);
}

function refresh() {
  renderFavouriteButton();
  renderChips();
}

function rememberPlayed() {
  const key = currentKey();
  if (!key) return;
  const recents = load(RECENTS_KEY);
  if (recents[0] === key) return;
  store(RECENTS_KEY, pushRecent(recents, key));
  renderChips();
}

/** Put the cursor in the search box (the "/" shortcut). */
export function focusRaagSearch() {
  const input = $('raagSearch');
  if (!input) return;
  input.scrollIntoView({ block: 'center', behavior: 'instant' });
  input.focus();
  input.select();
}

export function initFinder() {
  if (!$('raagSearch')) return;
  initSearch();
  $('favBtn')?.addEventListener('click', () => {
    const key = currentKey();
    if (!key) return;
    store(FAVOURITES_KEY, toggleInList(load(FAVOURITES_KEY), key));
    refresh();
  });
  // A raag counts as played once it sounds — also when switched to mid-lehra
  on('playback', kind => { if (kind === 'playing') rememberPlayed(); });
  // 'settings' also fires for every tempo and pitch change: only a new raag matters here
  let shown = currentKey();
  onSettingsChange(() => {
    const key = currentKey();
    if (key === shown) return;
    shown = key;
    if (state.isPlaying) rememberPlayed();
    refresh();
  });
  refresh();
}
