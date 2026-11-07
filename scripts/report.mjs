// Builds report/index.html – an auto-generated "launch windows" page – from the data files.
// Runs after fetch-data.mjs in the GitHub Action. Uses the same model as the web app.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { MATERIALS, ORDER, TIERS, DEFAULTS, EVIDENCE, prepare, evaluate, assignTiers, applyNhats } from '../js/model.js';
import { body, porkchop, depLEO, depMoon } from '../js/lambert.js';
import { jdNow, planetElements } from '../js/orbits.js';

const ROOT = new URL('../', import.meta.url);
const read = async f => JSON.parse(await readFile(new URL(f, ROOT), 'utf8'));
const tryRead = async (f, d) => { try { return await read(f); } catch { return d; } };

const [ast, com, nh, pr, ca] = await Promise.all([
  read('data/asteroids.json'), tryRead('data/comets.json', { rows: [], fields: [] }),
  tryRead('data/nhats.json', { list: {} }), read('data/prices.json'), tryRead('data/close-approaches.json', { list: [] }),
]);
const prices = Object.fromEntries(ORDER.map(k => [k, pr.metals[k]?.usdPerKg || 0]));
const S = { ...DEFAULTS };
const short = n => n.replace(/^\((.*)\)$/, '$1');
const NH = nh.list || {};
const cad = new Map(); for (const c of ca.list || []) if (!cad.has(c.des)) cad.set(c.des, c);

const mk = F => r => {
  const o = prepare(r, F);
  const num = o.name.match(/^(\d+)\s/)?.[1], prov = o.name.match(/\(([^)]+)\)/)?.[1];
  const n = NH[num] || NH[prov] || NH[short(o.name)];
  if (n && !o.comet) applyNhats(o, n);
  o.keys = [num, prov, short(o.name)].filter(Boolean);
  o.ca = o.keys.map(k => cad.get(k)).find(Boolean) || null;
  return o;
};
const A = ast.rows.map(mk(ast.fields)), C = com.rows.map(mk(com.fields));
for (const o of [...A, ...C]) o.ev = evaluate(o, S, prices);
const ranked = assignTiers(A, C);

// exact Lambert best window for the top 12 asteroids, then re-sort
const jd = jdNow(), pe = planetElements('Earth', jd);
const earth = body(pe.a, pe.e, pe.i, pe.om, pe.w, pe.M, jd);
const top = ranked.filter(o => !o.comet).slice(0, 12);
for (const o of top) {
  if (o.Q > 6) continue;
  const M = o.ma * Math.PI / 180 + Math.sqrt(2.9591220828559e-4 / o.a ** 3) * (jd - o.epoch);
  const r = porkchop(earth, body(o.a, o.e, o.i, o.om, o.w, M, jd), jd, { stayDays: S.stayMonths * 30.44, step: 10 });
  if (!r) continue;
  o.lam = r;
  Object.assign(o.dv, { leo: depLEO(r.vinf), moon: depMoon(r.vinf), dvArr: r.arr, ret: r.d3, transferYr: (r.tof + r.tofRet) / 2 / 365.25, src: 'lambert' });
  o.ev = evaluate(o, S, prices);
}
top.sort((a, b) => b.ev.profit - a.ev.profit);

// ---------- history (daily snapshot, 120 days) ----------
const today = new Date().toISOString().slice(0, 10);
const hist = await tryRead('data/history.json', { days: {} });
hist.days[today] = {
  prices: Object.fromEntries(ORDER.map(k => [k, +prices[k].toPrecision(6)])),
  ranks: Object.fromEntries(ranked.filter(o => !o.comet).slice(0, 200).map(o => [o.name, o.rank])),
};
const days = Object.keys(hist.days).sort();
for (const d of days.slice(0, Math.max(0, days.length - 120))) delete hist.days[d];
await writeFile(new URL('data/history.json', ROOT), JSON.stringify(hist));
const ref = days.filter(d => d < today).reverse().find(d => (Date.parse(today) - Date.parse(d)) >= 7 * 864e5) || days.filter(d => d < today).pop();
const past = ref ? hist.days[ref] : null;

// ---------- formatting ----------
const money = v => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}k` : `${s}$${a.toFixed(0)}`; };
const dist = km => km >= 1 ? km.toPrecision(3) + ' km' : Math.round(km * 1000) + ' m';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const jdDate = j => new Date((j - 2440587.5) * 864e5).toISOString().slice(0, 10);
const link = o => `../?obj=${encodeURIComponent(short(o.name))}`;
const tierTag = t => `<span class="tag" style="--c:${t.color}">${t.label}</span>`;
const ev = o => `<span class="evd" style="background:${EVIDENCE[o.evidence].color}" title="${EVIDENCE[o.evidence].note}"></span>${EVIDENCE[o.evidence].label}`;
const pct = (a, b) => b ? ((a / b - 1) * 100) : null;
const chg = v => v == null ? '<span class="muted">–</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;

// ---------- sections ----------
const profitable = ranked.filter(o => o.ev.profit > 0 && !o.comet).length;
const best = top[0];
const lead = best
  ? `At today’s metal prices and default mission costs, <b>${profitable.toLocaleString()}</b> of ${A.length.toLocaleString()} tracked asteroids would turn a profit. The best target is <b>${esc(short(best.name))}</b> at an expected <b>${money(best.ev.profit)}</b> per mission${best.lam ? `, with its cheapest launch window on <b>${jdDate(best.lam.t0)}</b>` : ''}.`
  : 'No data.';

const topRows = top.slice(0, 10).map((o, k) => {
  const prev = past?.ranks?.[o.name];
  const mv = prev ? prev - o.rank : null;
  return `<tr>
    <td class="num">${k + 1}</td>
    <td><a href="${link(o)}"><b>${esc(short(o.name))}</b></a><div class="muted">${o.cls}-type · ${dist(o.D)} · ${ev(o)}${o.radar ? ' · radar' : ''}</div></td>
    <td>${tierTag(o.tier)}</td>
    <td class="num ${o.ev.profit > 0 ? 'pos' : 'neg'}">${money(o.ev.profit)}</td>
    <td class="num">${(o.ev.dvOut + o.ev.dvRet).toFixed(2)} km/s</td>
    <td class="num">${o.lam ? jdDate(o.lam.t0) : '–'}</td>
    <td class="num">${mv == null ? '<span class="muted">new</span>' : mv === 0 ? '<span class="muted">=</span>' : `<span class="${mv > 0 ? 'pos' : 'neg'}">${mv > 0 ? '▲' : '▼'} ${Math.abs(mv)}</span>`}</td>
  </tr>`;
}).join('');

const now = Date.now();
const upcoming = (ca.list || []).filter(c => { const t = Date.parse(c.date.replace(/-(\w{3})-/, ' $1 ')); return t > now && t < now + 60 * 864e5; });
const byKey = new Map(); for (const o of A) for (const k of o.keys) byKey.set(k, o);
const caRanked = upcoming.filter(c => byKey.has(c.des)), caOther = upcoming.length - caRanked.length;
const caRows = caRanked.map(c => {
  const o = byKey.get(c.des);
  return `<tr><td class="num">${esc(c.date.slice(0, 11))}</td>
    <td>${o ? `<a href="${link(o)}">${esc(c.des)}</a>` : esc(c.des)}</td>
    <td class="num">${(c.distAU * 389.17).toFixed(1)} LD</td>
    <td class="num">${c.vRel.toFixed(1)} km/s</td>
    <td>${o ? tierTag(o.tier) : '<span class="muted">not ranked</span>'}</td></tr>`;
}).join('') + (caOther ? `<tr><td colspan="5" class="muted">+ ${caOther} smaller object${caOther > 1 ? 's' : ''} (under ~25 m, not ranked)</td></tr>` : '') || '<tr><td colspan="5" class="muted">No close approaches within 0.05 AU in the next 60 days.</td></tr>';

let movers = '';
if (past) {
  const arr = ranked.filter(o => !o.comet).slice(0, 200).map(o => ({ o, d: (past.ranks[o.name] || 999) - o.rank })).filter(x => x.d !== 0 && past.ranks[x.o.name]);
  const up = arr.sort((a, b) => b.d - a.d).slice(0, 5);
  movers = up.length ? `<ul>${up.map(x => `<li><a href="${link(x.o)}">${esc(short(x.o.name))}</a> <span class="pos">▲ ${x.d}</span> to #${x.o.rank}</li>`).join('')}</ul>` : '<p class="muted">No rank changes in the top 200.</p>';
} else movers = '<p class="muted">Tracking started today — weekly movers appear after the first week.</p>';

const priceRows = ORDER.filter(k => k !== 'water').map(k => {
  const p = prices[k], old = past?.prices?.[k];
  return `<tr><td>${MATERIALS[k].name}</td><td class="num">$${p.toLocaleString('en-US', { maximumFractionDigits: p < 100 ? 2 : 0 })}/kg</td><td class="num">${chg(pct(p, old))}</td></tr>`;
}).join('');

const tierCounts = TIERS.map(t => `${t.label} ${ranked.filter(o => !o.comet && o.tier.key === t.key).length.toLocaleString()}`).join(' · ');
const updated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const title = `Asteroid mining launch windows — ${new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })}`;
const desc = best ? `Best asteroid mining target now: ${short(best.name)} (${money(best.ev.profit)}/mission). ${profitable} profitable of ${A.length.toLocaleString()} tracked, live NASA data.` : '';

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
<nav class="tabs"><a href="../" class="tabl">Map</a><a href="./" class="tabl on">Report</a></nav>
<div class="status">Updated ${updated}</div></header>
<main class="page report" style="position:static">
  <h1>${esc(title)}</h1>
  <p class="muted">Auto-generated from NASA/JPL data and live metal prices · refreshed hourly · ${tierCounts}</p>
  <p class="lead">${lead}</p>
  <a class="cta" href="../">Open the live map →</a>

  <h2>Top 10 targets right now</h2>
  <p class="muted">Default mission: launch from low Earth orbit at $${S.costEarth}/kg, ${S.stayMonths}-month stay, ${S.returnCap} t cargo back. Launch dates are Lambert-optimised over the next 10 years. Change the assumptions on the map.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>#</th><th>Object</th><th>Tier</th><th style="text-align:right">Profit / mission</th><th style="text-align:right">Δv round trip</th><th style="text-align:right">Best launch</th><th style="text-align:right">vs last week</th></tr></thead>
    <tbody>${topRows}</tbody></table></div>

  <div class="cols">
    <div>
      <h2>Close approaches, next 60 days</h2>
      <div class="tablewrap"><table><thead><tr><th>Date (TDB)</th><th>Object</th><th style="text-align:right">Distance</th><th style="text-align:right">Speed</th><th>Tier</th></tr></thead><tbody>${caRows}</tbody></table></div>
    </div>
    <div>
      <h2>Metal prices${ref ? ` (change since ${ref})` : ''}</h2>
      <div class="tablewrap"><table><thead><tr><th>Metal</th><th style="text-align:right">Price</th><th style="text-align:right">Change</th></tr></thead><tbody>${priceRows}</tbody></table></div>
      <h2>Biggest climbers in the ranking</h2>
      ${movers}
    </div>
  </div>

  <h2>About this report</h2>
  <p class="muted">Orbits, sizes, spectral types and close approaches come from the NASA/JPL Small-Body Database; round-trip Δv from NASA’s NHATS where available. Composition is inferred from asteroid type and meteorite analogues — only a handful of asteroids have been visited. Prices: gold-api.com (Au, Ag, Pt, Pd, Cu), Umicore (Rh, Ir, Ru), reference values for the rest. This is an exploration tool, not investment advice.</p>
</main>
</body></html>`;

await mkdir(new URL('report/', ROOT), { recursive: true });
await writeFile(new URL('report/index.html', ROOT), html);
await writeFile(new URL('sitemap.xml', ROOT), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mauki65.github.io/astromine/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://mauki65.github.io/astromine/report/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>
</urlset>
`);
console.log(`report: top=${best ? short(best.name) : '-'} profitable=${profitable}`);
