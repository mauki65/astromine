// Pulls asteroid orbits (NASA/JPL SBDB), upcoming close approaches (JPL CAD)
// and metal prices (gold-api.com live spot + Umicore PGM daily), writes /data/*.json.
// Runs in GitHub Actions (Node 20+). No API keys needed.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { PRICE_BOUNDS } from '../js/pipeline.js';

const DATA = new URL('../data/', import.meta.url);
const UA = { 'User-Agent': 'astromine-data-bot (github actions)' };
await mkdir(DATA, { recursive: true });

const r6 = v => (v === null || v === '' || v === undefined) ? null : +(+v).toPrecision(7);

// Columnar, precision-trimmed encoding (~20% smaller gzipped); decoded by js/pipeline.js decodeRows().
// Orbit angles to 1e-5 relative precision → position error far below map resolution.
const PREC = { a: 6, e: 5, i: 5, om: 5, w: 5, ma: 5, H: 3, diameter: 3, albedo: 3, moid: 3 };
function compact(rows, fields, meta) {
  const cols = {}, sparse = {};
  fields.forEach((f, j) => {
    let col = rows.map(r => r[j] ?? null);
    if (PREC[f]) col = col.map(v => v == null ? null : +(+v).toPrecision(PREC[f]));
    const filled = col.filter(v => v !== null && v !== 0).length;
    if (filled < rows.length * 0.3) sparse[f] = Object.fromEntries(col.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== 0));
    else cols[f] = col;
  });
  return { ...meta, n: rows.length, fields, cols, sparse };
}

async function getJSON(url, tries = 3) {
  for (let k = 1; ; k++) {
    const res = await fetch(url, { headers: UA }).catch(e => ({ ok: false, status: e.message }));
    if (res.ok) return res.json();
    // NASA/JPL APIs occasionally return 502/503 under load: back off and retry
    if (k >= tries || (typeof res.status === 'number' && res.status < 500)) throw new Error(`${res.status} ${url}`);
    await new Promise(r => setTimeout(r, 5000 * k));
  }
}

// ---------- Asteroids ----------
const FIELDS = 'full_name,a,e,i,om,w,ma,epoch,H,diameter,albedo,spec_B,spec_T,neo,pha,class,moid,n_del_obs_used,n_dop_obs_used';
const SBDB = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';

async function sbdb(params) {
  const q = new URLSearchParams({ fields: FIELDS, 'sb-kind': 'a', ...params });
  const j = await getJSON(`${SBDB}?${q}`);
  console.log(`sbdb ${JSON.stringify(params)} -> ${j.count}`);
  return j.data || [];
}

async function asteroids() {
  const sets = await Promise.all([
    // Near-Earth asteroids down to ~25 m (H<=25.5)
    sbdb({ 'sb-group': 'neo', 'sb-cdata': JSON.stringify({ AND: ['H|LE|25.5'] }) }),
    // Big bodies Venus..Saturn (~11 AU)
    sbdb({ 'sb-cdata': JSON.stringify({ AND: ['a|LT|11', 'diameter|GT|12'] }) }),
    // Anything with a measured spectral type (composition evidence)
    sbdb({ 'sb-cdata': JSON.stringify({ AND: ['a|LT|11', 'spec_B|DF'] }) }),
    sbdb({ 'sb-cdata': JSON.stringify({ AND: ['a|LT|11', 'spec_T|DF'] }) }),
    // Jupiter Trojans (L4/L5) brighter than H 15.5 (~>10 km), and Centaurs
    sbdb({ 'sb-class': 'TJN', 'sb-cdata': JSON.stringify({ AND: ['H|LE|15.5'] }) }).catch(e => (console.warn('TJN', e.message), [])),
    sbdb({ 'sb-class': 'CEN', 'sb-cdata': JSON.stringify({ AND: ['a|LT|11'] }) }).catch(e => (console.warn('CEN', e.message), [])),
  ]);
  const seen = new Map();
  for (const rows of sets) for (const r of rows) {
    const name = (r[0] || '').trim();
    if (!name || seen.has(name)) continue;
    const a = +r[1], e = +r[2];
    if (!(a > 0) || !(e < 1)) continue;
    seen.set(name, [
      name, r6(a), r6(e), r6(r[3]), r6(r[4]), r6(r[5]), r6(r[6]), r6(r[7]),
      r6(r[8]), r6(r[9]), r6(r[10]), r[11] || null, r[12] || null,
      r[13] === 'Y' ? 1 : 0, r[14] === 'Y' ? 1 : 0, r[15] || null, r6(r[16]),
      (+r[17] || 0) + (+r[18] || 0),  // number of radar delay + Doppler measurements
    ]);
  }
  const rows = [...seen.values()];
  await writeFile(new URL('asteroids.json', DATA), JSON.stringify(compact(rows,
    ['name', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'H', 'diameter', 'albedo', 'spec_B', 'spec_T', 'neo', 'pha', 'class', 'moid', 'radar'],
    { generated: new Date().toISOString(), source: 'NASA/JPL Small-Body Database (ssd-api.jpl.nasa.gov)' })));
  console.log(`asteroids.json: ${rows.length} objects`);
}

// ---------- Short-period comets (Jupiter-family, Encke, Chiron, Halley types) ----------
async function comets() {
  const q = new URLSearchParams({
    fields: 'full_name,q,e,i,om,w,tp,epoch,M2,diameter,albedo,class,moid',
    'sb-kind': 'c', 'sb-class': 'JFc,ETc,CTc,HTC',
  });
  const j = await getJSON(`${SBDB}?${q}`);
  console.log(`comets -> ${j.count}`);
  const seen = new Map();
  for (const r of j.data || []) {
    const name = (r[0] || '').trim(), qq = +r[1], e = +r[2];
    if (!name || !(qq > 0) || !(e < 0.99)) continue;
    const a = qq / (1 - e);
    if (a > 30) continue;
    const epoch = +r[7] || +r[6], tp = +r[6];
    const ma = ((0.9856076686 / Math.pow(a, 1.5)) * (epoch - tp)) % 360;
    // keep only the latest apparition per designation (names repeat across fits)
    const key = name.replace(/-[A-Z]$/, '');
    if (seen.has(key)) continue;
    seen.set(key, [name, r6(a), r6(e), r6(r[3]), r6(r[4]), r6(r[5]), r6((ma + 360) % 360), r6(epoch),
      r6(r[8]), r6(r[9]), r6(r[10]), null, null, qq < 1.3 ? 1 : 0, 0, r[11] || null, r6(r[12]), 1]);
  }
  const rows = [...seen.values()];
  await writeFile(new URL('comets.json', DATA), JSON.stringify({
    generated: new Date().toISOString(),
    source: 'NASA/JPL Small-Body Database – short-period comets',
    fields: ['name', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'H', 'diameter', 'albedo', 'spec_B', 'spec_T', 'neo', 'pha', 'class', 'moid', 'comet'],
    rows,
  }));
  console.log(`comets.json: ${rows.length}`);
}

// ---------- NASA NHATS: optimised round-trip Δv for accessible near-Earth asteroids ----------
async function nhats() {
  const out = {};
  for (const launch of ['2025-2030', '2030-2035', '2035-2040']) {
    const j = await getJSON(`https://ssd-api.jpl.nasa.gov/nhats.api?dv=12&dur=450&stay=8&launch=${launch}`);
    for (const r of j.data || []) {
      const dv = +r.min_dv?.dv, dur = +r.min_dv?.dur;
      if (!(dv > 0)) continue;
      if (!out[r.des] || dv < out[r.des].dv) out[r.des] = { dv, dur, w: launch };
    }
  }
  await writeFile(new URL('nhats.json', DATA), JSON.stringify({
    generated: new Date().toISOString(),
    source: 'NASA/JPL NHATS (dv<=12 km/s, dur<=450 d, stay>=8 d)', list: out,
  }));
  console.log(`nhats.json: ${Object.keys(out).length}`);
}

// ---------- Close approaches (next 120 days, < 0.05 AU) ----------
async function closeApproaches() {
  const j = await getJSON('https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B120&dist-max=0.05&sort=date');
  const f = j.fields, idx = k => f.indexOf(k);
  const list = (j.data || []).map(r => ({
    des: r[idx('des')], date: r[idx('cd')], distAU: +r[idx('dist')], vRel: +r[idx('v_rel')], H: +r[idx('h')],
  }));
  await writeFile(new URL('close-approaches.json', DATA), JSON.stringify({
    generated: new Date().toISOString(), source: 'NASA/JPL SBDB Close-Approach Data API', list,
  }));
  console.log(`close-approaches.json: ${list.length}`);
}

// ---------- Prices ($/kg) ----------
const OZT = 0.0311034768; // kg per troy ounce

async function prices() {
  let prev = {};
  try { prev = JSON.parse(await readFile(new URL('prices.json', DATA), 'utf8')); } catch {}
  const p = structuredClone(prev.metals || {});
  const now = new Date().toISOString();
  // Guard against bad feed values: plausible absolute range ($/kg) and no >40% jump vs the last good value.
  const set = (k, usdPerKg, source, asOf = now) => {
    const [lo, hi] = PRICE_BOUNDS[k] || [0, Infinity], old = p[k]?.usdPerKg;
    if (!(usdPerKg >= lo && usdPerKg <= hi)) return console.warn(`price ${k}=${usdPerKg} outside ${lo}-${hi}, kept ${old}`);
    if (old && Math.abs(usdPerKg / old - 1) > 0.4) return console.warn(`price ${k} jumped ${old}→${usdPerKg}, kept old`);
    p[k] = { ...(p[k] || {}), usdPerKg: +usdPerKg.toPrecision(6), source, asOf };
  };

  // Live spot (gold-api.com): XAU XAG XPT XPD per ozt, HG per lb
  for (const [sym, key, conv] of [['XAU', 'Au', 1 / OZT], ['XAG', 'Ag', 1 / OZT], ['XPT', 'Pt', 1 / OZT], ['XPD', 'Pd', 1 / OZT], ['HG', 'Cu', 2.20462]]) {
    try { const j = await getJSON(`https://api.gold-api.com/price/${sym}`); set(key, j.price * conv, 'gold-api.com spot', j.updatedAt || now); }
    catch (e) { console.warn('gold-api', sym, e.message); }
  }

  // Umicore daily PGM prices (Rh, Ir, Ru) – scraped from the public price page.
  // Only accept a number explicitly labelled $/troz and inside a plausible range.
  try {
    const res = await fetch('https://pmm.umicore.com/en/prices/', { headers: UA });
    const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
    for (const [name, key] of [['Rhodium', 'Rh'], ['Iridium', 'Ir'], ['Ruthenium', 'Ru']]) {
      let found = null;
      for (const m of text.matchAll(new RegExp(name, 'g'))) {
        const win = text.slice(m.index, m.index + 400);
        const hit = win.match(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(?:USD|\$)\s*\/\s*tr?\.?\s*oz/i)
                 || win.match(/(?:USD|\$)\s*\/\s*tr?\.?\s*oz[^0-9]{0,40}([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)/i);
        if (hit) { found = parseFloat(hit[1].replace(/,/g, '')); break; }
      }
      const [lo, hi] = { Rh: [1000, 60000], Ir: [1000, 60000], Ru: [100, 15000] }[key]; // plausible $/troz
      if (found >= lo && found <= hi) set(key, found / OZT, 'Umicore daily price');
      else console.warn('umicore: rejected', key, found);
    }
  } catch (e) { console.warn('umicore', e.message); }

  await writeFile(new URL('prices.json', DATA), JSON.stringify({ ...prev, generated: now, metals: p }, null, 2));
  console.log('prices.json updated');
}

const results = await Promise.allSettled([asteroids(), closeApproaches(), prices(), comets(), nhats()]);
for (const r of results) if (r.status === 'rejected') console.error(r.reason);
if (results[0].status === 'rejected') process.exit(1);
