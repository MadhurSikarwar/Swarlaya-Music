// Hosting: the page routes agree everywhere they're listed, and the static
// build (Vercel) publishes exactly the website — a page per route, with the
// metadata search engines read (tools/seo.mjs).  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ROUTES } from '../public/js/core/routes.js';
import { renderSeparatorPage, robotsTxt, siteUrlFrom, sitemapPaths } from '../tools/seo.mjs';

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

/** Run the static build into a temporary folder; `fn(out, read)` inspects it. */
function withBuild(env, fn) {
  const out = mkdtempSync(join(tmpdir(), 'swaralaya-build-'));
  try {
    const run = spawnSync(process.execPath, [join(root, 'tools', 'build-static.mjs'), out],
      { encoding: 'utf8', env: { ...process.env, SITE_URL: '', VERCEL_PROJECT_PRODUCTION_URL: '', ...env } });
    assert.equal(run.status, 0, run.stderr);
    fn(out, p => readFileSync(join(out, p), 'utf8'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const SITE = 'https://swaralaya.test';
const tag = (html, re) => re.exec(html)?.[1];
const titleOf = html => tag(html, /<title>([^<]*)<\/title>/);
const descriptionOf = html => tag(html, /<meta name="description" content="([^"]*)"/);
const canonicalOf = html => tag(html, /<link rel="canonical" href="([^"]*)"/);
const robotsOf = html => tag(html, /<meta name="robots" content="([^"]*)"/);

test('every page has its own route metadata: unique, and short enough to show whole', () => {
  const paths = [...read('public/js/core/navigation.js').match(/const VIEW_PATHS = \{([\s\S]*?)\};/)[1]
    .matchAll(/'(view-[a-z]+)': '([^']+)'/g)].map(m => `${m[1]} ${m[2]}`).sort();
  assert.deepEqual(ROUTES.map(r => `${r.view} ${r.path}`).sort(), paths, 'routes.js lists the views navigation.js routes');
  for (const key of ['title', 'description', 'path']) {
    assert.equal(new Set(ROUTES.map(r => r[key])).size, ROUTES.length, `${key}s are unique`);
  }
  for (const r of ROUTES) {
    assert.ok(r.title.length >= 20 && r.title.length <= 65, `${r.path} title: ${r.title.length} characters`);
    assert.ok(r.description.length <= 160, `${r.path} description: ${r.description.length} characters`);
    if (r.index !== false) assert.ok(r.description.length >= 110, `${r.path} description says what the page is`);
    for (const crumb of r.crumbs || []) assert.ok(ROUTES.some(x => x.path === crumb), `${r.path} crumb ${crumb}`);
  }
  // index.html itself is the home page
  const html = read('index.html');
  assert.equal(titleOf(html), ROUTES[0].title);
  assert.equal(descriptionOf(html), ROUTES[0].description);
});

test('the site address comes from SITE_URL, else from Vercel', () => {
  assert.equal(siteUrlFrom({}), '');
  assert.equal(siteUrlFrom({ VERCEL_PROJECT_PRODUCTION_URL: 'swaralaya.vercel.app' }), 'https://swaralaya.vercel.app');
  assert.equal(siteUrlFrom({ SITE_URL: 'https://swaralaya.in/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://swaralaya.in');
  assert.equal(siteUrlFrom({ SITE_URL: 'swaralaya.in' }), 'https://swaralaya.in');
  assert.equal(read('robots.txt'), robotsTxt(''), 'robots.txt (served by the C++ and dev servers) matches the build');
});

test('the static build bakes a page per route for search engines', () => {
  withBuild({ SITE_URL: SITE }, (out, built) => {
    for (const r of ROUTES) {
      const html = built(r.path === '/' ? 'index.html' : `${r.path.slice(1)}/index.html`);
      assert.equal(titleOf(html), r.title.replace(/&/g, '&amp;'), r.path);
      assert.equal(descriptionOf(html), r.description, r.path);
      assert.equal(tag(html, /<meta property="og:title" content="([^"]*)"/), r.title.replace(/&/g, '&amp;'));
      assert.equal(tag(html, /<meta property="og:url" content="([^"]*)"/), SITE + r.path);
      assert.equal(tag(html, /<meta property="og:image" content="([^"]*)"/), `${SITE}/public/icons/og-image.png`);
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${r.path}: one <h1>`);
      assert.deepEqual([...html.matchAll(/<div id="(view-[a-z]+)" class="app-view active-view"/g)].map(m => m[1]), [r.view],
        `${r.path} shows its own view without the script`);
      if (r.index === false) {
        assert.equal(robotsOf(html), 'noindex, follow', r.path);
        assert.equal(canonicalOf(html), undefined, `${r.path}: no canonical on a noindex page`);
      } else {
        assert.equal(robotsOf(html), 'index, follow', r.path);
        assert.equal(canonicalOf(html), SITE + r.path, r.path);
        const data = JSON.parse(tag(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
        assert.equal(data['@context'], 'https://schema.org');
        assert.ok(data['@graph'].length >= 2, `${r.path} structured data`);
      }
      // …and loads its scripts in one go
      const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]*)"/g)].map(m => m[1]);
      assert.ok(preloads.includes('/public/js/main.js') && preloads.includes('/public/js/lehra/engine.js'));
      for (const p of preloads) assert.ok(existsSync(join(out, p)), `preloaded ${p} exists`);
    }
    assert.ok(existsSync(join(out, 'public/icons/og-image.png')));

    const sitemap = built('sitemap.xml');
    const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
    assert.deepEqual(listed, sitemapPaths().map(p => SITE + p));
    assert.ok(listed.includes(`${SITE}/lehra`) && !listed.some(u => u.includes('/practice')), 'only indexable pages');
    assert.equal(built('robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);

    // The Stem Separator has no server behind a static host: its page stays out of the index
    const separator = built('separator/index.html');
    assert.equal(robotsOf(separator), 'noindex, follow');
    assert.ok(!listed.includes(`${SITE}/separator/`));
  });
});

test('the Stem Separator page is listed once its server is behind the site', () => {
  const html = read('public/separator/index.html');
  const live = renderSeparatorPage(html, { siteUrl: SITE, live: true });
  assert.equal(robotsOf(live), 'index, follow');
  assert.equal(canonicalOf(live), `${SITE}/separator/`);
  assert.ok(sitemapPaths({ separatorLive: true }).includes('/separator/'));
  assert.equal(titleOf(live), titleOf(html), 'the page keeps its own title');
});

test('the static build publishes the website only, with everything the offline cache needs', () => {
  withBuild({}, (out, built) => {
    for (const p of ['index.html', 'sw.js', 'manifest.json', 'favicon.ico', 'robots.txt', 'assets/Metronome.aac',
      'public/js/main.js', 'public/js/lehra/engine.worklet.js', 'separator/index.html', 'lehra/index.html']) {
      assert.ok(existsSync(join(out, p)), `${p} is published`);
    }
    // Without the site's address: no sitemap and no canonical URLs, everything else as usual
    assert.ok(!existsSync(join(out, 'sitemap.xml')));
    assert.equal(built('robots.txt'), robotsTxt(''));
    assert.equal(canonicalOf(built('lehra/index.html')), undefined);
    assert.equal(titleOf(built('lehra/index.html')), ROUTES.find(r => r.path === '/lehra').title);
    for (const p of ['public/separator', 'drogon_server', 'tests', 'tools', 'stem-frontend', 'uploads',
      'README.md', 'Dockerfile', 'package.json']) {
      assert.ok(!existsSync(join(out, p)), `${p} is not published`);
    }
    // Everything the service worker precaches must be in the build, or its install fails offline
    const list = vm.runInNewContext(read('sw.js').match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
    for (const p of list.filter(p => p !== './')) assert.ok(existsSync(join(out, p)), `precached ${p}`);
  });
});
