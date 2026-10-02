// Offline pitch analysis (intonation report, song Sa), the Practise Along
// A–B loop, setup share links, the raag finder and the riyaz totals.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_SR, estimateSa, intonationReport, pitchTrack } from '../public/js/tuner/analysis.js';
import { abJump, setLoopPoint } from '../public/js/practice/song.js';
import { decodeShare, encodeShare, hashParam } from '../public/js/core/share.js';
import { CATALOGUE } from '../public/js/lehra/catalogue.js';
import { catalogueEntries, fold, pushRecent, searchEntries, toggleInList } from '../public/js/lehra/finder.js';
import { formatPractice, riyazTotals } from '../public/js/lehra/riyaz.js';

const SR = ANALYSIS_SR;
const NOTES = [['C', 130.81], ['C#', 138.59], ['D', 146.83], ['D#', 155.56], ['E', 164.81], ['F', 174.61],
  ['F#', 185.0], ['G', 196.0], ['G#', 207.65], ['A', 220.0], ['A#', 233.08], ['B', 246.94]];

/**
 * A sung line: notes [[hz, seconds]] with harmonics, a little vibrato, and
 * a 60 ms glide into each note — like a voice moving between swaras.
 */
function sing(notes) {
  const total = notes.reduce((s, [, d]) => s + d, 0);
  const x = new Float32Array(Math.round(total * SR));
  let i = 0, phase = 0, prev = notes[0][0];
  for (const [hz, dur] of notes) {
    const n = Math.round(dur * SR), glide = Math.round(0.06 * SR);
    for (let k = 0; k < n; k++, i++) {
      const target = hz === 0 ? 0 : hz;
      if (!target) { x[i] = 0; continue; }
      const f = (k < glide ? prev * Math.pow(target / prev, k / glide) : target) * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * i / SR));
      phase += 2 * Math.PI * f / SR;
      x[i] = 0.3 * Math.sin(phase) + 0.15 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase);
    }
    if (hz) prev = hz;
  }
  return x;
}

const JUST = { S: 1, R: 9 / 8, G: 5 / 4, M: 4 / 3, P: 3 / 2, D: 5 / 3, N: 15 / 8 };
const line = (sa, swaras, dur = 0.6, detune = {}) =>
  swaras.split(' ').map(s => [s === '-' ? 0 : sa * JUST[s[0]] * (s[1] === "'" ? 2 : 1) * 2 ** ((detune[s] || 0) / 1200), dur]);

test('pitch track follows a sung line', () => {
  const track = pitchTrack(sing(line(146.83, 'S R G P')), SR);
  const at = t => track.find(p => Math.abs(p.t - t) < 0.011).hz;
  for (const [t, hz] of [[0.3, 146.83], [0.9, 146.83 * 9 / 8], [1.5, 146.83 * 5 / 4], [2.1, 146.83 * 3 / 2]]) {
    assert.ok(Math.abs(1200 * Math.log2(at(t) / hz)) < 10, `${hz} Hz at ${t} s: got ${at(t)}`); // ±7 cents of vibrato
  }
});

test('intonation report: in-tune singing scores high, a flat Ga is caught', () => {
  const sa = 146.83;
  const good = intonationReport(pitchTrack(sing(line(sa, 'S R G M P D N S\' - S G P')), SR), sa);
  assert.ok(good.heldSec > 4, `held ${good.heldSec}`);
  assert.ok(good.inTune > 0.95, `in tune ${good.inTune}`);
  assert.ok(good.meanAbsCents < 6, `mean ${good.meanAbsCents}`);
  assert.equal(good.swaras[0].name, 'Sa', 'Sa is sung most');
  assert.ok(good.points.some(p => !p.held), 'the glides are not judged');

  const flat = intonationReport(pitchTrack(sing(line(sa, 'S G S G S G', 0.8, { G: -35 })), SR), sa);
  const ga = flat.swaras.find(s => s.name === 'Ga' && !s.qualifier);
  assert.ok(ga && ga.meanCents < -25, `Ga ${ga && ga.meanCents}`);
  assert.ok(flat.inTune < 0.65, `in tune ${flat.inTune}`);
});

test('song Sa: found from the vocals, whatever the key and tuning', () => {
  // A bandish-like line around Sa and Pa, in D, then in G# tuned 20 cents sharp
  const phrase = 'S R G - G M P - P D P M G R S - S N S R S - P - S\'';
  const d = estimateSa(pitchTrack(sing(line(146.83, phrase, 0.5)), SR), NOTES);
  assert.equal(NOTES[d.index][0], 'D');
  assert.ok(d.confidence > 0.35, `confidence ${d.confidence}`);
  const gs = estimateSa(pitchTrack(sing(line(207.65 * 2 ** (20 / 1200), phrase, 0.5)), SR), NOTES);
  assert.equal(NOTES[gs.index][0], 'G#');
  assert.ok(Math.abs(gs.tuningCents - 20) < 6, `tuning ${gs.tuningCents}`);
  assert.equal(estimateSa(pitchTrack(sing(line(146.83, 'S R', 0.5)), SR), NOTES), null, 'too little singing');
});

test('A–B loop: jump back at B, B after A', () => {
  assert.equal(abJump(0.5, null), null);
  assert.equal(abJump(0.5, { a: 0.2, b: null }), null, 'only A set');
  assert.equal(abJump(0.39, { a: 0.2, b: 0.4 }), null);
  assert.equal(abJump(0.4, { a: 0.2, b: 0.4 }), 0.2);
  assert.deepEqual(setLoopPoint(null, 'a', 0.3, 0.01), { a: 0.3, b: null });
  assert.deepEqual(setLoopPoint({ a: 0.3, b: null }, 'b', 0.5, 0.01), { a: 0.3, b: 0.5 });
  assert.equal(setLoopPoint({ a: 0.3, b: null }, 'b', 0.305, 0.01), null, 'too short');
  assert.deepEqual(setLoopPoint({ a: 0.3, b: 0.5 }, 'a', 0.6, 0.01), { a: 0.6, b: null }, 'A past B drops B');
  assert.deepEqual(setLoopPoint(null, 'b', 0.5, 0.01), { a: 0, b: 0.5 }, 'B alone loops from the start');
});

test('setup links round-trip, and the hash keeps each kind apart', async () => {
  const setup = { app: 'swaralaya-lehra', s: { v: 1, instrument: 'Sitar', taal: 'Ektaal (12 beats)', raag: 'Kedar', bpm: 72, controls: { metronomeToggle: true } } };
  const payload = await encodeShare(setup);
  assert.deepEqual(await decodeShare(payload), setup);
  assert.equal(hashParam(`#s=${payload}`, 's'), payload);
  assert.equal(hashParam(`#s=${payload}`, 'n'), null);
  assert.equal(hashParam('#n=abc&s=xyz_-1', 's'), 'xyz_-1');
});

test('raag finder: searches raag, instrument and taal together, whatever the spelling', () => {
  const entries = catalogueEntries(CATALOGUE);
  const raags = Object.values(CATALOGUE).flatMap(i => Object.values(i.taals)).reduce((n, t) => n + Object.keys(t.raags).length, 0);
  assert.equal(entries.length, raags, 'every raag is searchable');
  assert.equal(new Set(entries.map(e => e.key)).size, entries.length, 'keys are unique');
  const found = q => searchEntries(entries, q).map(e => `${e.raag} / ${e.instrument} / ${e.taalShort}`);

  assert.deepEqual(found('bageshri jhap'), ['Bageshree / Sarangi / Jhaptaal'], 'ee ↔ i, two words');
  assert.deepEqual(found('bhoopali'), ['Bhupali / Sarangi / Teentaal'], 'oo ↔ u');
  assert.ok(found('madhuvanti').includes('Madhuwanti / Esraj / Teentaal'), 'w ↔ v');
  assert.deepEqual(found('ek taal'), found('ektaal'), 'a taal typed as two words');
  assert.ok(found('tintal sitar').length > 0 && found('tintal sitar').every(r => r.endsWith('/ Sitar / Teentaal')));
  // Raags that start with the word come before those that merely contain it
  const ke = found('ke');
  assert.ok(ke[0].startsWith('Kedar') && ke.indexOf(ke.find(r => r.startsWith('Charukeshi'))) > ke.lastIndexOf(ke.findLast(r => r.startsWith('Kedar'))));
  assert.equal(searchEntries(entries, 'sarangi', 3).length, 3, 'limited');
  assert.deepEqual(found('zzz'), []);
  assert.deepEqual(found('   '), [], 'nothing typed, nothing listed');
  assert.equal(fold('Teentaal (16 beats)'), 'tintal 16 beats');
});

test('favourites toggle and recents stay short, newest first', () => {
  assert.deepEqual(toggleInList(['a', 'b'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(toggleInList(['a', 'b', 'c'], 'b'), ['a', 'c'], 'starring again removes it');
  assert.deepEqual(toggleInList(['a', 'b'], 'c', 2), ['c', 'a'], 'capped');
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'], 'moved to the front, not repeated');
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
});

test('riyaz totals: all-time practice from the per-day log', () => {
  assert.deepEqual(riyazTotals([
    ['lehra_riyaz_2026-09-30', '600'], ['lehra_riyaz_2026-10-01', '1250'], ['lehra_riyaz_2026-10-02', '0'],
    ['lehra_riyaz_goal_min', '20'], ['lehra_settings_v1', '{}'], ['lehra_riyaz_2026-10-03', 'junk'],
  ]), { total: 1850, days: 2 });
  assert.deepEqual(riyazTotals([]), { total: 0, days: 0 });
  assert.deepEqual([0, 21, 59, 60, 150, 3540, 3600, 4500].map(formatPractice),
    ['0 s', '21 s', '59 s', '1 min', '3 min', '59 min', '1 h', '1 h 15 min']);
});
