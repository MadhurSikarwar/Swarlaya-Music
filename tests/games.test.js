// Riyaz games: levels, questions, scoring, tap judging, stages and saved
// progress.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECT_PER_LEVEL, SAM_STAGES, SWARAS, SWAR_LEVELS, comboPoints, describeOffset, judgeTap, multiplier,
  nextQuestion, stageUnlocked, stars, swarHz, swarLevel, swarPoints, trickiest,
} from '../public/js/games/rules.js';
import { parseProgress } from '../public/js/games/store.js';
import { lehraFor } from '../public/js/games/sam-game.js';
import { CATALOGUE } from '../public/js/lehra/catalogue.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('swar table: 12 positions in rising order, levels only use real swaras', () => {
  assert.equal(SWARAS.length, 12);
  for (let i = 1; i < 12; i++) assert.ok(SWARAS[i].ratio > SWARAS[i - 1].ratio);
  const ids = new Set(SWARAS.map(s => s.id));
  for (const level of SWAR_LEVELS) for (const id of level.pool) assert.ok(ids.has(id), id);
  assert.ok(SWAR_LEVELS.every((l, i) => i === 0 || l.pool.length >= SWAR_LEVELS[i - 1].pool.length), 'levels only grow');
});

test('levels rise every few right answers and stop at the last', () => {
  assert.equal(swarLevel(0), 0);
  assert.equal(swarLevel(CORRECT_PER_LEVEL - 1), 0);
  assert.equal(swarLevel(CORRECT_PER_LEVEL), 1);
  assert.equal(swarLevel(1000), SWAR_LEVELS.length - 1);
});

test('questions come from the level pool and never repeat twice in a row', () => {
  const random = seeded(7);
  for (let level = 0; level < SWAR_LEVELS.length; level++) {
    let prev = null;
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const q = nextQuestion(level, prev, random);
      assert.ok(SWAR_LEVELS[level].pool.includes(q.id));
      assert.notEqual(q.id, prev);
      assert.ok((SWAR_LEVELS[level].octaves || [0]).includes(q.octave));
      seen.add(q.id);
      prev = q.id;
    }
    assert.equal(seen.size, SWAR_LEVELS[level].pool.length, `every swar of level ${level} comes up`);
  }
});

test('swar pitches: just ratios over Sa, across octaves', () => {
  assert.equal(swarHz(146.83, { id: 'S' }), 146.83);
  assert.ok(Math.abs(swarHz(146.83, { id: 'P' }) - 220.245) < 1e-9);
  assert.ok(Math.abs(swarHz(200, { id: 'G', octave: -1 }) - 125) < 1e-9);
  assert.ok(Math.abs(swarHz(200, { id: 'S', octave: 1 }) - 400) < 1e-9);
});

test('swar scoring: streak multiplier and a speed bonus', () => {
  assert.deepEqual([0, 2, 3, 6, 9, 30].map(multiplier), [1, 1, 2, 3, 4, 4]);
  assert.equal(swarPoints(0.5, 0), 150, 'quick answer: full bonus');
  assert.equal(swarPoints(5, 0), 100, 'slow answer: no bonus');
  assert.equal(swarPoints(3, 0), 125);
  assert.equal(swarPoints(0.5, 9), 450);
  const t = trickiest([{ asked: 'g', answered: 'G' }, { asked: 'R', answered: 'r' }, { asked: 'g', answered: 'G' }]);
  assert.deepEqual(t[0], { asked: 'g', answered: 'G', times: 2 });
  assert.equal(t.length, 2);
});

test('tap judging: windows, combo bonus and stars', () => {
  assert.equal(judgeTap(0.01).grade, 'Perfect');
  assert.equal(judgeTap(-0.045).grade, 'Perfect');
  assert.equal(judgeTap(0.07).grade, 'Great');
  assert.equal(judgeTap(-0.12).grade, 'Good');
  assert.equal(judgeTap(0.2), null);
  assert.deepEqual([1, 2, 5, 20].map(c => comboPoints(100, c)), [100, 110, 140, 150]);
  assert.deepEqual([1, 0.85, 0.7, 0.3, 0.1].map(stars), [3, 3, 2, 1, 0]);
  assert.equal(describeOffset(0.002), 'spot on');
  assert.equal(describeOffset(-0.0184), '18 ms early');
  assert.equal(describeOffset(0.031), '31 ms late');
});

test('stages unlock in order, and every one has a playable lehra', () => {
  assert.ok(stageUnlocked(0, {}));
  assert.ok(!stageUnlocked(1, {}));
  assert.ok(stageUnlocked(1, { 'teen-see': 1 }));
  assert.ok(!stageUnlocked(3, { 'teen-see': 3, 'teen-count': 2 }));
  assert.equal(new Set(SAM_STAGES.map(s => s.id)).size, SAM_STAGES.length, 'unique ids');
  for (const stage of SAM_STAGES) {
    const l = lehraFor(stage, () => 0);
    assert.ok(l, `${stage.id} has a lehra`);
    assert.ok(l.taalName.startsWith(stage.taal));
    assert.equal(l.taal.cycles || 1, 1, 'one cycle per loop');
    assert.ok(stage.bpm >= l.taal.minTempo && stage.bpm <= l.taal.maxTempo, `${stage.id} tempo in range`);
    assert.ok(CATALOGUE[l.instrument].taals[l.taalName].raags[l.raag]);
  }
  const roopak = lehraFor(SAM_STAGES.find(s => s.taal === 'Roopak'), () => 0).taal;
  assert.ok(roopak.khali.includes(1), 'Roopak: sam is khali');
});

test('saved progress is validated', () => {
  assert.deepEqual(parseProgress(null), { swarBest: 0, samStars: {}, samBest: {} });
  assert.deepEqual(parseProgress('{bad json'), { swarBest: 0, samStars: {}, samBest: {} });
  const p = parseProgress(JSON.stringify({
    swarBest: 1234, samStars: { 'teen-see': 3, x: 9, y: -1, z: 'a' }, samBest: { 'teen-see': 800 }, junk: 1,
  }));
  assert.deepEqual(p, { swarBest: 1234, samStars: { 'teen-see': 3, x: 3 }, samBest: { 'teen-see': 800 } });
});
