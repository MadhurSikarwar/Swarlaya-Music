/**
 * What an account stores, and how a device's data and the cloud's are
 * brought together. Pure functions — no browser or Firebase APIs — so the
 * rules are unit-tested (tests/account.test.js).
 *
 * The cloud document (users/{uid}):
 *
 *   riyaz   { 'YYYY-MM-DD': { <deviceId>: seconds } }   practice per day, per device
 *   goal    { min, at }                                 daily goal and when it was chosen (ms)
 *   games   { swarBest, samStars: {…}, samBest: {…} }   as games/store.js keeps them
 *
 * Practice is kept per device, so each device only ever raises its own
 * number: two devices can sync in any order, any number of times, and a day
 * is never counted twice. A day's total is the sum over the devices.
 */
import { parseProgress } from '../games/store.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const seconds = x => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0);

/** Validate a cloud document (or null): anything unusable is dropped. */
export function parseCloud(doc) {
  const out = { riyaz: {}, goal: null, games: parseProgress(doc && doc.games) };
  if (!doc || typeof doc !== 'object') return out;
  if (doc.riyaz && typeof doc.riyaz === 'object') {
    for (const [day, devices] of Object.entries(doc.riyaz)) {
      if (!DAY.test(day) || !devices || typeof devices !== 'object') continue;
      const kept = {};
      for (const [device, secs] of Object.entries(devices)) if (seconds(secs)) kept[device] = seconds(secs);
      if (Object.keys(kept).length) out.riyaz[day] = kept;
    }
  }
  const g = doc.goal;
  if (g && Number.isFinite(g.min) && g.min >= 1 && g.min <= 600 && Number.isFinite(g.at) && g.at > 0) {
    out.goal = { min: Math.round(g.min), at: g.at };
  }
  return out;
}

/** The better of two game records, score by score. */
export function mergeProgress(a, b) {
  const x = parseProgress(a), y = parseProgress(b);
  const best = (p, q) => {
    const out = { ...p };
    for (const [id, v] of Object.entries(q)) out[id] = Math.max(out[id] || 0, v);
    return out;
  };
  return {
    swarBest: Math.max(x.swarBest, y.swarBest),
    samStars: best(x.samStars, y.samStars),
    samBest: best(x.samBest, y.samBest),
  };
}

const sameMap = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);
export function sameProgress(a, b) {
  return a.swarBest === b.swarBest && sameMap(a.samStars, b.samStars) && sameMap(a.samBest, b.samBest);
}

/**
 * Bring this device and the cloud together.
 *
 *   local  { riyaz: { day: seconds } (this device's own log), goal: { min, at }, games }
 *   cloud  the stored document, or null for a new account
 *
 * Returns
 *   patch    what to write to the cloud (merged in), or null if it is up to date
 *   others   { day: seconds } practised on the user's other devices — to add to this device's log
 *   goal     the goal to use here (goalChanged: it differs from the local one)
 *   games    the scores to keep here (gamesChanged: they improve on the local ones)
 */
export function mergeAccount(local, cloud, deviceId) {
  const remote = parseCloud(cloud);
  const patch = {};

  // Practice: raise this device's own entries; everything else is "elsewhere".
  const mine = {};
  for (const [day, secs] of Object.entries(local.riyaz)) {
    if (DAY.test(day) && seconds(secs) > (remote.riyaz[day]?.[deviceId] || 0)) mine[day] = { [deviceId]: seconds(secs) };
  }
  if (Object.keys(mine).length) patch.riyaz = mine;

  const others = {};
  for (const [day, devices] of Object.entries(remote.riyaz)) {
    let sum = 0;
    for (const [device, secs] of Object.entries(devices)) {
      // This device's own entry counts only for what its log has since lost
      sum += device === deviceId ? Math.max(0, secs - seconds(local.riyaz[day])) : secs;
    }
    if (sum > 0) others[day] = sum;
  }

  // Daily goal: whichever was chosen later.
  let goal = local.goal;
  if (remote.goal && remote.goal.at > local.goal.at) goal = remote.goal;
  else if (local.goal.at > (remote.goal ? remote.goal.at : 0)) patch.goal = { min: local.goal.min, at: local.goal.at };

  // Game scores: the best of both.
  const localGames = parseProgress(local.games);
  const games = mergeProgress(localGames, remote.games);
  if (!sameProgress(games, remote.games)) patch.games = games;

  return {
    patch: Object.keys(patch).length ? patch : null,
    others,
    goal,
    goalChanged: goal.min !== local.goal.min || goal.at !== local.goal.at,
    games,
    gamesChanged: !sameProgress(games, localGames),
  };
}

/** A short random id for this browser, e.g. "k3f9x2ab71qz". */
export function newDeviceId(random = Math.random) {
  let id = '';
  while (id.length < 12) id += Math.floor(random() * 36).toString(36);
  return id;
}
