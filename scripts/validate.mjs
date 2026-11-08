// Runs in the hourly job right before publishing. Any failed check exits non-zero, the
// deploy step is skipped, and the site keeps serving the last good version (GitHub emails
// the repo owner). Covers data integrity, physics sanity, known reference objects and
// consistency between the map pipeline and the report page.
import { readFile } from 'node:fs/promises';
import { ORDER, TIERS, DEFAULTS, CLASSES } from '../js/model.js';
import { buildObjects, rankAll, pricesFrom, decodeLambert, PRICE_BOUNDS, LAM_VERSION } from '../js/pipeline.js';
import { lambert, body, stateAt, depLEO, depMoon, entrySpeed } from '../js/lambert.js';
import { jdNow, planetElements } from '../js/orbits.js';

const ROOT = new URL('../', import.meta.url);
const read = async (f, d) => { try { return JSON.parse(await readFile(new URL(f, ROOT), 'utf8')); } catch (e) { if (d !== undefined) return d; throw e; } };
const fails = [], warns = [];
const fail = m => fails.push(m), warn = m => warns.push(m);
const check = (ok, m) => { if (!ok) fail(m); };
const near = (v, ref, tol) => Math.abs(v - ref) <= tol;

const [ast, com, nh, lamRaw, pr, ca, tax] = await Promise.all([
  read('data/asteroids.json'), read('data/comets.json', null), read('data/nhats.json', null), read('data/lambert.json', null),
  read('data/prices.json'), read('data/close-approaches.json', { list: [] }), read('data/taxonomy.json', null),
]);
const lam = decodeLambert(lamRaw);

// ---------- 1. physics unit tests (catch accidental formula changes) ----------
{
  const MU = 2.9591220828559e-4, KMS = 1731.456837, nM = Math.sqrt(MU / 1.524 ** 3);
  const E = body(1, 0, 0, 0, 0, 0, 0), M = body(1.524, 0, 0, 0, 0, Math.PI - 0.01 - nM * 258.9, 0);
  const a = stateAt(E, 0), b = stateAt(M, 258.9), L = lambert(a.r, b.r, 258.9);
  const vinf = L && Math.hypot(L[0][0] - a.v[0], L[0][1] - a.v[1], L[0][2] - a.v[2]) * KMS;
  check(L && near(vinf, 2.94, 0.05), `Lambert Earth→Mars Hohmann v∞ ${vinf} ≠ 2.94 km/s`);
  check(near(depLEO(0), 3.176, 0.01), `LEO escape Δv ${depLEO(0)} ≠ 3.18`);
  check(near(depLEO(2.94), 3.62, 0.03), `LEO→Mars departure ${depLEO(2.94)} ≠ ~3.6`);
  check(near(depMoon(0), 0.72, 0.05), `LLO escape Δv ${depMoon(0)} ≠ ~0.7`);
  check(near(entrySpeed(0), 11.08, 0.01) && near(entrySpeed(4.62), 12.0, 0.02), 'entry-speed formula');
  const jd = jdNow(), pe = planetElements('Earth', jd), r = Math.hypot(...stateAt(body(pe.a, pe.e, pe.i, pe.om, pe.w, pe.M, jd), jd).r);
  check(r > 0.983 && r < 1.017, `Earth–Sun distance ${r} AU out of range`);
}

// ---------- 2. raw data integrity ----------
const n = ast.n ?? ast.rows?.length ?? 0;
check(n > 40000 && n < 200000, `asteroid count ${n} unexpected`);
check(!com || com.rows.length > 300, `comet count ${com?.rows.length} too low`);
check(!nh || Object.keys(nh.list).length > 2000, `NHATS list too small (${Object.keys(nh?.list || {}).length})`);
for (const k of ORDER) {
  const v = pr.metals[k]?.usdPerKg, [lo, hi] = PRICE_BOUNDS[k];
  check(v >= lo && v <= hi, `price ${k} = ${v} $/kg outside ${lo}–${hi}`);
}
const age = h => (Date.now() - Date.parse(h)) / 3600e3;
if (age(ast.generated) > 30) warn(`asteroid data is ${age(ast.generated).toFixed(0)} h old (JPL fetch failing?)`);

// ---------- 3. every object and every computed number ----------
const objs = buildObjects({ ast, com, nh, lam, tax, cad: ca });
const prices = pricesFrom(pr.metals);
const ranked = rankAll(objs, { ...DEFAULTS }, prices);
let bad = 0;
const fin = v => Number.isFinite(v);
for (const o of objs) {
  const e = o.ev, d = o.dv, issues = [];
  if (!(o.a > 0.3 && o.a < 40 && o.e >= 0 && o.e < 1 && o.i >= 0 && o.i <= 180)) issues.push('orbit');
  if (!(fin(o.D) && o.D > 0.001 && o.D < 1000)) issues.push(`D=${o.D}`);
  if (!(fin(o.mass) && o.mass > 0)) issues.push('mass');
  if (!CLASSES[o.cls]) issues.push(`class ${o.cls}`);
  for (const k of ['leo', 'moon', 'dvArr', 'ret']) if (!(fin(d[k]) && d[k] >= 0 && d[k] < 80)) issues.push(`dv.${k}=${d[k]}`);
  for (const k of ['revenue', 'expRevenue', 'cost', 'profit', 'launchMass']) if (!fin(e[k])) issues.push(`ev.${k}`);
  if (e.cost <= 0 || e.launchMass <= 0) issues.push('cost/launchMass ≤ 0');
  if (e.profit > 5e9) issues.push(`implausible profit ${e.profit}`);
  for (const it of e.items) if (!(it.chance >= 0 && it.chance <= 0.97 && it.kg >= 0 && fin(it.value))) issues.push(`item ${it.k}`);
  if (e.payload > DEFAULTS.returnCap * 1000 + 1) issues.push('cargo over capacity');
  if (issues.length && bad++ < 15) fail(`${o.name}: ${issues.join(', ')}`);
}
if (bad > 15) fail(`… ${bad - 15} more objects with invalid numbers`);

// ---------- 4. trajectories ----------
const now = Date.now();
let lamBad = 0, lamN = 0;
for (const o of objs) {
  const r = o.lam; if (!r) continue; lamN++;
  const t0ms = (r.t0 - 2440587.5) * 864e5;
  const ok = r.ver === LAM_VERSION && fin(r.total) && r.total > 1 && r.total < 45 && r.tof >= 20 && r.tof <= 900 && r.tofRet >= 20 && r.tofRet <= 900
    && near(r.t1, r.t0 + r.tof + r.stay, 1) && near(r.t2, r.t1 + r.tofRet, 1) && t0ms > now - 2 * 864e5 && t0ms < now + 11 * 365.25 * 864e5
    && r.vEntry >= 11 && r.vEntry <= 20.5;
  if (!ok && lamBad++ < 10) fail(`trajectory ${o.name}: ${JSON.stringify(r)}`);
}
if (lamN < 1000) warn(`only ${lamN} exact trajectories (still computing after a physics update?)`);

// ---------- 5. reference objects (independent published values) ----------
const find = s => objs.find(o => o.name.includes(s));
const ref = [
  ['Ryugu', o => o.cls === 'C' && near(o.D, 0.9, 0.1), 'C-type, ~0.9 km (Hayabusa2)'],
  ['Bennu', o => o.cls === 'C' && near(o.D, 0.49, 0.05), 'C-type, ~0.49 km (OSIRIS-REx)'],
  ['433 Eros', o => o.cls === 'S' && near(o.D, 16.8, 3), 'S-type, ~16.8 km (NEAR)'],
  ['25143 Itokawa', o => o.cls === 'S' && o.D < 0.6, 'S-type, ~0.33 km (Hayabusa)'],
  ['16 Psyche', o => o.cls === 'M' && near(o.D, 222, 30), 'M-type, ~222 km'],
  ['4 Vesta', o => o.cls === 'V' && near(o.D, 525, 30), 'V-type, ~525 km (Dawn)'],
];
for (const [s, test, desc] of ref) { const o = find(s); check(o && test(o), `reference ${s}: expected ${desc}, got ${o ? `${o.cls}, ${o.D.toFixed(2)} km` : 'missing'}`); }
// NASA NHATS vs our trajectories: ours may be cheaper (longer missions allowed) but never wildly
let worse = 0, cmp = 0;
for (const o of objs) if (o.lam && o.dv.nhats) { cmp++; if (o.lam.total > o.dv.nhats.dv + 6) worse++; }
if (cmp && worse / cmp > 0.05) fail(`${worse}/${cmp} trajectories are >6 km/s worse than NASA NHATS – optimiser regression?`);

// ---------- 6. ranking / tier logic ----------
const A = ranked.filter(o => !o.comet);
const counts = Object.fromEntries(TIERS.map(t => [t.key, A.filter(o => o.tier.key === t.key).length]));
check(Object.values(counts).reduce((a, b) => a + b, 0) === A.length, 'tier counts do not add up');
check(A.every((o, i) => o.rank === i + 1), 'ranks not sequential');
check(A.filter(o => o.tier.key === 'mythic').every(o => o.ev.profit > 0), 'unprofitable Mythic');
check(counts.mythic <= Math.ceil(A.length * 0.0002) + 1, `too many Mythic (${counts.mythic})`);
for (let i = 1; i < A.length; i++) if (A[i].ev.profit > A[i - 1].ev.profit + 1e-6) { fail(`ranking not sorted at #${i + 1}`); break; }

// ---------- 7. report page shows the same numbers ----------
try {
  const html = await readFile(new URL('report/index.html', ROOT), 'utf8');
  const first = html.match(/<tbody>\s*<tr>[\s\S]*?<b>([^<]+)<\/b>[\s\S]*?class="num (?:pos|neg)">([^<]+)</);
  const top = A[0], money = v => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}k` : `${s}$${a.toFixed(0)}`; };
  check(first && top.name.endsWith(first[1].replace(/^\((.*)\)$/, '$1')) && first[2] === money(top.ev.profit), `report top (${first?.[1]} ${first?.[2]}) ≠ map top (${top.name} ${money(top.ev.profit)})`);
} catch (e) { fail('report page missing: ' + e.message); }

// ---------- result ----------
const evid = A.reduce((m, o) => (m[o.evidence] = (m[o.evidence] || 0) + 1, m), {});
console.log(`objects ${objs.length} · trajectories ${lamN} · profitable ${A.filter(o => o.ev.profit > 0).length} · tiers ${JSON.stringify(counts)} · evidence ${JSON.stringify(evid)}`);
for (const w of warns) console.log('WARN', w);
if (fails.length) { for (const f of fails) console.error('FAIL', f); console.error(`${fails.length} check(s) failed – not publishing`); process.exit(1); }
console.log('All checks passed ✔');
