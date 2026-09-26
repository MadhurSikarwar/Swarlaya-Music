// Build the website for a static host (Vercel — see vercel.json): only the
// files the browser needs, laid out the way the C++ server serves them.
//
//   index.html, sw.js, manifest.json, favicon.ico   the page, service worker, app manifest
//   assets/                                          lehra recordings, tanpura, metronome
//   public/  (without public/separator)             scripts, styles, icons
//   separator/                                      the exported Stem Separator (/separator/)
//
// Usage: node tools/build-static.mjs [outDir]      (default: dist)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || 'dist');
const separatorSrc = join(root, 'public', 'separator');

for (const need of ['index.html', 'public', 'assets', separatorSrc]) {
  if (!existsSync(resolve(root, need))) throw new Error(`Missing ${need} — run this from the repository`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of ['index.html', 'sw.js', 'manifest.json', 'favicon.ico']) {
  cpSync(join(root, file), join(out, file));
}
cpSync(join(root, 'assets'), join(out, 'assets'), { recursive: true });
cpSync(join(root, 'public'), join(out, 'public'), {
  recursive: true,
  filter: src => src !== separatorSrc && !src.startsWith(separatorSrc + sep),
});
cpSync(separatorSrc, join(out, 'separator'), { recursive: true });

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
