/**
 * Riyaz games progress, kept in this browser: Swar Pehchaan's best score,
 * and Sam Pakdo's stars and best score per stage.
 */
const KEY = 'swaralaya_games_v1';

/** Validate stored progress (string or object); anything unusable is dropped. */
export function parseProgress(raw) {
  let p = raw;
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw); } catch { p = null; }
  }
  const out = { swarBest: 0, samStars: {}, samBest: {} };
  if (!p || typeof p !== 'object') return out;
  const count = x => (Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
  out.swarBest = count(p.swarBest);
  for (const key of ['samStars', 'samBest']) {
    if (p[key] && typeof p[key] === 'object') {
      for (const [id, v] of Object.entries(p[key])) {
        if (count(v) > 0) out[key][id] = key === 'samStars' ? Math.min(3, count(v)) : count(v);
      }
    }
  }
  return out;
}

export function loadProgress() {
  try {
    return parseProgress(localStorage.getItem(KEY));
  } catch {
    return parseProgress(null); // storage blocked
  }
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch { /* storage blocked or full: progress just isn't kept */ }
}
