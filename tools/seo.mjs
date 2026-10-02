// Search-engine output for the static build (tools/build-static.mjs): one HTML
// page per route with its own title, description, canonical URL, social tags
// and structured data — the single-page app would otherwise answer every
// route with the home page's — plus robots.txt and sitemap.xml.
//
// Pure functions over strings (unit-tested in tests/hosting.test.js). The page
// metadata itself lives in public/js/core/routes.js, shared with the browser.
import { ROUTES, SITE_NAME } from '../public/js/core/routes.js';

export const SOCIAL_IMAGE = '/public/icons/og-image.png';

/**
 * The production origin, without a trailing slash, or '' if unknown:
 * SITE_URL if set, else the domain Vercel gives the project (also on preview
 * deployments, so their canonical URLs point at production).
 */
export function siteUrlFrom(env) {
  let url = (env.SITE_URL || env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Replace exactly one match — a changed index.html must fail the build, not ship stale tags. */
function replaceOne(html, pattern, replacement, what) {
  let n = 0;
  const out = html.replace(pattern, (...args) => {
    n++;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (n !== 1) throw new Error(`seo: expected one ${what} in the page, found ${n}`);
  return out;
}

function setMeta(html, attr, key, value) {
  const pattern = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`, 'g');
  return replaceOne(html, pattern, (_, a, b) => a + escapeAttr(value) + b, `<meta ${attr}="${key}">`);
}

const jsonLd = data =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/**
 * FAQ structured data keyed by route path.
 * Rendered as FAQPage JSON-LD so Google can show rich results.
 */
const PAGE_FAQS = {
  '/': [
    { q: 'What is Swaralaya?', a: 'Swaralaya is a free, browser-based practice tool suite for Indian classical music. It includes a lehra player, tanpura drone, Carnatic shruti box and talam keeper, Bhatkhande notation editor, swar tuner, and ear-training games.' },
    { q: 'Is Swaralaya free to use?', a: 'Yes. All tools on Swaralaya are completely free with no sign-up required. An optional account lets you sync your riyaz progress across devices.' },
    { q: 'Do I need to install anything?', a: 'No. Swaralaya works entirely in your browser on any device. No download or installation is needed.' },
    { q: 'What instruments does the lehra player support?', a: 'The lehra player includes recordings of sarangi, harmonium, sitar and esraj at any tempo and Sa.' },
  ],
  '/lehra': [
    { q: 'What is a lehra player?', a: 'A lehra player provides a repeating melodic loop in a fixed taal used by tabla and Kathak students for riyaz. Swaralaya offers lehra in Teentaal, Jhaptaal, Ektaal, Roopak and many other taals.' },
    { q: 'Can I change the tempo and pitch of the lehra?', a: 'Yes. You can change the tempo (BPM) and transpose the Sa live without restarting playback.' },
    { q: 'Can I export the lehra as an MP3?', a: 'Yes. Swaralaya can export the lehra as an MP3 file at any duration you choose.' },
  ],
  '/carnatic': [
    { q: 'What Carnatic talas are available?', a: 'Swaralaya supports Adi tala, Rupaka, Misra Chapu, Khanda Chapu and all 35 suladi talas with kalai and nadai options.' },
    { q: 'What is a kattai?', a: 'Kattai is the pitch position in Carnatic music to set the shruti box or tanpura. Swaralaya supports all 12 kattais.' },
  ],
  '/notation': [
    { q: 'What notation systems does the editor support?', a: 'The notation editor supports both Bhatkhande and Paluskar notation systems for tabla and vocal compositions, in English or Hindi.' },
    { q: 'Can I share or export my notation?', a: 'Yes. You can export your composition as a PDF and share it with others via a link.' },
  ],
  '/games': [
    { q: 'What is Swar Pehchaan?', a: 'Swar Pehchaan is an ear-training game where you listen to a swar sung against a Sa drone and identify it by name.' },
    { q: 'What is Sam Pakdo?', a: 'Sam Pakdo is a rhythm timing game where you tap exactly on the sam (first beat) of a taal to improve your laya.' },
  ],
};

function faqStructuredData(route) {
  const faqs = PAGE_FAQS[route.path];
  if (!faqs) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/** schema.org data for a route: the site and app on the home page, a page with its breadcrumb elsewhere. */
export function structuredData(route, siteUrl) {
  const url = siteUrl + route.path;
  const website = { '@id': `${siteUrl}/#website` };
  if (route.path === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite', ...website, url: `${siteUrl}/`, name: SITE_NAME,
          description: route.description, inLanguage: 'en',
        },
        {
          '@type': 'WebApplication', '@id': `${siteUrl}/#app`, name: SITE_NAME, url: `${siteUrl}/`,
          description: route.description,
          applicationCategory: 'MusicApplication',
          operatingSystem: 'Any',
          browserRequirements: 'Requires JavaScript and the Web Audio API',
          isAccessibleForFree: true,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          image: siteUrl + SOCIAL_IMAGE,
          featureList: [
            'Lehra player: sarangi, harmonium, sitar and esraj, with live tempo and pitch',
            'Tanpura drone and metronome with sam, taali and khali accents',
            'Carnatic shruti box and talam keeper',
            'Bhatkhande and Paluskar notation editor with playback and PDF export',
            'Swar tuner and riyaz tracker',
            'Ear-training and laya games',
          ],
        },
      ],
    };
  }
  const trail = [ROUTES[0], ...(route.crumbs || []).map(p => ROUTES.find(r => r.path === p)), route];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      // (named here too, so the page's data stands on its own)
      { '@type': 'WebSite', ...website, url: `${siteUrl}/`, name: SITE_NAME },
      {
        '@type': 'WebPage', '@id': `${url}#webpage`, url, name: route.title, description: route.description,
        inLanguage: 'en', isPartOf: website, breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
        itemListElement: trail.map((r, i) => ({
          '@type': 'ListItem', position: i + 1, name: r.name, item: siteUrl + r.path,
        })),
      },
    ],
  };
}

/**
 * One <h1> per page: the headings of the views that aren't showing stay
 * level-1 headings for assistive technology (the script shows those views
 * later) without competing as this document's title.
 */
function demoteHiddenHeadings(html, activeView) {
  return html.split(/(?=<div id="view-[a-z]+" class="app-view)/).map((part, i) => {
    if (i === 0 || part.startsWith(`<div id="${activeView}"`)) return part;
    const end = part.indexOf('</main>'); // the last view's part runs on to the end of the page
    const view = end < 0 ? part : part.slice(0, end);
    return view.replace(/<h1(?=[\s>])/g, '<div role="heading" aria-level="1"').replace(/<\/h1>/g, '</div>')
      + (end < 0 ? '' : part.slice(end));
  }).join('');
}

/**
 * index.html as `route`'s own page: its metadata in the head and its view
 * showing in the markup (the script still takes over routing once loaded).
 * `preload` = module URLs to hint with <link rel="modulepreload">.
 */
export function renderPage(html, route, { siteUrl = '', preload = [] } = {}) {
  const indexable = route.index !== false;
  let out = replaceOne(html, /<title>[^<]*<\/title>/g, `<title>${escapeAttr(route.title)}</title>`, '<title>');
  out = setMeta(out, 'name', 'description', route.description);
  out = setMeta(out, 'name', 'robots', indexable ? 'index, follow' : 'noindex, follow');
  out = setMeta(out, 'property', 'og:title', route.title);
  out = setMeta(out, 'property', 'og:description', route.description);
  out = setMeta(out, 'name', 'twitter:title', route.title);
  out = setMeta(out, 'name', 'twitter:description', route.description);

  const head = [];
  if (siteUrl) {
    out = setMeta(out, 'property', 'og:url', siteUrl + route.path);
    out = setMeta(out, 'property', 'og:image', siteUrl + SOCIAL_IMAGE);
    out = setMeta(out, 'name', 'twitter:image', siteUrl + SOCIAL_IMAGE);
    if (indexable) {
      head.push(`<link rel="canonical" href="${escapeAttr(siteUrl + route.path)}" />`);
      head.push(jsonLd(structuredData(route, siteUrl)));
      const faq = faqStructuredData(route);
      if (faq) head.push(jsonLd(faq));
    }
  }
  for (const href of preload) head.push(`<link rel="modulepreload" href="${escapeAttr(href)}" />`);
  if (head.length) out = replaceOne(out, /<\/head>/g, `  ${head.join('\n  ')}\n</head>`, '</head>');

  if (route.view !== 'view-home') {
    out = replaceOne(out, /<div id="view-home" class="app-view active-view">/g,
      '<div id="view-home" class="app-view" style="display: none;">', 'home view');
    out = replaceOne(out, new RegExp(`<div id="${route.view}" class="app-view" style="display: none;"`, 'g'),
      `<div id="${route.view}" class="app-view active-view"`, `#${route.view}`);
    // The header shows where you are, as navigation.js does
    const domain = new RegExp(`<div id="${route.view}" [^>]*data-domain="([a-z]+)"`).exec(out)?.[1];
    if (domain) {
      out = replaceOne(out, new RegExp(`<a class="nav-btn"( [^>]*data-domain="${domain}")`, 'g'),
        (_, rest) => `<a class="nav-btn active" aria-current="page"${rest}`, `nav link for ${domain}`);
    }
  }
  return demoteHiddenHeadings(out, route.view);
}

/**
 * The exported Stem Separator page (a separate Next.js app) with a canonical
 * URL and social tags; `live: false` — its server isn't behind this site, so
 * the page only says so — keeps it out of search results.
 */
export function renderSeparatorPage(html, { siteUrl = '', live = false } = {}) {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] || `Stem Separator | ${SITE_NAME}`;
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] || '';
  const head = [`<meta name="robots" content="${live ? 'index, follow' : 'noindex, follow'}"/>`];
  if (siteUrl) {
    const url = `${siteUrl}/separator/`;
    if (live) head.push(`<link rel="canonical" href="${escapeAttr(url)}"/>`);
    head.push(
      '<meta property="og:type" content="website"/>',
      `<meta property="og:site_name" content="${SITE_NAME}"/>`,
      `<meta property="og:title" content="${title}"/>`,
      `<meta property="og:description" content="${description}"/>`,
      `<meta property="og:url" content="${escapeAttr(url)}"/>`,
      `<meta property="og:image" content="${escapeAttr(siteUrl + SOCIAL_IMAGE)}"/>`,
      '<meta name="twitter:card" content="summary_large_image"/>',
      `<meta name="twitter:image" content="${escapeAttr(siteUrl + SOCIAL_IMAGE)}"/>`,
    );
  }
  return replaceOne(html, /<\/head>/g, `${head.join('')}</head>`, '</head>');
}

/** Paths search engines should list: the indexable routes (and the separator when it works here). */
export function sitemapPaths({ separatorLive = false } = {}) {
  const paths = ROUTES.filter(r => r.index !== false).map(r => r.path);
  if (separatorLive) paths.push('/separator/');
  return paths;
}

export function sitemapXml(siteUrl, paths) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = paths.map(p => `  <url><loc>${escapeAttr(siteUrl + p)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Everything may be crawled except the API; pages that shouldn't be listed say so themselves (noindex). */
export function robotsTxt(siteUrl) {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/'];
  if (siteUrl) lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`);
  return lines.join('\n') + '\n';
}
