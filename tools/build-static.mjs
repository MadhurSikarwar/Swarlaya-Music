// Build the website for a static host (Vercel — see vercel.json): only the
// files the browser needs, laid out the way the C++ server serves them.
//
//   index.html, sw.js, manifest.json, favicon.ico   the page, service worker, app manifest
//   <route>/index.html                               the same page per route (/lehra, /notation, …)
//                                                    with that page's title, description, canonical
//                                                    URL, social tags and structured data (tools/seo.mjs)
//   robots.txt, sitemap.xml                          for search engines
//   assets/                                          lehra recordings, tanpura, metronome
//   public/  (without public/separator)             scripts, styles, icons
//   separator/                                      the exported Stem Separator (/separator/)
//
// Canonical URLs and the sitemap need the site's address: SITE_URL if set,
// else Vercel's own VERCEL_PROJECT_PRODUCTION_URL. Without either (a local
// build) they are left out and everything else is built as usual.
//
// Usage: node tools/build-static.mjs [outDir]      (default: dist)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../public/js/core/routes.js';
import { renderPage, renderSeparatorPage, robotsTxt, siteUrlFrom, sitemapPaths, sitemapXml } from './seo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || 'dist');
const separatorSrc = join(root, 'public', 'separator');

for (const need of ['index.html', 'public', 'assets', separatorSrc]) {
  if (!existsSync(resolve(root, need))) throw new Error(`Missing ${need} — run this from the repository`);
}

/**
 * Every module main.js reaches through static imports, as site URLs. Hinted
 * with <link rel="modulepreload">, the browser fetches them all at once
 * instead of discovering them one import level at a time.
 */
function moduleGraph(entry) {
  const seen = new Set();
  (function visit(url) {
    if (seen.has(url)) return;
    const file = join(root, url);
    if (!existsSync(file)) return;
    seen.add(url);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
      visit(posix.join(posix.dirname(url), m[1]));
    }
  })(entry);
  return [...seen].map(u => '/' + u);
}

const siteUrl = siteUrlFrom(process.env);
// The Stem Separator works on this host only if /api/ is routed to its server.
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const separatorLive = (vercel.rewrites || []).some(r => r.source.startsWith('/api/'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of ['sw.js', 'manifest.json', 'favicon.ico']) {
  cpSync(join(root, file), join(out, file));
}
cpSync(join(root, 'assets'), join(out, 'assets'), { recursive: true });
cpSync(join(root, 'public'), join(out, 'public'), {
  recursive: true,
  filter: src => src !== separatorSrc && !src.startsWith(separatorSrc + sep),
});
cpSync(separatorSrc, join(out, 'separator'), { recursive: true });

// A page per route
const page = readFileSync(join(root, 'index.html'), 'utf8');
const preload = moduleGraph('public/js/main.js');
for (const route of ROUTES) {
  const dir = route.path === '/' ? out : join(out, route.path.slice(1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), renderPage(page, route, { siteUrl, preload }));
}
const separatorPage = join(out, 'separator', 'index.html');
writeFileSync(separatorPage, renderSeparatorPage(readFileSync(separatorPage, 'utf8'), { siteUrl, live: separatorLive }));

writeFileSync(join(out, 'robots.txt'), robotsTxt(siteUrl));
if (siteUrl) writeFileSync(join(out, 'sitemap.xml'), sitemapXml(siteUrl, sitemapPaths({ separatorLive })));

let files = 0, bytes = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else { files++; bytes += s.size; }
  }
})(out);
console.log(`Static site built in ${out}: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
console.log(siteUrl
  ? `Pages, canonical URLs and sitemap.xml are for ${siteUrl}`
  : 'No SITE_URL (or VERCEL_PROJECT_PRODUCTION_URL): built without canonical URLs and sitemap.xml');
