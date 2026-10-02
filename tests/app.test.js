// Tests for browser-side helpers that don't need a DOM.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { localDateKey, riyazStreak } from '../public/js/lehra/riyaz.js';
import { CATALOGUE } from '../public/js/lehra/catalogue.js';
import { layaTempo } from '../public/js/lehra/laya.js';
import { attackOffset } from '../public/js/lehra/metronome.js';
import { extensionFor, pickMimeType, syncDelay, takeFileName } from '../public/js/lehra/recorder.js';
import { matraRole, taalCycle, thekaMatras, thekaVibhags, vibhagMarkers } from '../public/js/lehra/theka.js';
import { parseSettings, upsertPreset, removePreset, presetSummary, SETTINGS_VERSION } from '../public/js/lehra/settings.js';

test('riyaz is logged against the local calendar day', () => {
  assert.equal(localDateKey(new Date(2026, 8, 26, 1, 30)), '2026-09-26');
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('metronome clicks skip their leading encoder silence', () => {
  const sr = 44100;
  const x = new Float32Array(4000);
  for (let i = 1640; i < 1800; i++) x[i] = Math.sin(i) * 0.8;
  const off = attackOffset(x, sr);
  assert.ok(off * sr <= 1640 && off * sr >= 1640 - 0.001 * sr, `offset ${off * sr} samples`);
  assert.equal(attackOffset(new Float32Array(10), sr), 0);
});

test('recorder: container choice, file names, lehra sync delay', () => {
  assert.equal(pickMimeType(t => t.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(pickMimeType(t => t === 'audio/mp4'), 'audio/mp4', 'Safari');
  assert.equal(pickMimeType(() => false), '');
  assert.equal(pickMimeType(() => { throw new Error('old browser'); }), '');
  assert.deepEqual(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].map(extensionFor), ['webm', 'ogg', 'm4a']);
  assert.equal(takeFileName(new Date(2026, 8, 26, 7, 5), 'Misra Tilang', 'webm'), 'riyaz-2026-09-26-0705-Misra-Tilang.webm');
  assert.equal(takeFileName(new Date(2026, 0, 2, 23, 59), null, 'm4a'), 'riyaz-2026-01-02-2359.m4a');
  assert.ok(Math.abs(syncDelay({ output: 0.05, input: 0.012, mediaElement: false }) - 0.062) < 1e-9);
  assert.ok(Math.abs(syncDelay({ output: 0.05, input: undefined, mediaElement: true }) - 0.075) < 1e-9);
  assert.equal(syncDelay({ output: 3, input: 1 }), 0.5, 'capped');
});

test('riyaz streak: consecutive days meeting the goal; today counts once met', () => {
  const log = { '2026-09-20': 1200, '2026-09-21': 900, '2026-09-22': 1500, '2026-09-23': 300, '2026-09-24': 900, '2026-09-25': 1000 };
  const secs = d => log[localDateKey(d)] || 0;
  const today = new Date(2026, 8, 26, 9, 0);
  assert.equal(riyazStreak(secs, 900, today), 2, 'today not yet met: 24th and 25th');
  log['2026-09-26'] = 950;
  assert.equal(riyazStreak(secs, 900, today), 3);
  assert.equal(riyazStreak(secs, 60, today), 7);
  assert.equal(riyazStreak(() => 0, 900, today), 0);
});

test('catalogue entries are consistent and their audio files exist', () => {
  for (const [instrument, inst] of Object.entries(CATALOGUE)) {
    assert.ok(inst.tuningCoeff > 0, instrument);
    for (const [name, taal] of Object.entries(inst.taals)) {
      const where = `${instrument} / ${name}`;
      assert.ok(taal.beats > 0 && taal.tempos.length > 0, where);
      assert.ok(taal.minTempo < taal.maxTempo, where);
      assert.deepEqual([...taal.tempos].sort((a, b) => a - b), taal.tempos, `${where}: tempos in file order`);
      for (const raag of Object.values(taal.raags)) {
        const path = new URL(`../assets/${raag.file}.aac`, import.meta.url);
        assert.doesNotThrow(() => readFileSync(path), `${where}: missing ${raag.file}.aac`);
      }
    }
  }
});

test('thekas: one bol per matra, vibhags start on sam/taali/khali', () => {
  const rare = /^(Jai|Matta|Rudra|Neel|Sunand|Sardha Roopak|Pancham Sawari)\b/;
  for (const [instrument, inst] of Object.entries(CATALOGUE)) {
    for (const [name, taal] of Object.entries(inst.taals)) {
      const where = `${instrument} / ${name}`;
      if (rare.test(name)) { assert.equal(taal.theka, undefined, `${where}: no guessed theka`); continue; }
      assert.ok(taal.theka, `${where}: has a theka`);
      const cycleLen = taal.beats / (taal.cycles || 1);
      const vibhags = thekaVibhags(taal);
      assert.equal(vibhags.flat().length, cycleLen, `${where}: bols per cycle`);
      const starts = [1, ...(taal.taali || []), ...(taal.khali || [])];
      let m = 1;
      const vibhagStarts = vibhags.map(v => { const s = m; m += v.length; return s; });
      assert.deepEqual(vibhagStarts, [...new Set(starts)].sort((a, b) => a - b), `${where}: vibhag starts`);
      assert.equal(thekaMatras(taal).length, taal.beats, `${where}: whole loop`);
    }
  }
});

test('vibhag markers and matra roles (incl. a two-cycle loop)', () => {
  const teen = CATALOGUE.Sarangi.taals['Teentaal (16 beats)'];
  assert.deepEqual([...vibhagMarkers(teen)], [[1, 'X'], [5, '2'], [9, '0'], [13, '3']]);
  const roopak = CATALOGUE.Esraj.taals['Roopak Taal (7 beats)'];
  assert.deepEqual([...vibhagMarkers(roopak)], [[1, '0'], [4, '1'], [6, '2']]);
  const double = CATALOGUE.Esraj.taals['Roopak Double Cycle (14 beats)'];
  assert.deepEqual([1, 4, 6, 8, 11, 13, 14].map(m => matraRole(double, m)),
    ['sam', 'taali', 'taali', 'sam', 'taali', 'taali', null]);
  const loop = thekaMatras(double);
  assert.deepEqual(loop.filter(m => m.marker).map(m => `${m.matra}${m.marker}`), ['10', '41', '62', '80', '111', '132']);
  assert.equal(loop[7].bol, 'Tin');
});

test('taal circle: one avartan with roles, vibhag markers and bols', () => {
  const teen = taalCycle(CATALOGUE.Sarangi.taals['Teentaal (16 beats)']);
  assert.equal(teen.length, 16);
  assert.equal(teen.matras.length, 16);
  assert.deepEqual(teen.matras.filter(m => m.marker).map(m => `${m.matra}${m.marker}`), ['1X', '52', '90', '133']);
  assert.deepEqual([1, 2, 5, 9, 13].map(m => teen.matras[m - 1].role), ['sam', null, 'taali', 'khali', 'taali']);
  assert.deepEqual(teen.matras.slice(0, 4).map(m => m.bol), ['Dha', 'Dhin', 'Dhin', 'Dha']);

  // A two-cycle loop is drawn as ONE avartan: 14 loop beats → 7 matras
  const double = taalCycle(CATALOGUE.Esraj.taals['Roopak Double Cycle (14 beats)']);
  assert.equal(double.length, 7);
  assert.deepEqual(double.matras.filter(m => m.marker).map(m => `${m.matra}${m.marker}`), ['10', '41', '62']);
  assert.equal(double.matras[0].role, 'sam', 'sam even though it is khali in Roopak');
  assert.equal(double.matras[0].bol, 'Tin');

  // No theka, no taali/khali: just numbered matras from sam
  const rare = taalCycle(CATALOGUE.Sitar.taals['Sunand Taal (19 beats)']);
  assert.equal(rare.length, 19);
  assert.ok(rare.matras.every(m => m.bol === ''));
  assert.deepEqual(rare.matras.filter(m => m.marker).map(m => `${m.matra}${m.marker}`), ['1X']);
});

test('laya trainer ramps every N cycles and stops at the target', () => {
  const up = { start: 60, target: 72, step: 5, every: 2 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 40].map(c => layaTempo(up, c)), [60, 60, 65, 65, 70, 70, 72, 72]);
  const down = { start: 120, target: 100, step: 8, every: 1 };
  assert.deepEqual([-1, 0, 1, 2, 3].map(c => layaTempo(down, c)), [120, 120, 112, 104, 100]);
});

test('saved settings: validated field by field, other versions ignored', () => {
  const good = {
    v: SETTINGS_VERSION, instrument: 'Sarangi', taal: 'Teentaal (16 beats)', raag: 'Desh', bpm: 90,
    pitchHz: 150.2, pitchPreset: '146.83', loop: false,
    controls: { lehraVol: '70', metronomeToggle: true, bogus: { x: 1 } },
  };
  const s = parseSettings(JSON.stringify(good));
  assert.equal(s.raag, 'Desh');
  assert.equal(s.pitchHz, 150.2);
  assert.equal(s.loop, false);
  assert.deepEqual(s.controls, { lehraVol: '70', metronomeToggle: true });

  assert.equal(parseSettings('{not json'), null);
  assert.equal(parseSettings({ ...good, v: SETTINGS_VERSION + 1 }), null);
  const bad = parseSettings({ ...good, bpm: -5, pitchHz: 9000, instrument: 42, loop: 'yes' });
  assert.equal(bad.bpm, null);
  assert.equal(bad.pitchHz, null, 'outside the fine-tune range');
  assert.equal(bad.instrument, null);
  assert.equal(bad.loop, null);
});

test('presets: save replaces by name, delete, summary', () => {
  const a = parseSettings({ v: SETTINGS_VERSION, instrument: 'Esraj', taal: 'Teentaal (16 beats)', raag: 'Sohini', bpm: 120, pitchHz: 146.83 });
  const b = parseSettings({ v: SETTINGS_VERSION, instrument: 'Sitar', bpm: 60 });
  let list = upsertPreset([], 'Morning', a);
  list = upsertPreset(list, 'Evening', b);
  list = upsertPreset(list, 'Morning', b);
  assert.deepEqual(list.map(p => p.name), ['Evening', 'Morning']);
  assert.equal(list[1].settings.instrument, 'Sitar');
  assert.deepEqual(removePreset(list, 'Evening').map(p => p.name), ['Morning']);
  assert.equal(presetSummary(a), 'Esraj · Teentaal · Sohini · 120 BPM · Sa 146.83 Hz');
});

// ── Service worker strategy (sw.js run against mocked caches/fetch) ──────────
const ORIGIN = 'https://site.test';

function loadServiceWorker() {
  class Res {
    constructor(body, status = 200) { this.body = body; this.status = status; }
    clone() { return new Res(this.body, this.status); }
  }
  const store = new Map();
  const key = (u, ignoreSearch) => {
    const x = new URL(typeof u === 'string' ? u : u.url, ORIGIN + '/');
    return ignoreSearch ? x.origin + x.pathname : x.href;
  };
  const net = { online: true, hits: [] };
  const fetchMock = async req => {
    const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN + '/');
    if (!net.online) throw new TypeError('Failed to fetch');
    net.hits.push(url.pathname);
    return new Res(`network:${url.pathname}${url.search}`, url.pathname === '/missing.js' ? 404 : 200);
  };
  const caches = {
    open: async name => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return {
        put: async (req, res) => { m.set(key(req), res); },
        addAll: async urls => { for (const u of urls) m.set(key(u), await fetchMock(u)); },
      };
    },
    keys: async () => [...store.keys()],
    delete: async name => store.delete(name),
    match: async (req, opts = {}) => {
      for (const m of store.values()) {
        for (const [k, v] of m) if (key(k, opts.ignoreSearch) === key(req, opts.ignoreSearch)) return v.clone();
      }
      return undefined;
    },
  };
  const handlers = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t, f) => { handlers[t] = f; },
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(src, { self, caches, fetch: fetchMock, URL, Promise, console });

  const fetchVia = async (url, mode = 'no-cors') => {
    let responded = null;
    handlers.fetch({ request: { url: new URL(url, ORIGIN).href, method: 'GET', mode }, respondWith: p => { responded = p; } });
    return responded ? responded : 'not intercepted';
  };
  const lifecycle = async () => {
    const waits = [];
    handlers.install({ waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    handlers.activate({ waitUntil: p => waits.push(p) });
    await Promise.all(waits);
  };
  return { fetchVia, lifecycle, net, caches };
}

test('service worker: pages/scripts network-first, audio cache-first, offline fallbacks', async () => {
  const sw = loadServiceWorker();
  await sw.lifecycle();

  sw.net.hits = [];
  assert.equal((await sw.fetchVia('/public/js/main.js?v=9')).body, 'network:/public/js/main.js?v=9');

  sw.net.hits = [];
  await sw.fetchVia('/assets/Esraj_Teentaal_Sohini.aac');
  await sw.fetchVia('/assets/Esraj_Teentaal_Sohini.aac');
  assert.equal(sw.net.hits.length, 1, 'audio fetched once');

  const missing = await sw.fetchVia('/missing.js');
  assert.equal(missing.status, 404);
  assert.equal(await sw.caches.match(ORIGIN + '/missing.js'), undefined, 'errors are not cached');

  for (const url of ['/api/job_status/x', '/separator/', 'https://fonts.googleapis.com/css2']) {
    assert.equal(await sw.fetchVia(url), 'not intercepted', url);
  }

  sw.net.online = false;
  assert.match((await sw.fetchVia('/public/js/main.js?v=99')).body, /main\.js/, 'offline script');
  assert.match((await sw.fetchVia('/notation', 'navigate')).body, /index\.html/, 'offline page route');
  assert.equal((await sw.fetchVia('/assets/Esraj_Teentaal_Sohini.aac')).status, 200, 'offline audio');
});

test('service worker precaches only files that exist — and every site module', () => {
  const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const list = vm.runInNewContext(src.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
  for (const p of list.filter(p => p !== './')) {
    assert.doesNotThrow(() => readFileSync(new URL(`../${p}`, import.meta.url)), p);
  }
  // Offline, a module missing from the cache breaks the whole import graph.
  const root = new URL('../public/js/', import.meta.url);
  const modules = readdirSync(root, { recursive: true }).filter(f => f.endsWith('.js')).map(f => `./public/js/${f.replaceAll('\\', '/')}`);
  for (const m of modules) assert.ok(list.includes(m), `${m} is precached`);
  // …but not the optional tanpura string samples (loaded only when chosen)
  assert.ok(!list.some(p => /tn\dstr/.test(p)));
});
