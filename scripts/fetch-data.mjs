// Pulls asteroid orbits (NASA/JPL SBDB), upcoming close approaches (JPL CAD)
// and metal prices (gold-api.com live spot + Umicore PGM daily), writes /data/*.json.
// Runs in GitHub Actions (Node 20+). No API keys needed.
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const DATA = new URL('../data/', import.meta.url);
const UA = { 'User-Agent': 'astromine-data-bot (github actions)' };
await mkdir(DATA, { recursive: true });

const r6 = v => (v === null || v === '' || v === undefined) ? null : +(+v).toPrecision(7);

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// ---------- Asteroids ----------
const FIELDS = 'full_name,a,e,i,om,w,ma,epoch,H,diameter,albedo,spec_B,spec_T,neo,pha,class,moid';
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
    // Big bodies Venus..Jupiter
    sbdb({ 'sb-cdata': JSON.stringify({ AND: ['a|LT|5.6', 'diameter|GT|12'] }) }),
    // Anything with a measured spectral type (composition evidence)
    sbdb({ 'sb-cdata': JSON.stringify({ AND: ['a|LT|5.6', 'spec_B|DF'] }) }),
    sbdb({ 'sb-cdata': JSON.stringify({ AND: ['a|LT|5.6', 'spec_T|DF'] }) }),
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
    ]);
  }
  const rows = [...seen.values()];
  await writeFile(new URL('asteroids.json', DATA), JSON.stringify({
    generated: new Date().toISOString(),
    source: 'NASA/JPL Small-Body Database (ssd-api.jpl.nasa.gov)',
    fields: ['name', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'H', 'diameter', 'albedo', 'spec_B', 'spec_T', 'neo', 'pha', 'class', 'moid'],
    rows,
  }));
  console.log(`asteroids.json: ${rows.length} objects`);
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
  const set = (k, usdPerKg, source, asOf = now) => {
    if (!(usdPerKg > 0)) return;
    p[k] = { ...(p[k] || {}), usdPerKg: +usdPerKg.toPrecision(6), source, asOf };
  };

  // Live spot (gold-api.com): XAU XAG XPT XPD per ozt, HG per lb
  for (const [sym, key, conv] of [['XAU', 'Au', 1 / OZT], ['XAG', 'Ag', 1 / OZT], ['XPT', 'Pt', 1 / OZT], ['XPD', 'Pd', 1 / OZT], ['HG', 'Cu', 2.20462]]) {
    try { const j = await getJSON(`https://api.gold-api.com/price/${sym}`); set(key, j.price * conv, 'gold-api.com spot', j.updatedAt || now); }
    catch (e) { console.warn('gold-api', sym, e.message); }
  }

  // Umicore daily PGM prices (Rh, Ir, Ru) – scraped from public price page
  try {
    const res = await fetch('https://pmm.umicore.com/en/prices/', { headers: UA });
    const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    for (const [name, key] of [['Rhodium', 'Rh'], ['Iridium', 'Ir'], ['Ruthenium', 'Ru']]) {
      const m = text.match(new RegExp(name + '[^0-9]{0,120}?([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]+)?)'));
      if (m) set(key, parseFloat(m[1].replace(/,/g, '')) / OZT, 'Umicore daily price');
    }
  } catch (e) { console.warn('umicore', e.message); }

  await writeFile(new URL('prices.json', DATA), JSON.stringify({ ...prev, generated: now, metals: p }, null, 2));
  console.log('prices.json updated');
}

const results = await Promise.allSettled([asteroids(), closeApproaches(), prices()]);
for (const r of results) if (r.status === 'rejected') console.error(r.reason);
if (results[0].status === 'rejected') process.exit(1);
