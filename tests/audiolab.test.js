// Audio Lab: the page's pure helpers, and that the page, the service and the
// C++ server fit together.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTED_EXTENSIONS, checkFile, cleanPresetName, computePeaks, cyclesToRender, decodeBytes, describeGate, extensionOf,
  foldSa, formatBytes, formatClock, formatNumber, formatSigned, friendlyError, heatColor, learnedDefault, naturalLevelGain,
  keptSeconds, mergeRuns, noteOf, offsetFromTaps, orderedVariants, planRuns, runSeconds, tapAgreement, timeLeft,
} from '../public/js/audiolab/format.js';
import { FIELDS } from '../public/js/audiolab/settings.js';
import { clampTempo, raagsFor, taalInfo, taalsFor, tempoFromTabla } from '../public/js/audiolab/lehra-source.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');

test('numbers use a real minus sign and never show −0.0', () => {
  assert.equal(formatNumber(-14.04, 1), '−14.0');
  assert.equal(formatNumber(-0.04, 1), '0.0');
  assert.equal(formatNumber(3.456, 2), '3.46');
  assert.equal(formatNumber(null), '—');
  assert.equal(formatNumber(Infinity), '—');
  assert.equal(formatSigned(2, 1), '+2.0');
  assert.equal(formatSigned(-3.5, 1), '−3.5');
  assert.equal(formatSigned(0, 1), '0.0');
});

test('sizes, clocks and expiry read naturally', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(3.6 * 1024 * 1024), '3.6 MB');
  assert.equal(formatBytes(500 * 1024 * 1024), '500 MB');
  assert.equal(formatClock(83.4), '1:23');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(timeLeft(1000 + 18 * 3600, 1000), 'about 18 hours');
  assert.equal(timeLeft(1000 + 600, 1000), 'less than an hour');
  assert.equal(timeLeft(900, 1000), 'expired');
});

test('files are checked before upload', () => {
  const file = (name, size) => ({ name, size });
  assert.equal(checkFile(file('take.mp4', 1e6), 500), '');
  assert.equal(checkFile(file('take.MOV', 1e6), 500), '');
  assert.match(checkFile(file('take.mp4', 600 * 1024 * 1024), 500), /limit is 500 MB/);
  assert.match(checkFile(file('notes.pdf', 1e3), 500), /not supported/);
  assert.match(checkFile(file('empty.wav', 0), 500), /empty/);
  assert.equal(extensionOf('a.b.WAV'), 'wav');
  for (const ext of ['wav', 'mp3', 'm4a', 'mp4', 'mov']) assert.ok(ACCEPTED_EXTENSIONS.includes(ext));
});

test('gates are described in plain words and carry their verdict', () => {
  const g = describeGate({ name: 'true_peak', pass: true, value: -1.05, limit: '≤ -1.0 dBTP', detail: 'x' });
  assert.deepEqual([g.label, g.ok, g.advisory, g.value], ['True peak', true, false, '−1.05 dBTP']);
  assert.ok(g.limit.includes('−1.0'));
  const bad = describeGate({ name: 'band_tilt', pass: false, value: 7.2, limit: '± 6.0 dB' });
  assert.equal(bad.ok, false);
  assert.equal(bad.value, '+7.2 dB');
  assert.equal(describeGate({ name: 'duration', pass: true, value: -0.016, limit: '' }).value, '−16 ms');
  assert.equal(describeGate({ name: 'dayan_ring', pass: true, value: 1.2, limit: '' }).advisory, true);
  assert.equal(describeGate({ name: 'something_new', pass: true, value: 3, limit: '' }).label, 'something_new');
});

test('waveform peaks follow the signal', () => {
  const data = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) data[i] = i < 500 ? 0.5 * Math.sin(i / 3) : 0;
  const { mins, maxs } = computePeaks(data, 10);
  assert.equal(mins.length, 10);
  assert.ok(maxs[0] > 0.3 && mins[0] < -0.3, 'first half is loud');
  assert.equal(maxs[9], 0);
  assert.equal(mins[9], 0, 'silence stays at zero');
});

test('spectrogram bytes decode and colour along the site gradient', () => {
  assert.deepEqual([...decodeBytes('AAH/')], [0, 1, 255]);
  const lum = c => c[0] + c[1] + c[2];
  assert.deepEqual(heatColor(0), [9, 8, 6]);
  assert.ok(lum(heatColor(255)) > lum(heatColor(140)) && lum(heatColor(140)) > lum(heatColor(70)) && lum(heatColor(70)) > lum(heatColor(0)));
  assert.deepEqual(heatColor(-10), heatColor(0));
  assert.deepEqual(heatColor(999), heatColor(255));
});

test('versions are listed default-first and levels are matched', () => {
  const report = { default_variant: 'phone_bass', variants: { soft_highs: {}, balanced: {}, phone_bass: {} } };
  assert.deepEqual(orderedVariants(report), ['phone_bass', 'balanced', 'soft_highs']);
  assert.ok(Math.abs(naturalLevelGain(-20, -14) - 10 ** (-6 / 20)) < 1e-9);
  assert.equal(naturalLevelGain(null, -14), 1);
  assert.ok(naturalLevelGain(-2, -14) <= 4, 'a very loud original is never boosted past 4×');
});

test('every error code the service sends has friendly words', () => {
  const server = read('audio_lab/server.py') + read('audio_lab/processing.py');
  const codes = new Set([...server.matchAll(/AudioLabError\(\s*"([a-z_]+)"/g)].map(m => m[1]));
  const unwritten = [...codes].filter(c => friendlyError(c, 'FALLBACK') === 'FALLBACK');
  // codes that are internal (bad_job, spawn …) may fall back; the ones a visitor can cause must not
  for (const c of ['unreadable', 'unsupported', 'no_audio', 'too_large', 'too_long', 'too_short', 'silent_input', 'gates_failed']) {
    assert.ok(codes.has(c), `${c} is a real code`);
    assert.ok(!unwritten.includes(c), `${c} has friendly words`);
  }
});

// ── The page and its pieces fit together ─────────────────────────────────────

test('every element the script looks up exists once in the Audio Lab view', () => {
  const html = read('index.html');
  const view = html.slice(html.indexOf('<div id="view-audio"'), html.indexOf('<!-- YOUR PROGRESS'));
  assert.ok(view.length > 1000, 'found the view');
  const ids = [...view.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique inside the view');
  assert.equal(html.match(/id="view-audio"/g).length, 1);
  const wanted = new Set();
  for (const f of readdirSync(join(root, 'public/js/audiolab'))) {
    const src = read(`public/js/audiolab/${f}`);
    for (const m of src.matchAll(/(?:\$|getElementById)\('([A-Za-z0-9]+)'\)/g)) if (m[1].startsWith('alab')) wanted.add(m[1]);
    for (const m of src.matchAll(/\$\(`(alab[A-Za-z]+)\$\{/g)) wanted.add(m[1]);      // sliders: `${id}Val`
  }
  assert.ok(wanted.size > 40);
  for (const id of wanted) assert.ok(ids.includes(id), `#${id} is in the markup`);
  for (const slider of ['alabLehraDb', 'alabVocalDb', 'alabBrightness', 'alabBass', 'alabShift', 'alabSpeed', 'alabTanpuraDb',
    'alabFadeIn', 'alabFadeOut', 'alabCustomLufs']) assert.ok(ids.includes(`${slider}Val`), `${slider}Val`);
  for (const [id] of FIELDS) assert.ok(ids.includes(id), `setting #${id} is in the markup`);
});

test('the page is wired in without disturbing the other views', () => {
  const main = read('public/js/main.js');
  assert.ok(main.includes("from './audiolab/index.js'") && main.includes('initAudioLab();') && main.includes('onLeaveView(leaveAudioLab)'));
  const sw = read('sw.js');
  for (const f of readdirSync(join(root, 'public/js/audiolab'))) assert.ok(sw.includes(`./public/js/audiolab/${f}`), `${f} is precached`);
  // the stylesheet's Audio Lab rules are all prefixed, so no existing rule can be affected
  const css = read('public/css/style.css');
  const start = css.indexOf('.alab-panel {');
  assert.ok(start > 0, 'found the Audio Lab rules');
  const block = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...block.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim()).filter(sel => !sel.startsWith('@') && !/^(\d+%|from|to)$/.test(sel));
  assert.ok(selectors.length > 40);
  for (const sel of selectors) {
    for (const part of sel.split(',')) assert.match(part.trim(), /\.alab-/, `scoped: ${part.trim()}`);
  }
});

test('the page, the service and the C++ server agree on URLs and stay out of each other’s way', () => {
  const api = read('public/js/audiolab/api.js');
  const config = read('public/js/audiolab/config.js');
  const server = read('audio_lab/server.py');
  assert.match(config, /AUDIO_LAB_API = '\/api\/master'/);
  assert.match(server, /APIRouter\(prefix="\/api\/master"\)/);
  for (const [client, route] of [['/health', '"/health"'], ['/jobs`', '"/jobs"'], ['/events`', '"/jobs/{job_id}/events"'],
    ['/files/', '"/jobs/{job_id}/files/{name}"'], ['/jobs/${jobId}`', '"/jobs/{job_id}"']]) {
    assert.ok(api.includes(client), `client calls ${client}`);
    assert.ok(server.includes(route), `service serves ${route}`);
  }
  // Drogon registers nothing under /api/master, and its catch-all steps aside for every /api/ path
  const controllers = join(root, 'drogon_server/controllers');
  const paths = readdirSync(controllers).filter(f => f.endsWith('.hpp'))
    .flatMap(f => [...read(`drogon_server/controllers/${f}`).matchAll(/ADD_METHOD(?:_TO|_VIA_REGEX)\([^,]+,\s*"([^"]+)"/g)].map(m => m[1]));
  assert.ok(paths.includes('/api/separate'), 'found the separator routes');
  assert.deepEqual(paths.filter(p => p.startsWith('/api/master')), []);
  assert.ok(paths.some(p => p.includes('(?!api/)')), 'catch-all excludes /api/');
  // …and the service's own routes never shadow the separator's
  for (const p of paths.filter(p => p.startsWith('/api/'))) assert.ok(!p.startsWith('/api/master'), p);
});

test('routing /api/master/ on the static host does not make the Stem Separator look live', () => {
  const build = read('tools/build-static.mjs');
  assert.match(build, /startsWith\('\/api\/'\) && !r\.source\.startsWith\('\/api\/master'\)/);
});

test('the service worker never caches the Audio Lab API', () => {
  assert.match(read('sw.js'), /url\.pathname\.startsWith\('\/api\/'\)/);
});

// ── The second wave: taps, Sa, the catalogue lehra, preferences ───────────────

test('sam taps become the lehra offset, averaged around the cycle', () => {
  const cycle = 5.0;
  // taps on successive sams, a little early and late, the first at 1.20 s
  const taps = [1.21, 6.18, 11.22, 16.19];
  assert.ok(Math.abs(offsetFromTaps(taps, cycle) - 1.2) < 0.01);
  assert.ok(tapAgreement(taps, cycle) > 0.99);
  // taps straddling the wrap-around (cycle end / start) still average correctly
  assert.ok(Math.abs(offsetFromTaps([4.98, 10.02, 14.99], cycle) - 0.0) < 0.02);
  assert.ok(tapAgreement([0.0, 2.5], cycle) < 0.01, 'taps half a cycle apart do not agree');
  assert.equal(offsetFromTaps([], cycle), null);
});

test('Sa folds into the lehra range and names its note', () => {
  assert.ok(Math.abs(foldSa(277.18) - 138.59) < 1e-9);
  assert.ok(Math.abs(foldSa(69.3) - 138.6) < 1e-9);
  assert.equal(foldSa(0), null);
  assert.deepEqual(noteOf(138.59), { name: 'C#', octave: 3, cents: 0 });
  assert.equal(noteOf(440 * 2 ** (30 / 1200)).cents, 30);
});

test('a catalogue lehra is rendered as whole cycles of at least 20 s', () => {
  assert.equal(cyclesToRender(5.333), 4);
  assert.equal(cyclesToRender(30), 2, 'never fewer than two cycles');
  assert.equal(cyclesToRender(10, 20), 2);
});

test('the catalogue helpers fit the tabla’s tempo into the taal’s range', () => {
  const taal = taalsFor('Sitar').find(t => t.startsWith('Teentaal'));
  assert.ok(taal && raagsFor('Sitar', taal).length > 0);
  const info = taalInfo('Sitar', taal);
  assert.equal(info.beatsPerCycle, 16);
  assert.equal(clampTempo('Sitar', taal, 10000), info.maxTempo);
  assert.equal(tempoFromTabla('Sitar', taal, 90), 90);
  // a beat tracker that reported half time is doubled back into range when that is the only fit
  const slow = info.minTempo / 2 - 1;
  assert.ok(tempoFromTabla('Sitar', taal, slow) >= info.minTempo);
  const double = taalsFor('Esraj').find(t => t.includes('Double'));
  if (double) assert.equal(taalInfo('Esraj', double).beatsPerCycle, 7, 'a two-cycle loop has seven-beat cycles');
});

test('preferences: the version you keep downloading, and tidy preset names', () => {
  const available = ['phone_bass', 'balanced', 'soft_highs'];
  assert.equal(learnedDefault({}, available, 'phone_bass'), 'phone_bass');
  assert.equal(learnedDefault({ balanced: 2 }, available, 'phone_bass'), 'phone_bass', 'two downloads are not yet a habit');
  assert.equal(learnedDefault({ balanced: 4, soft_highs: 3 }, available, 'phone_bass'), 'balanced');
  assert.equal(learnedDefault({ gone: 9 }, available, 'phone_bass'), 'phone_bass');
  assert.equal(cleanPresetName('  My\nsound  '), 'My sound');
  assert.equal(cleanPresetName('   '), null);
  assert.equal(cleanPresetName('x'.repeat(60)).length, 40);
});

test('every setting maps to an option the service knows', () => {
  const server = read('audio_lab/processing.py');
  for (const [, key] of FIELDS) assert.match(server, new RegExp(`\\b${key}\\b`), key);
});


// ── The serverless build (Vercel) ────────────────────────────────────────────

test('what is mastered is what the trim keeps, at the chosen speed', () => {
  assert.equal(keptSeconds(120, {}), 120);
  assert.equal(keptSeconds(120, { trim_start: 10, trim_end: 70 }), 60);
  assert.equal(keptSeconds(120, { trim_start: 10, trim_end: 500 }), 110);
  assert.equal(keptSeconds(120, { tempo_factor: 2 }), 60);
});

test('versions are split into runs that fit one function call', () => {
  const all = ['balanced', 'phone_bass', 'soft_highs'];
  // a short clip: everything in one run
  assert.deepEqual(planRuns(all, { seconds: 40, uploadMb: 10, hasVideo: true }), [all]);
  // the 3-minute kayada: one version per run, the default first (the lead)
  const long = planRuns(all, { seconds: 183, uploadMb: 31, hasVideo: true });
  assert.deepEqual(long, [['phone_bass'], ['balanced'], ['soft_highs']]);
  for (const run of long) assert.ok(runSeconds(183, run.length) <= 240);
  // in between: two runs, the lead never the bigger one
  const mid = planRuns(all, { seconds: 90, uploadMb: 12, hasVideo: true });
  assert.equal(mid.length, 2);
  assert.deepEqual(mid.flat().sort(), [...all].sort());
  assert.equal(mid[0][0], 'phone_bass');
  assert.ok(mid[0].length <= mid[1].length);
  // the disk can force a split the time would not
  assert.equal(planRuns(all, { seconds: 40, uploadMb: 140, hasVideo: true, diskMb: 450 }).length > 1, true);
  // one version, or none asked for: one run
  assert.deepEqual(planRuns(['soft_highs'], { seconds: 600 }), [['soft_highs']]);
  // every version is in exactly one run
  for (const seconds of [10, 60, 100, 150, 200]) {
    const runs = planRuns(all, { seconds, uploadMb: 20, hasVideo: true });
    assert.deepEqual(runs.flat().sort(), [...all].sort(), `${seconds} s`);
    assert.ok(runs.every(r => r.length), `${seconds} s: no empty run`);
  }
});

test('runs of one job are put back together into one report', () => {
  const v = (label, passed) => ({ label, passed, gates: [], files: { mp3: `${label}.mp3` } });
  const lead = {
    lead: true,
    report: { before: { lufs: -20 }, variants: { phone_bass: v('phone_bass', true) }, files: { original: 'original.mp3' },
      insights: { laya: {} }, warnings: ['a', 'b'], seconds_taken: 120, default_variant: 'phone_bass' },
    spectrograms: { before: 'B', phone_bass: 'P' },
    files: { 'phone_bass.mp3': { url: 'u1' }, 'original.mp3': { url: 'u0' } },
  };
  const other = {
    lead: false,
    report: { before: { lufs: -20 }, variants: { balanced: v('balanced', true), soft_highs: v('soft_highs', false) },
      files: {}, insights: {}, warnings: ['b', 'c'], seconds_taken: 150, default_variant: 'balanced' },
    spectrograms: { before: 'B', balanced: 'X', soft_highs: 'S' },
    files: { 'balanced.mp3': { url: 'u2' } },
  };
  const order = ['balanced', 'phone_bass', 'soft_highs'];
  const m = mergeRuns([other, lead], order);
  assert.deepEqual(Object.keys(m.report.variants), order);
  assert.equal(m.report.default_variant, 'phone_bass');
  assert.deepEqual(m.passed, ['balanced', 'phone_bass']);
  assert.deepEqual(m.report.warnings, ['b', 'c', 'a']);
  assert.deepEqual(m.report.insights, { laya: {} }, 'the shared parts come from the lead run');
  assert.equal(m.report.files.original, 'original.mp3');
  assert.equal(m.report.seconds_taken, 150);
  assert.deepEqual(Object.keys(m.files).sort(), ['balanced.mp3', 'original.mp3', 'phone_bass.mp3']);
  assert.deepEqual(m.spectrograms, { before: 'B', balanced: 'X', phone_bass: 'P', soft_highs: 'S' });
  // the default version failed: the first that passed in the order asked for
  lead.report.variants.phone_bass.passed = false;
  assert.equal(mergeRuns([lead, other], order).report.default_variant, 'balanced');
});

test('the serverless function, the upload function and the page agree on where files go', () => {
  const py = read('audio_lab/serverless.py');
  const node = read('api/master-upload.js');
  const page = read('public/js/audiolab/serverless.js');
  // the page names uploads audio-lab/<32 hex>/in/<role>-<8 hex>.<ext>; both functions accept exactly that
  assert.match(page, /audio-lab\/\$\{job\.folder\}\/in\/\$\{role\}-\$\{hex\(4\)\}\.\$\{ext\}/);
  const nodeRe = new RegExp(node.match(/const PATHNAME = \/(.+)\/;/)[1]);
  const pyRe = new RegExp(py.match(/INPUT_RE = re\.compile\(r"(.+)"\)/)[1].replaceAll('(?:', '(?:'));
  const ok = `audio-lab/${'a1'.repeat(16)}/in/lehra-0f0f0f0f.mp3`;
  for (const re of [nodeRe, pyRe]) {
    assert.ok(re.test(ok), `${re} accepts the page's names`);
    for (const bad of [`audio-lab/${'a1'.repeat(16)}/in/other-0f0f0f0f.mp3`, `audio-lab/xyz/in/tabla.mp3`,
      `audio-lab/${'a1'.repeat(16)}/in/../tabla.mp3`, `audio-lab/${'a1'.repeat(16)}/out/tabla.mp3`]) {
      assert.ok(!re.test(bad), `${re} refuses ${bad}`);
    }
  }
  // the size limits match
  const caps = Object.fromEntries([...node.matchAll(/(\w+): (\d+)/g)].filter(m => ['tabla', 'lehra', 'recorder'].includes(m[1])).map(m => [m[1], +m[2]]));
  assert.equal(caps.tabla, Number(py.match(/AUDIO_LAB_MAX_UPLOAD_MB", (\d+)/)[1]));
  assert.equal(caps.lehra, Number(py.match(/AUDIO_LAB_MAX_SIDE_UPLOAD_MB", (\d+)/)[1]));
  // the page keeps credentials out: it only ever talks to the upload function
  assert.doesNotMatch(page, /BLOB_READ_WRITE_TOKEN|vercel_blob_rw/);
});

test('the upload function answers the page without a webhook key, and refuses callbacks', async () => {
  // @vercel/blob's handleUploadPresigned demands BLOB_WEBHOOK_PUBLIC_KEY even though only the
  // upload-completed callback uses it; a new Blob store does not set it, so every upload got a 400.
  const saved = process.env.BLOB_WEBHOOK_PUBLIC_KEY;
  delete process.env.BLOB_WEBHOOK_PUBLIC_KEY;
  try {
    const { default: fn } = await import('../api/master-upload.js');
    const post = body => fn.fetch(new Request('https://swaralaya.test/api/master-upload', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    const bad = await post({ type: 'blob.generate-presigned-url', payload: { pathname: 'elsewhere/x.mp4', clientPayload: null, multipart: false } });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'That upload is not allowed.' }, 'the pathname check ran, so the library got that far');
    const callback = await post({ type: 'blob.upload-completed', payload: {} });
    assert.equal(callback.status, 400);
    assert.deepEqual(await callback.json(), { error: 'That request was not understood.' });
    assert.equal((await fn.fetch(new Request('https://swaralaya.test/api/master-upload'))).status, 405);
  } finally {
    if (saved !== undefined) process.env.BLOB_WEBHOOK_PUBLIC_KEY = saved;
  }
});

test('the Vercel config routes the Audio Lab without touching the static site', () => {
  const cfg = JSON.parse(read('vercel.json'));
  assert.deepEqual(cfg.rewrites.at(-1), { source: '/api/master/:op', destination: '/api/master?op=:op' });
  assert.equal(cfg.functions['api/master.py'].maxDuration, 300);
  assert.ok(cfg.functions['api/master.py'].excludeFiles.length <= 256, 'Vercel rejects an excludeFiles longer than 256 characters');
  assert.equal(cfg.buildCommand, 'node tools/build-static.mjs');
  assert.equal(cfg.outputDirectory, 'dist');
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['@vercel/blob'], 'only the upload function needs a package');
});

test('the serverless limit on length comes with the server’s own advice', () => {
  // over_limit (serverless.py / serverless.js) has no fixed wording: the message says how long, and what to do
  assert.equal(friendlyError('over_limit', 'Trim it to 3.5 minutes.'), 'Trim it to 3.5 minutes.');
  assert.match(read('audio_lab/serverless.py'), /AudioLabError\("over_limit", f"On this site a recording can be up to/);
  assert.equal(friendlyError('busy', 'x'), 'The studio is busy right now. Please try again in a few minutes.');
});
