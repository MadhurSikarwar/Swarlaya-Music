/**
 * Riyaz games: the rules — levels, scoring, judging taps — with no browser
 * APIs, so they're unit-tested (tests/games.test.js).
 *
 *   Swar Pehchaan  hear a swar against Sa, name it on the keyboard.
 *   Sam Pakdo      the lehra plays; tap exactly on sam.
 */

// ── Swar Pehchaan ────────────────────────────────────────────────────
// The 12 swar positions (as in tuner/swar.js), with just-intonation ratios.
export const SWARAS = [
  { id: 'S', name: 'Sa', ratio: 1 },
  { id: 'r', name: 'Re', q: 'komal', ratio: 16 / 15 },
  { id: 'R', name: 'Re', ratio: 9 / 8 },
  { id: 'g', name: 'Ga', q: 'komal', ratio: 6 / 5 },
  { id: 'G', name: 'Ga', ratio: 5 / 4 },
  { id: 'M', name: 'Ma', ratio: 4 / 3 },
  { id: 'm', name: 'Ma', q: 'tivra', ratio: 45 / 32 },
  { id: 'P', name: 'Pa', ratio: 3 / 2 },
  { id: 'd', name: 'Dha', q: 'komal', ratio: 8 / 5 },
  { id: 'D', name: 'Dha', ratio: 5 / 3 },
  { id: 'n', name: 'Ni', q: 'komal', ratio: 16 / 9 },
  { id: 'N', name: 'Ni', ratio: 15 / 8 },
];
export const swarById = id => SWARAS.find(s => s.id === id);
export const swarLabel = s => (s.q ? `${s.q} ${s.name}` : s.name);

/** Levels: each adds swaras (the last also moves them across octaves). */
export const SWAR_LEVELS = [
  { name: 'Bhupali', pool: ['S', 'R', 'G', 'P', 'D'] },
  { name: 'Shuddha', pool: ['S', 'R', 'G', 'M', 'P', 'D', 'N'] },
  { name: 'Komal Re, Ga', pool: ['S', 'r', 'R', 'g', 'G', 'M', 'P', 'D', 'N'] },
  { name: 'All twelve', pool: SWARAS.map(s => s.id) },
  { name: 'Three saptaks', pool: SWARAS.map(s => s.id), octaves: [-1, 0, 1] },
];
export const CORRECT_PER_LEVEL = 5;
export const LIVES = 3;

/** 0-based level after `correct` right answers. */
export function swarLevel(correct) {
  return Math.min(SWAR_LEVELS.length - 1, Math.floor(correct / CORRECT_PER_LEVEL));
}

/**
 * The next question: a swar from the level's pool, never the same as the
 * last one, and an octave (0 = madhya). `random` returns [0, 1).
 */
export function nextQuestion(level, previous, random = Math.random) {
  const { pool, octaves = [0] } = SWAR_LEVELS[level];
  const choices = pool.length > 1 ? pool.filter(id => id !== previous) : pool;
  const id = choices[Math.floor(random() * choices.length)];
  const octave = octaves[Math.floor(random() * octaves.length)];
  return { id, octave };
}

/** The frequency of a question's swar with Sa at `sa` Hz. */
export function swarHz(sa, { id, octave = 0 }) {
  return sa * swarById(id).ratio * 2 ** octave;
}

/** Streak multiplier: ×1, then one more for every 3 right in a row, up to ×4. */
export function multiplier(streak) {
  return Math.min(4, 1 + Math.floor(streak / 3));
}

/** Points for a right answer `seconds` after the swar began, with `streak` right before it. */
export function swarPoints(seconds, streak) {
  const speed = Math.round(50 * Math.max(0, Math.min(1, 1 - (seconds - 1) / 4)));
  return 100 * multiplier(streak) + speed;
}

/**
 * The swaras most often mistaken, for the results: [{ asked, answered, times }]
 * from a list of { asked, answered } mistakes, most frequent first.
 */
export function trickiest(mistakes, limit = 3) {
  const counts = new Map();
  for (const m of mistakes) {
    const key = `${m.asked}>${m.answered}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, times]) => {
    const [asked, answered] = key.split('>');
    return { asked, answered, times };
  });
}

// ── Sam Pakdo ────────────────────────────────────────────────────────
/**
 * Stages, unlocked in order. `taal` names a catalogue taal (the first
 * instrument that has it plays); `hide`: the taal wheel's hand disappears
 * after the first cycle, so you count the matras yourself; `speedUp`: the
 * tempo rises by that fraction every cycle.
 */
export const SAM_STAGES = [
  { id: 'teen-see', title: 'Teentaal', sub: 'Watch the hand, tap on sam', taal: 'Teentaal', bpm: 80, cycles: 6 },
  { id: 'teen-count', title: 'Teentaal · by ear', sub: 'The hand vanishes — count the 16 matras', taal: 'Teentaal', bpm: 90, cycles: 6, hide: true },
  { id: 'jhap', title: 'Jhaptaal', sub: '10 matras: 2 + 3 + 2 + 3', taal: 'Jhaptaal', bpm: 110, cycles: 8, hide: true },
  { id: 'roopak', title: 'Roopak', sub: '7 matras — and sam is khali', taal: 'Roopak', bpm: 100, cycles: 8, hide: true },
  { id: 'ek', title: 'Ektaal', sub: '12 matras at madhya laya', taal: 'Ektaal', bpm: 120, cycles: 8, hide: true },
  { id: 'drut', title: 'Teentaal · drut', sub: 'It speeds up every cycle', taal: 'Teentaal', bpm: 120, cycles: 8, hide: true, speedUp: 0.05 },
];

// Judging windows (seconds either side of sam)
export const WINDOWS = [
  { grade: 'Perfect', within: 0.045, points: 100 },
  { grade: 'Great', within: 0.09, points: 70 },
  { grade: 'Good', within: 0.15, points: 40 },
];
export const GOOD_WINDOW = WINDOWS[WINDOWS.length - 1].within;

/** Grade a tap `error` seconds from sam (negative = early): { grade, points } or null if outside every window. */
export function judgeTap(error) {
  const w = WINDOWS.find(x => Math.abs(error) <= x.within);
  return w ? { grade: w.grade, points: w.points } : null;
}

/** Combo bonus: +10% per sam in a row after the first, up to +50%. */
export function comboPoints(points, combo) {
  return Math.round(points * (1 + Math.min(0.5, 0.1 * Math.max(0, combo - 1))));
}

/** Stars for a round from its accuracy (0–1): 3 ≥ 85%, 2 ≥ 60%, 1 ≥ 30%. */
export function stars(accuracy) {
  return accuracy >= 0.85 ? 3 : accuracy >= 0.6 ? 2 : accuracy >= 0.3 ? 1 : 0;
}

/** Stage i is open when every stage before it has at least one star. */
export function stageUnlocked(i, starsById) {
  return SAM_STAGES.slice(0, i).every(s => (starsById[s.id] || 0) > 0);
}

/** "12 ms late" / "8 ms early" / "spot on". */
export function describeOffset(error) {
  const ms = Math.round(Math.abs(error) * 1000);
  if (ms < 5) return 'spot on';
  return `${ms} ms ${error < 0 ? 'early' : 'late'}`;
}
