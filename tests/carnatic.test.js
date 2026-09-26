// Carnatic talas: angas, kriyas and lengths.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JATIS, KATTAI, SULADI, TALAS, kriyaLabel, talaStructure } from '../public/js/carnatic/talas.js';

const kriyas = def => talaStructure(def).beats.map(b => (b.kind === 'finger' ? b.finger : b.kind));

test('Adi, Rupaka and Tisra Triputa: laghu, drutam kriyas', () => {
  assert.deepEqual(kriyas(TALAS.adi), ['clap', 'little', 'ring', 'middle', 'clap', 'wave', 'clap', 'wave']);
  assert.equal(talaStructure(TALAS.adi).notation, 'I₄ O O');
  assert.deepEqual(kriyas(TALAS.rupaka), ['clap', 'wave', 'clap', 'little', 'ring', 'middle']);
  assert.deepEqual(kriyas(TALAS.tisraTriputa), ['clap', 'little', 'ring', 'clap', 'wave', 'clap', 'wave']);
  assert.deepEqual(kriyas(TALAS.misraJhampa), ['clap', 'little', 'ring', 'middle', 'index', 'thumb', 'little', 'clap', 'clap', 'wave']);
  assert.equal(talaStructure(TALAS.misraJhampa).notation, 'I₇ U O');
});

test('Chapu talas: claps on the first beat of each group', () => {
  assert.deepEqual(kriyas(TALAS.misraChapu), ['clap', 'count', 'count', 'clap', 'count', 'clap', 'count']);
  assert.deepEqual(kriyas(TALAS.khandaChapu), ['clap', 'count', 'clap', 'count', 'count']);
  assert.equal(talaStructure(TALAS.misraChapu).notation, '3+2+2');
});

test('all 35 suladi talas have the right number of aksharas', () => {
  const len = { I: n => n, O: () => 2, U: () => 1 };
  for (const [family, angas] of Object.entries(SULADI)) {
    for (const [jati, n] of Object.entries(JATIS)) {
      const s = talaStructure({ family, jati });
      assert.equal(s.beats.length, angas.reduce((t, a) => t + len[a](n), 0), `${jati} ${family}`);
      assert.equal(s.angas.length, angas.length);
      assert.ok(s.angas.every(a => s.beats[a.start].kind === 'clap' && s.beats[a.start].first), 'every anga starts with a clap');
    }
  }
  assert.equal(talaStructure(TALAS.khandaAta).beats.length, 14);
  assert.equal(talaStructure({ family: 'eka', jati: 'sankeerna' }).name, 'Sankeerna jati Eka');
  assert.deepEqual(kriyas({ family: 'eka', jati: 'sankeerna' }),
    ['clap', 'little', 'ring', 'middle', 'index', 'thumb', 'little', 'ring', 'middle']);
});

test('2-kalai holds every akshara for a second count', () => {
  const s = talaStructure(TALAS.adi, 2);
  assert.equal(s.beats.length, 16);
  assert.deepEqual(s.beats.slice(0, 4).map(b => b.kind), ['clap', 'hold', 'finger', 'hold']);
  assert.deepEqual(s.angas.map(a => [a.start, a.length]), [[0, 8], [8, 4], [12, 4]]);
});

test('kriya labels and shruti table', () => {
  assert.deepEqual(talaStructure(TALAS.adi).beats.slice(0, 5).map(kriyaLabel), ['Clap', 'Little finger', 'Ring finger', 'Middle finger', 'Clap']);
  assert.equal(kriyaLabel({ kind: 'finger', finger: 'thumb' }), 'Thumb');
  assert.equal(KATTAI.length, 12);
  for (let i = 1; i < KATTAI.length; i++) {
    assert.ok(Math.abs(1200 * Math.log2(KATTAI[i][2] / KATTAI[i - 1][2]) - 100) < 0.5, 'semitone steps');
  }
});
