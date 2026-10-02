/**
 * Saving and sharing compositions: a library in localStorage, JSON files
 * (export / import) and share links that carry the whole composition,
 * deflate-compressed, in the URL hash (#n=…) — no server involved.
 */

import { decodeShare, encodeShare, hashParam } from '../core/share.js';

export const DOC_VERSION = 1;
const LIBRARY_KEY = 'notation_library_v1';
const MAX_CELL = 200;
const MODIFIERS = new Set(['underline', 'dot-below', 'dot-above', 'vertical']);

/** Composition → plain object (the file / link format). */
export function serialize({ title, mode, system, language, taal, lines }) {
  return {
    app: 'swaralaya-notation',
    v: DOC_VERSION,
    title,
    mode,
    system,
    language,
    taal,
    lines: lines.map(line => line.map(m => (m.modifier ? [m.content, m.modifier] : m.content))),
  };
}

/**
 * Validate a stored/imported/shared object against the known taals
 * (`taals` = { id: matras }). Returns a composition, or throws with a
 * readable message.
 */
export function deserialize(obj, taals) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'swaralaya-notation') throw new Error('Not a Swaralaya composition');
  if (obj.v !== DOC_VERSION) throw new Error('This composition was made by a newer version');
  const taal = String(obj.taal);
  if (!(taal in taals)) throw new Error(`Unknown taal "${taal}"`);
  const matras = taals[taal];
  if (!Array.isArray(obj.lines) || !obj.lines.length) throw new Error('The composition has no lines');
  const lines = obj.lines.slice(0, 500).map(line => {
    const cells = Array.isArray(line) ? line : [];
    return Array.from({ length: matras }, (_, i) => {
      const c = cells[i];
      const [content, modifier] = Array.isArray(c) ? c : [c, null];
      return {
        matra: i + 1,
        content: typeof content === 'string' && content ? content.slice(0, MAX_CELL) : '-',
        modifier: MODIFIERS.has(modifier) ? modifier : null,
      };
    });
  });
  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
  return {
    title: typeof obj.title === 'string' ? obj.title.slice(0, 120) : 'Untitled Composition',
    mode: pick(obj.mode, ['tabla', 'vocal'], 'tabla'),
    system: pick(obj.system, ['bhatkhande', 'paluskar'], 'bhatkhande'),
    language: pick(obj.language, ['en', 'hi'], 'en'),
    taal,
    lines,
  };
}

// ── Share links (encoding: core/share.js) ────────────────────────────
export { encodeShare, decodeShare };

/** The composition payload in a URL hash like "#n=z…", or null. */
export function shareFromHash(hash) {
  return hashParam(hash, 'n');
}

// ── Library (localStorage) ──────────────────────────────────────────
export function loadLibrary() {
  try {
    const list = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    return Array.isArray(list) ? list.filter(e => e && typeof e.name === 'string' && e.doc) : [];
  } catch {
    return [];
  }
}

export function storeLibrary(list) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Add or replace (by name), newest first. */
export function upsertEntry(list, name, doc, now = Date.now()) {
  return [{ name, doc, saved: now }, ...list.filter(e => e.name !== name)];
}
