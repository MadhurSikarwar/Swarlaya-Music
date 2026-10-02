// Notation Editor: composition files / links, the synthesized tabla's bol
// mapping and the sung swaras' pitches.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeShare, deserialize, encodeShare, serialize, shareFromHash, upsertEntry } from '../public/js/notation/library.js';
import { bolStrokes, drumPitches } from '../public/js/notation/synth.js';
import { matrasPerLine, swarFrequency } from '../public/js/notation/notation.js';

const TAALS = { 16: 16, 7: 7, '14_deep': 14 };
const cell = (content, modifier = null) => ({ content, modifier });
const doc = {
  title: 'Kaida in Teentaal', mode: 'tabla', system: 'bhatkhande', language: 'en', taal: '16',
  lines: [Array.from({ length: 16 }, (_, i) => cell(i % 4 ? 'Ti Ta' : 'Dha', i === 3 ? 'underline' : null))],
};

test('compositions survive the file/link format unchanged', () => {
  const back = deserialize(JSON.parse(JSON.stringify(serialize(doc))), TAALS);
  assert.equal(back.title, doc.title);
  assert.equal(back.taal, '16');
  assert.deepEqual(back.lines[0].map(c => [c.content, c.modifier]), doc.lines[0].map(c => [c.content, c.modifier]));
  assert.equal(back.lines[0][5].matra, 6);
});

test('imported compositions are validated and normalised', () => {
  assert.throws(() => deserialize({ hello: 1 }, TAALS), /Not a Swaralaya composition/);
  assert.throws(() => deserialize({ ...serialize(doc), v: 99 }, TAALS), /newer version/);
  assert.throws(() => deserialize({ ...serialize(doc), taal: '11' }, TAALS), /Unknown taal/);
  const odd = deserialize({
    ...serialize(doc), taal: '7', mode: 'guitar', lines: [['Tin', ['Na', 'bogus'], 42, 'x'.repeat(500), ['Dhi', 'dot-above'], 'Na', 'Na', 'extra', 'extra']],
  }, TAALS);
  assert.equal(odd.mode, 'tabla');
  assert.equal(odd.lines[0].length, 7, 'cut to the taal');
  assert.deepEqual(odd.lines[0].slice(0, 5).map(c => [c.content.length > 10 ? c.content.length : c.content, c.modifier]),
    [['Tin', null], ['Na', null], ['-', null], [200, null], ['Dhi', 'dot-above']]);
  const short = deserialize({ ...serialize(doc), lines: [['Dha']] }, TAALS);
  assert.equal(short.lines[0].length, 16, 'padded with rests');
  assert.equal(short.lines[0][15].content, '-');
});

test('share links: compressed round trip, fallback format, hash parsing', async () => {
  const obj = serialize(doc);
  const z = await encodeShare(obj);
  assert.equal(z[0], 'z');
  assert.match(z, /^[A-Za-z0-9_-]+$/, 'URL-safe');
  assert.ok(z.length < JSON.stringify(obj).length, 'smaller than the JSON');
  assert.deepEqual(await decodeShare(z), obj);
  const plain = 'j' + Buffer.from(JSON.stringify(obj)).toString('base64url');
  assert.deepEqual(await decodeShare(plain), obj);
  assert.equal(shareFromHash(`#n=${z}`), z);
  assert.equal(shareFromHash('#other=1&n=abc_-9'), 'abc_-9');
  assert.equal(shareFromHash('#nothing'), null);
  await assert.rejects(decodeShare('q123'), /Unrecognised link/);
});

test('library: saving a name again replaces it, newest first', () => {
  let list = upsertEntry([], 'A', { x: 1 }, 1);
  list = upsertEntry(list, 'B', { x: 2 }, 2);
  list = upsertEntry(list, 'A', { x: 3 }, 3);
  assert.deepEqual(list.map(e => [e.name, e.doc.x]), [['A', 3], ['B', 2]]);
});

test('tabla bols map to dayan/bayan strokes', () => {
  assert.deepEqual(bolStrokes('Dha'), [['na', 'ge']]);
  assert.deepEqual(bolStrokes('Dhin'), [['tin', 'ge']]);
  assert.deepEqual(bolStrokes('TiRaKiTa'), [['ti'], ['ti'], ['ke'], ['ta']]);
  assert.deepEqual(bolStrokes('Tirakita'), bolStrokes('Trkt'));
  assert.deepEqual(bolStrokes('Kat'), [['ke']]);
  assert.deepEqual(bolStrokes('DhaGe'), [['na', 'ge'], ['ge']]);
  assert.deepEqual(bolStrokes('-'), []);
  assert.deepEqual(bolStrokes('ऽ'), []);
  assert.deepEqual(bolStrokes('Xyz'), [['ti']], 'unknown bols still keep the rhythm');
  const { dayan, bayan } = drumPitches(146.83);
  assert.ok(Math.abs(dayan - 293.66) < 0.01, 'dayan on Sa, an octave up');
  assert.ok(Math.abs(bayan - 97.89) < 0.01, 'bayan on the Pa below');
  for (const sa of [87.31, 110, 207.65]) {
    const p = drumPitches(sa);
    assert.ok(p.dayan >= 220 && p.dayan < 440 && p.bayan >= 70 && p.bayan < 140, `Sa ${sa}`);
  }
});

test('sung swaras: just ratios, komal/tivra, saptak, lyrics silent', () => {
  const sa = 146.83;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(near(swarFrequency('Sa', null, sa), sa));
  assert.ok(near(swarFrequency('P', null, sa), sa * 3 / 2));
  assert.ok(near(swarFrequency('R', 'underline', sa), sa * 16 / 15), 'komal re');
  assert.ok(near(swarFrequency('M', 'vertical', sa), sa * 45 / 32), 'tivra ma');
  assert.ok(near(swarFrequency('P', 'underline', sa), sa * 3 / 2), 'Pa has no komal');
  assert.ok(near(swarFrequency('Ṡ', 'dot-above', sa), sa * 2));
  assert.ok(near(swarFrequency('Ṡ', null, sa), sa * 2), 'a dotted letter alone sets the saptak');
  assert.ok(near(swarFrequency('Ṇ', 'dot-below', sa), sa * 15 / 16), 'mandra Ni (was Sa)');
  assert.ok(near(swarFrequency('सा', null, sa), sa));
  assert.ok(near(swarFrequency('नि', null, sa), sa * 15 / 8));
  assert.equal(swarFrequency('Jaa', null, sa), null);
  assert.equal(swarFrequency('Pyaare', null, sa), null);
});

test('narrow screens wrap a notation line at vibhag boundaries, evenly', () => {
  assert.equal(matrasPerLine([4, 4, 4, 4], 20), 16, 'fits: one line');
  assert.equal(matrasPerLine([4, 4, 4, 4], 14), 8, 'Teentaal: 8 + 8, not 12 + 4');
  assert.equal(matrasPerLine([4, 4, 4, 4], 6), 4);
  assert.equal(matrasPerLine([2, 3, 2, 3], 7), 5, 'Jhaptaal: 2+3 | 2+3');
  assert.equal(matrasPerLine([5, 2, 3, 4], 8), 7, 'Dhamar: 5+2 | 3+4');
  assert.equal(matrasPerLine([3, 2, 2], 5), 4, 'Rupak: 3 | 2+2');
  assert.equal(matrasPerLine([4, 4, 4, 4], 3), 4, 'a vibhag is never split');
});
