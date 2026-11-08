// Report renderer shared by the hourly job (static HTML for search engines) and the
// report page in the browser (re-renders with live prices). Same pipeline as the map.
import { MATERIALS, ORDER, TIERS, DEFAULTS, EVIDENCE } from './model.js';
import { shortName as short } from './pipeline.js';

const money = v => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}k` : `${s}$${a.toFixed(0)}`; };
const dist = km => km >= 1 ? km.toPrecision(3) + ' km' : Math.round(km * 1000) + ' m';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const jdDate = j => new Date((j - 2440587.5) * 864e5).toISOString().slice(0, 10);
const link = o => `../?obj=${encodeURIComponent(short(o.name))}`;
const tierTag = t => `<span class="tag" style="--c:${t.color}">${t.label}</span>`;
const ev = o => `<span class="evd" style="background:${EVIDENCE[o.evidence].color}" title="${EVIDENCE[o.evidence].note}"></span>${EVIDENCE[o.evidence].label}`;
const pct = (a, b) => b ? ((a / b - 1) * 100) : null;
const chg = v => v == null ? '<span class="muted">–</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;

export function titleFor(date = new Date()) {
  return `Asteroid mining launch windows — ${date.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

// past = history snapshot to compare against ({ prices, ranks }), refDate its date
export function renderReport({ ranked, prices, cadList = [], past = null, refDate = null, live = false, updated, coverage }) {
  const S = DEFAULTS;
  const A = ranked.filter(o => !o.comet);
  const profitable = A.filter(o => o.ev.profit > 0).length;
  const top = A.slice(0, 10), best = top[0];
  const lead = best
    ? `At ${live ? 'live' : 'current'} metal prices and default mission costs, <b>${profitable.toLocaleString()}</b> of ${A.length.toLocaleString()} tracked asteroids would turn a profit. The best target is <b>${esc(short(best.name))}</b> at an expected <b>${money(best.ev.profit)}</b> per mission${best.lam ? `, with its cheapest launch window on <b>${jdDate(best.lam.t0)}</b>` : ''}.`
    : 'No data.';
  const desc = best ? `Best asteroid mining target now: ${short(best.name)} (${money(best.ev.profit)}/mission). ${profitable} profitable of ${A.length.toLocaleString()} tracked, live NASA data.` : '';

  const topRows = top.map(o => {
    const prev = past?.ranks?.[o.name], mv = prev ? prev - o.rank : null;
    return `<tr>
    <td class="num">${o.rank}</td>
    <td><a href="${link(o)}"><b>${esc(short(o.name))}</b></a><div class="muted">${o.cls}-type · ${dist(o.D)} · ${ev(o)}${o.radar ? ' · radar' : ''}</div></td>
    <td>${tierTag(o.tier)}</td>
    <td class="num ${o.ev.profit > 0 ? 'pos' : 'neg'}">${money(o.ev.profit)}</td>
    <td class="num">${(o.ev.dvOut + o.ev.dvRet).toFixed(2)} km/s</td>
    <td class="num">${o.lam ? jdDate(o.lam.t0) : '<span class="muted">pending</span>'}</td>
    <td class="num">${mv == null ? '<span class="muted">new</span>' : mv === 0 ? '<span class="muted">=</span>' : `<span class="${mv > 0 ? 'pos' : 'neg'}">${mv > 0 ? '▲' : '▼'} ${Math.abs(mv)}</span>`}</td>
  </tr>`;
  }).join('');

  const now = Date.now();
  const upcoming = cadList.filter(c => { const t = Date.parse(c.date.replace(/-(\w{3})-/, ' $1 ')); return t > now && t < now + 60 * 864e5; });
  const byKey = new Map(); for (const o of A) for (const k of o.keys || []) byKey.set(k, o);
  const caRanked = upcoming.filter(c => byKey.has(c.des)), caOther = upcoming.length - caRanked.length;
  const caRows = caRanked.map(c => {
    const o = byKey.get(c.des);
    return `<tr><td class="num">${esc(c.date.slice(0, 11))}</td><td><a href="${link(o)}">${esc(c.des)}</a></td>
    <td class="num">${(c.distAU * 389.17).toFixed(1)} LD</td><td class="num">${c.vRel.toFixed(1)} km/s</td><td>${tierTag(o.tier)}</td></tr>`;
  }).join('') + (caOther ? `<tr><td colspan="5" class="muted">+ ${caOther} smaller object${caOther > 1 ? 's' : ''} (under ~25 m, not ranked)</td></tr>` : '')
    || '<tr><td colspan="5" class="muted">No close approaches within 0.05 AU in the next 60 days.</td></tr>';

  let movers;
  if (past) {
    const up = A.slice(0, 200).map(o => ({ o, d: (past.ranks[o.name] || 0) - o.rank })).filter(x => past.ranks[x.o.name] && x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
    movers = up.length ? `<ul>${up.map(x => `<li><a href="${link(x.o)}">${esc(short(x.o.name))}</a> <span class="pos">▲ ${x.d}</span> to #${x.o.rank}</li>`).join('')}</ul>` : '<p class="muted">No rank changes in the top 200.</p>';
  } else movers = '<p class="muted">Tracking started today — weekly movers appear after the first week.</p>';

  const priceRows = ORDER.filter(k => k !== 'water').map(k => {
    const p = prices[k], old = past?.prices?.[k];
    return `<tr><td>${MATERIALS[k].name}</td><td class="num">$${p.toLocaleString('en-US', { maximumFractionDigits: p < 100 ? 2 : 0 })}/kg</td><td class="num">${chg(pct(p, old))}</td></tr>`;
  }).join('');
  const tierCounts = TIERS.map(t => `${t.label} ${A.filter(o => o.tier.key === t.key).length.toLocaleString()}`).join(' · ');
  const cov = coverage ? ` · exact trajectories for ${coverage.computed.toLocaleString()} candidates${coverage.pending ? ` (${coverage.pending.toLocaleString()} queued)` : ''}` : '';

  const main = `
  <h1>${esc(titleFor())}</h1>
  <p class="muted">${live ? '<span class="live"></span>Live · ' : ''}Updated ${esc(updated)} · same data and maths as the map${cov}</p>
  <p class="muted">${tierCounts}</p>
  <p class="lead">${lead}</p>
  <a class="cta" href="../">Open the live map →</a>

  <h2>Top 10 targets right now</h2>
  <p class="muted">Default mission: launch from low Earth orbit at $${S.costEarth}/kg, ${S.stayMonths}-month stay, ${S.returnCap} t cargo back. Launch dates are exact trajectories over the next 10 years. <b>Key assumption:</b> water-rich asteroids earn mostly from water, valued at $${Math.round(prices.water || 0).toLocaleString('en-US')}/kg as rocket propellant delivered in Earth orbit — no such market exists yet. Change the assumptions on the map.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>#</th><th>Object</th><th>Tier</th><th style="text-align:right">Profit / mission</th><th style="text-align:right">Δv round trip</th><th style="text-align:right">Best launch</th><th style="text-align:right">vs last week</th></tr></thead>
    <tbody>${topRows}</tbody></table></div>

  <div class="cols">
    <div>
      <h2>Close approaches, next 60 days</h2>
      <div class="tablewrap"><table><thead><tr><th>Date (TDB)</th><th>Object</th><th style="text-align:right">Distance</th><th style="text-align:right">Speed</th><th>Tier</th></tr></thead><tbody>${caRows}</tbody></table></div>
    </div>
    <div>
      <h2>Metal prices${refDate ? ` (change since ${refDate})` : ''}</h2>
      <div class="tablewrap"><table><thead><tr><th>Metal</th><th style="text-align:right">Price</th><th style="text-align:right">Change</th></tr></thead><tbody>${priceRows}</tbody></table></div>
      <h2>Biggest climbers in the ranking</h2>
      ${movers}
    </div>
  </div>

  <h2>About this report</h2>
  <p class="muted">Orbits, sizes, spectral types, radar measurements and close approaches come from the NASA/JPL Small-Body Database; round-trip trajectories are computed hourly for every mining candidate (NASA NHATS and a Hohmann estimate fill in for the rest). Composition is inferred from asteroid type and meteorite analogues — only a handful of asteroids have been visited. Prices: gold-api.com (Au, Ag, Pt, Pd, Cu, live), Umicore (Rh, Ir, Ru), reference values for the rest. This is an exploration tool, not investment advice.</p>`;
  return { title: titleFor(), desc, main };
}

// pick the history snapshot ~7 days back (or the oldest earlier one)
export function pickPast(hist, today) {
  const days = Object.keys(hist?.days || {}).sort().filter(d => d < today);
  const ref = [...days].reverse().find(d => (Date.parse(today) - Date.parse(d)) >= 7 * 864e5) || days[days.length - 1];
  return ref ? { past: hist.days[ref], refDate: ref } : { past: null, refDate: null };
}
