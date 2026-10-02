// Accounts: how a device's practice and scores are merged with the cloud's
// (public/js/account/sync.js), and that the guided tours point at real
// parts of the page.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeAccount, mergeProgress, newDeviceId, parseCloud } from '../public/js/account/sync.js';
import { FIREBASE_SDK } from '../public/js/account/config.js';
import { ROUTES } from '../public/js/core/routes.js';

const noGames = { swarBest: 0, samStars: {}, samBest: {} };
const goal = (min = 15, at = 0) => ({ min, at });
const local = (riyaz, extra = {}) => ({ riyaz, goal: goal(), games: noGames, ...extra });

test('a new account: everything on the device goes up, nothing comes down', () => {
  const m = mergeAccount(local({ '2026-10-01': 600, '2026-10-02': 300 }, {
    goal: goal(20, 1000), games: { swarBest: 90, samStars: { teentaal: 2 }, samBest: { teentaal: 410 } },
  }), null, 'phone');
  assert.deepEqual(m.patch, {
    riyaz: { '2026-10-01': { phone: 600 }, '2026-10-02': { phone: 300 } },
    goal: { min: 20, at: 1000 },
    games: { swarBest: 90, samStars: { teentaal: 2 }, samBest: { teentaal: 410 } },
  });
  assert.deepEqual(m.others, {});
  assert.equal(m.goalChanged, false);
  assert.equal(m.gamesChanged, false);
});

test('two devices: each raises only its own entry, and a day is the sum of both', () => {
  const cloud = { riyaz: { '2026-10-02': { phone: 300, laptop: 900 }, '2026-10-01': { laptop: 120 } } };
  const m = mergeAccount(local({ '2026-10-02': 450 }), cloud, 'phone');
  assert.deepEqual(m.patch, { riyaz: { '2026-10-02': { phone: 450 } } }, 'only what this device added');
  assert.deepEqual(m.others, { '2026-10-02': 900, '2026-10-01': 120 }, 'the laptop’s practice');

  // Syncing again changes nothing: it is safe to repeat, in any order
  const after = { riyaz: { '2026-10-02': { phone: 450, laptop: 900 }, '2026-10-01': { laptop: 120 } } };
  const again = mergeAccount(local({ '2026-10-02': 450 }), after, 'phone');
  assert.equal(again.patch, null);
  assert.deepEqual(again.others, m.others);
});

test('a device whose log was cleared gets its history back, without counting it twice', () => {
  const cloud = { riyaz: { '2026-09-30': { phone: 1200 }, '2026-10-02': { phone: 500 } } };
  const fresh = mergeAccount(local({ '2026-10-02': 200 }), cloud, 'phone');
  assert.equal(fresh.patch, null, 'the cloud already has more for this device');
  assert.deepEqual(fresh.others, { '2026-09-30': 1200, '2026-10-02': 300 }, '200 here + 300 = the 500 it had');
});

test('daily goal: the later choice wins, either way', () => {
  const cloud = { goal: { min: 30, at: 5000 } };
  const older = mergeAccount(local({}, { goal: goal(20, 1000) }), cloud, 'a');
  assert.deepEqual(older.goal, { min: 30, at: 5000 });
  assert.equal(older.goalChanged, true);
  assert.equal(older.patch, null);

  const newer = mergeAccount(local({}, { goal: goal(45, 9000) }), cloud, 'a');
  assert.equal(newer.goalChanged, false);
  assert.deepEqual(newer.patch, { goal: { min: 45, at: 9000 } });

  const untouched = mergeAccount(local({}), null, 'a');
  assert.equal(untouched.patch, null, 'a goal nobody chose is not uploaded');
});

test('game scores: the best of both, score by score', () => {
  const here = { swarBest: 120, samStars: { teentaal: 3, jhaptaal: 1 }, samBest: { teentaal: 500 } };
  const there = { swarBest: 80, samStars: { teentaal: 2, ektaal: 3 }, samBest: { teentaal: 640, ektaal: 300 } };
  const best = { swarBest: 120, samStars: { teentaal: 3, jhaptaal: 1, ektaal: 3 }, samBest: { teentaal: 640, ektaal: 300 } };
  assert.deepEqual(mergeProgress(here, there), best);
  const m = mergeAccount(local({}, { games: here }), { games: there }, 'a');
  assert.deepEqual(m.games, best);
  assert.equal(m.gamesChanged, true, 'the other device’s scores arrive here');
  assert.deepEqual(m.patch, { games: best });
  assert.equal(mergeAccount(local({}, { games: best }), { games: best }, 'a').patch, null);
});

test('a damaged cloud document is read as far as it makes sense', () => {
  const c = parseCloud({
    riyaz: { '2026-10-02': { a: 60, b: -5, c: 'x' }, 'not-a-day': { a: 9 }, '2026-10-03': 7, '2026-10-04': {} },
    goal: { min: 0, at: 5 }, games: 'nope',
  });
  assert.deepEqual(c.riyaz, { '2026-10-02': { a: 60 } });
  assert.equal(c.goal, null);
  assert.deepEqual(c.games, noGames);
  assert.deepEqual(parseCloud(null), { riyaz: {}, goal: null, games: noGames });
});

test('device ids, the SDK address and the account page', () => {
  const id = newDeviceId();
  assert.match(id, /^[0-9a-z]{12,}$/);
  assert.notEqual(id, newDeviceId());
  assert.match(FIREBASE_SDK, /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+$/, 'a pinned version');
  assert.equal(ROUTES.find(r => r.path === '/account').index, false, 'personal pages stay out of search results');
});

test('guided tours point at parts of the page that exist', async () => {
  // tour.js touches the DOM only inside its functions, so its step table can be read here
  const { TOURS } = await import('../public/js/core/tour.js');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const views = ROUTES.map(r => r.view);
  for (const [view, steps] of Object.entries(TOURS)) {
    assert.ok(views.includes(view), `${view} is a page`);
    assert.ok(steps.length >= 2, `${view} has a tour worth taking`);
    for (const [selector, title, text] of steps) {
      assert.ok(title && text.length > 20, `${view} ${selector}: says something`);
      // every #id and .class the selector names appears in the page
      for (const [, kind, name] of selector.matchAll(/([#.])([\w-]+)/g)) {
        const found = kind === '#' ? html.includes(`id="${name}"`) : new RegExp(`class="[^"]*\\b${name}\\b`).test(html);
        assert.ok(found, `${view}: ${kind}${name} is on the page`);
      }
    }
  }
});
