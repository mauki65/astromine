// Writes report/index.html (static, for search engines and link previews) using the same
// pipeline and renderer the live report page uses in the browser.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ORDER, DEFAULTS, waterPrice } from '../js/model.js';
import { buildObjects, rankAll, pricesFrom } from '../js/pipeline.js';
import { renderReport, pickPast } from '../js/report-core.js';
import { GUIDE_HTML } from '../js/guide.js';

const ROOT = new URL('../', import.meta.url);
const read = async (f, d) => { try { return JSON.parse(await readFile(new URL(f, ROOT), 'utf8')); } catch (e) { if (d !== undefined) return d; throw e; } };

const [ast, com, nh, lam, pr, ca, hist, tax] = await Promise.all([
  read('data/asteroids.json'), read('data/comets.json', null), read('data/nhats.json', null), read('data/lambert.json', null),
  read('data/prices.json'), read('data/close-approaches.json', { list: [] }), read('data/history.json', { days: {} }), read('data/taxonomy.json', null),
]);
const prices = pricesFrom(pr.metals);
const objs = buildObjects({ ast, com, nh, lam, tax, cad: ca });
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
<link rel="canonical" href="https://astromine.live/report/">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="https://astromine.live/assets/og.png">
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
<nav class="tabs"><a href="../" class="tabl">Map</a><a href="./" class="tabl on">Report</a><a href="../about/" class="tabl">Guide</a></nav></header>
<main class="page report" id="report" style="position:static">${main}
</main>
<script type="module" src="../js/report-live.js"></script>
<script data-goatcounter="https://mauki.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
</body></html>`;

await mkdir(new URL('report/', ROOT), { recursive: true });
await writeFile(new URL('report/index.html', ROOT), html);
// ---------- /about/ (guide + FAQ with live numbers) and /llms.txt ----------
const A = ranked.filter(o => !o.comet), N = A.length, prof = A.filter(o => o.ev.profit > 0);
const money = v => { const a = Math.abs(v), sg = v < 0 ? '−' : ''; return a >= 1e9 ? `${sg}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(1)}M` : `${sg}$${Math.round(a / 1e3)}k`; };
const sn = n => n.replace(/^\((.*)\)$/, '$1');
const waterLed = prof.filter(o => o.ev.to === 'depot').length, metalLed = prof.length - waterLed;
const top3 = A.slice(0, 3).map(o => `${sn(o.name)} (${o.tier.label}, ${o.cls}-type, ${money(o.ev.profit)} per trip)`);
const psyche = A.find(o => /^16 Psyche/.test(o.name));
const evc = k => A.filter(o => o.evidence === k).length.toLocaleString('en-US');
const NF = N.toLocaleString('en-US'), PF = prof.length.toLocaleString('en-US');
const FAQ = [
  ['What is Astromine?', `Astromine is a free, live map of ${NF} real asteroids (plus optional comets) that ranks each one from Common to Mythic by the expected profit of a mining mission. Orbits come from NASA/JPL, trajectories are computed every hour, and metal prices update every minute.`],
  ['Which asteroid is the most valuable to mine right now?', `Under Astromine's default mission assumptions the top targets today are ${top3.join('; ')}. The ranking changes with metal prices, launch windows and your own cost assumptions.`],
  ['Is asteroid mining profitable?', `Only for a handful of targets, and only with spacecraft reused over many trips. Under Astromine's defaults (launch $${DEFAULTS.costEarth}/kg, a $${(DEFAULTS.buildCost / 1000).toFixed(1)}B spacecraft flying ${DEFAULTS.trips} trips) ${PF} of ${NF} tracked asteroids come out profitable, ${waterLed === prof.length ? `all ${waterLed}` : waterLed} of them from water sold as rocket fuel at a depot near the Moon. That water is valued at what launching it from Earth would cost ($${Math.round(waterPrice(DEFAULTS)).toLocaleString('en-US')}/kg) — a market that does not exist yet. A single trip never pays for its spacecraft, cheaper rockets also make asteroid water cheaper, and ${metalLed ? `only ${metalLed} asteroid${metalLed > 1 ? 's' : ''} pay${metalLed > 1 ? '' : 's'} off by bringing metals back to Earth` : 'bringing metals back to Earth does not pay off for any asteroid in the model'}.`],
  ...(psyche ? [['Is 16 Psyche really worth $10 quintillion?', `Headline figures value the whole asteroid at today's metal prices. A real mission brings back a few hundred tonnes per trip, and selling large amounts of a rare metal would crash its price. In Astromine, Psyche ranks #${psyche.rank.toLocaleString('en-US')} with an expected ${money(psyche.ev.profit)} per trip.`]] : []),
  ['Where does the data come from?', 'Orbits, sizes, spectral types, radar data and close approaches: NASA/JPL Small-Body Database and Close-Approach API. Optimised round trips: NASA NHATS and Astromine’s own Lambert solver. Composition classes: SsODNet (Berthier et al. 2023). Prices: gold-api.com and Umicore. Photos: Wikimedia Commons.'],
  ['How accurate are the numbers?', `They are first-order estimates. Composition is inferred from asteroid type and meteorite analogues. Every object carries a data-quality badge: ${evc('sample')} Confirmed by a spacecraft, ${evc('measured')} Measured by spectrum, ${evc('inferred')} Estimated from brightness and ${evc('assumed')} Guess. Treat Guess rankings as hypotheses.`],
];
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const faqLd = ld({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const aboutTitle = 'Asteroid mining explained — how Astromine ranks real asteroids';
const aboutDesc = `How profitable is asteroid mining? Astromine ranks ${NF} real asteroids by mining profit using NASA/JPL data, exact trajectories and live metal prices. Methods, sources and FAQ.`;
const aboutHtml = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(aboutTitle)}</title>`)
  .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(aboutDesc)}">`)
  .replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="https://astromine.live/about/">')
  .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(aboutTitle)}">`)
  .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(aboutDesc)}">`)
  .replace('</style>', '  .report h3{font-size:15px;text-transform:none;letter-spacing:0;color:var(--text);margin:24px 0 4px} .report p{line-height:1.6}\n</style>')
  .replace('</head>', `${faqLd}\n</head>`)
  .replace(/<nav class="tabs">[\s\S]*?<\/nav>/, '<nav class="tabs"><a href="../" class="tabl">Map</a><a href="../report/" class="tabl">Report</a><a href="./" class="tabl on">Guide</a></nav>')
  .replace(/<main[\s\S]*<\/main>/, `<main class="page report prose" style="position:static">
<h1>Asteroid mining, explained with real data</h1>
<p class="lead">Astromine is a live map of ${NF} real asteroids ranked by what a mining mission would earn. Right now <b>${PF}</b> of them would turn a profit under default assumptions.</p>
<a class="cta" href="../">Open the live map →</a>
<h2>FAQ</h2>
${FAQ.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('\n')}
<p class="muted">Figures updated ${esc(updated)}.</p>
${GUIDE_HTML.replace(/<h2>/g, '<h3>').replace(/<\/h2>/g, '</h3>').replace('<h1>How it works</h1>', '<h2>How it works</h2>')}
</main>`)
  .replace('<script type="module" src="../js/report-live.js"></script>\n', '');
await mkdir(new URL('about/', ROOT), { recursive: true });
await writeFile(new URL('about/index.html', ROOT), aboutHtml);

await writeFile(new URL('llms.txt', ROOT), `# Astromine

> Astromine (https://astromine.live) is a free, live, interactive map of ${NF} real asteroids that ranks each one from Common to Mythic by the expected profit of a mining mission, using NASA/JPL orbit data, exact round-trip trajectories computed hourly, and live metal prices. It is an exploration and education tool, not investment advice.

Snapshot updated ${updated}:
- Profitable under default assumptions: ${PF} of ${NF} tracked asteroids (${waterLed === prof.length ? 'all' : `${waterLed} of them`} from water sold as rocket fuel at an Earth–Moon L1 depot, valued at the cost of launching Earth water there: $${Math.round(waterPrice(DEFAULTS)).toLocaleString('en-US')}/kg; spacecraft reused for ${DEFAULTS.trips} trips)
- Top targets: ${top3.join('; ')}
${psyche ? `- 16 Psyche: rank #${psyche.rank.toLocaleString('en-US')} (${money(psyche.ev.profit)} per trip) — headline "$10 quintillion" values ignore cargo limits and price collapse\n` : ''}
## Pages
- [Live map](https://astromine.live/): every asteroid at its real current position; click any object for composition, trajectory, costs and profit; adjust launch cost, Earth vs Moon launch and other assumptions
- [Monthly report](https://astromine.live/report/): top 10 mining targets, launch windows, close approaches, metal prices (updated hourly)
- [Guide and FAQ](https://astromine.live/about/): methods, data sources, accuracy

## Data sources
- NASA/JPL Small-Body Database, Close-Approach Data, NHATS
- SsODNet ssoBFT (Berthier et al. 2023, A&A 671, A151)
- gold-api.com (Au, Pt, Pd, Cu), Umicore (Rh, Ir, Ru)
- Source code: https://github.com/mauki65/astromine (MIT)
`);
await writeFile(new URL('sitemap.xml', ROOT), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://astromine.live/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://astromine.live/report/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://astromine.live/about/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>
</urlset>
`);
const top = ranked.find(o => !o.comet);
console.log(`report: top=${top?.name} profit=${top?.ev.profit.toFixed(0)}`);
