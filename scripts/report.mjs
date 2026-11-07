// Writes report/index.html (static, for search engines and link previews) using the same
// pipeline and renderer the live report page uses in the browser.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ORDER, DEFAULTS } from '../js/model.js';
import { buildObjects, rankAll, pricesFrom } from '../js/pipeline.js';
import { renderReport, pickPast } from '../js/report-core.js';

const ROOT = new URL('../', import.meta.url);
const read = async (f, d) => { try { return JSON.parse(await readFile(new URL(f, ROOT), 'utf8')); } catch (e) { if (d !== undefined) return d; throw e; } };

const [ast, com, nh, lam, pr, ca, hist] = await Promise.all([
  read('data/asteroids.json'), read('data/comets.json', null), read('data/nhats.json', null), read('data/lambert.json', null),
  read('data/prices.json'), read('data/close-approaches.json', { list: [] }), read('data/history.json', { days: {} }),
]);
const prices = pricesFrom(pr.metals);
const objs = buildObjects({ ast, com, nh, lam, cad: ca });
const ranked = rankAll(objs, { ...DEFAULTS }, prices);

// daily history snapshot (120 days) for "vs last week"
const today = new Date().toISOString().slice(0, 10);
hist.days[today] = {
  prices: Object.fromEntries(ORDER.map(k => [k, +prices[k].toPrecision(6)])),
  ranks: Object.fromEntries(ranked.filter(o => !o.comet).slice(0, 200).map(o => [o.name, o.rank])),
};
const days = Object.keys(hist.days).sort();
for (const d of days.slice(0, Math.max(0, days.length - 120))) delete hist.days[d];
await writeFile(new URL('data/history.json', ROOT), JSON.stringify(hist));

const { past, refDate } = pickPast(hist, today);
const updated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const { title, desc, main } = renderReport({ ranked, prices, cadList: ca.list, past, refDate, updated, coverage: lam?.coverage });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Astromine</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="https://mauki65.github.io/astromine/report/">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="https://mauki65.github.io/astromine/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../css/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='9' fill='none' stroke='%23ff9f1c' stroke-width='3'/></svg>">
<style>
  body{overflow:auto} .page.report{max-width:960px;margin:0 auto;padding:76px 20px 60px}
  .report h1{font-size:22px;margin:0 0 6px} .report .lead{font-size:15px;line-height:1.6;color:#c7cbd3;max-width:760px}
  .report h2{font-size:14px;margin:36px 0 8px} .report a{color:var(--text)} .report td a{text-decoration:none;border-bottom:1px solid var(--line2);white-space:nowrap}
  .tag{font-size:10px;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--c);color:var(--c);border-radius:4px;padding:2px 6px;white-space:nowrap}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:24px} @media(max-width:760px){.cols{grid-template-columns:1fr}}
  .cta{display:inline-block;margin-top:14px;border:1px solid var(--accent);color:var(--accent)!important;border-radius:6px;padding:7px 14px;text-decoration:none}
</style>
</head><body>
<header class="top"><a class="brand" href="../" style="color:inherit;text-decoration:none"><span class="mark"></span>ASTROMINE</a>
<nav class="tabs"><a href="../" class="tabl">Map</a><a href="./" class="tabl on">Report</a></nav></header>
<main class="page report" id="report" style="position:static">${main}
</main>
<script type="module" src="../js/report-live.js"></script>
</body></html>`;

await mkdir(new URL('report/', ROOT), { recursive: true });
await writeFile(new URL('report/index.html', ROOT), html);
await writeFile(new URL('sitemap.xml', ROOT), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mauki65.github.io/astromine/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://mauki65.github.io/astromine/report/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>
</urlset>
`);
const top = ranked.find(o => !o.comet);
console.log(`report: top=${top?.name} profit=${top?.ev.profit.toFixed(0)}`);
