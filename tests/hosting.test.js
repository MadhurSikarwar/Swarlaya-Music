// Hosting: the page routes agree everywhere they're listed, and the static
// build (Vercel) publishes exactly the website.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');
const quoted = s => [...s.matchAll(/["']([a-z]+)["']/g)].map(m => m[1]).sort();

test('page routes are the same in the browser, the C++ server, the dev server and vercel.json', () => {
  const browser = [...read('public/js/core/navigation.js').match(/const PATH_VIEWS = \{([\s\S]*?)\};/)[1]
    .matchAll(/^\s*(\w+):/gm)].map(m => m[1]).sort();
  const cpp = quoted(read('drogon_server/controllers/StaticController.cpp').match(/kSpaRoutes = \{([^}]*)\}/)[1]);
  const dev = quoted(read('tools/dev_server.py').match(/SPA_ROUTES = \{([^}]*)\}/)[1]);
  const vercel = JSON.parse(read('vercel.json')).rewrites
    .map(r => r.source.match(/\(([a-z|]+)\)/))
    .filter(Boolean)
    .map(m => m[1].split('|').sort());
  assert.ok(browser.length >= 5);
  assert.deepEqual(cpp, browser, 'C++ StaticController');
  assert.deepEqual(dev, browser, 'tools/dev_server.py');
  assert.ok(vercel.length > 0);
  for (const list of vercel) assert.deepEqual(list, browser, 'vercel.json rewrites');
});

test('the static build publishes the website only, with everything the offline cache needs', () => {
  const out = mkdtempSync(join(tmpdir(), 'swaralaya-build-'));
  try {
    const run = spawnSync(process.execPath, [join(root, 'tools', 'build-static.mjs'), out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    for (const p of ['index.html', 'sw.js', 'manifest.json', 'favicon.ico', 'assets/Metronome.aac',
      'public/js/main.js', 'public/js/lehra/engine.worklet.js', 'separator/index.html']) {
      assert.ok(existsSync(join(out, p)), `${p} is published`);
    }
    for (const p of ['public/separator', 'drogon_server', 'tests', 'tools', 'stem-frontend', 'uploads',
      'README.md', 'Dockerfile', 'package.json']) {
      assert.ok(!existsSync(join(out, p)), `${p} is not published`);
    }
    // Everything the service worker precaches must be in the build, or its install fails offline
    const list = vm.runInNewContext(read('sw.js').match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
    for (const p of list.filter(p => p !== './')) assert.ok(existsSync(join(out, p)), `precached ${p}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
