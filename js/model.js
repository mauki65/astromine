import { depLEO, depMoon, entrySpeed } from './lambert.js';
// Composition, physical estimates, delta-v and mission economics.
// All numbers are first-order estimates from meteorite analogues and patched-conic orbital mechanics.

export const MATERIALS = {
  Pt:    { name: 'Platinum',  group: 'pgm',   supply: 180,     color: '#d9dde3', uses: 'Catalytic converters, fuel cells, hydrogen electrolysers, jewellery' },
  Pd:    { name: 'Palladium', group: 'pgm',   supply: 200,     color: '#c9c3b6', uses: 'Gasoline-car catalysts, electronics, dentistry' },
  Rh:    { name: 'Rhodium',   group: 'pgm',   supply: 23,      color: '#e8d6c8', uses: 'NOx catalysts, glass-fibre production, plating' },
  Ir:    { name: 'Iridium',   group: 'pgm',   supply: 7,       color: '#f0e7d0', uses: 'PEM electrolysers (green hydrogen), spark plugs, crucibles' },
  Ru:    { name: 'Ruthenium', group: 'pgm',   supply: 30,      color: '#b9c4cf', uses: 'Hard-disk platters, chip interconnects, chemical catalysts' },
  Os:    { name: 'Osmium',    group: 'pgm',   supply: 1,       color: '#a9b8d0', uses: 'Tiny market – fountain-pen tips, electrical contacts' },
  Au:    { name: 'Gold',      group: 'pgm',   supply: 3300,    color: '#e9c46a', uses: 'Investment, jewellery, electronics' },
  Co:    { name: 'Cobalt',    group: 'metal', supply: 290000,  color: '#6d8fd6', uses: 'Battery cathodes, superalloys, magnets' },
  Ni:    { name: 'Nickel',    group: 'metal', supply: 3600000, color: '#9fb7a5', uses: 'Stainless steel, battery cathodes' },
  Cu:    { name: 'Copper',    group: 'metal', supply: 23000000,color: '#d08a5b', uses: 'Wiring, motors, electronics' },
  Fe:    { name: 'Iron',      group: 'metal', supply: 1.3e9,   color: '#8d8d8d', uses: 'Steel – on Earth nearly worthless to import, in orbit a building material' },
  water: { name: 'Water',     group: 'water', supply: 5000,    color: '#6fc3df', uses: 'Rocket propellant (H₂/O₂), life support, radiation shielding – sold in orbit' },
};
export const ORDER = ['Pt', 'Pd', 'Rh', 'Ir', 'Ru', 'Os', 'Au', 'Co', 'Ni', 'Cu', 'Fe', 'water'];

const ppm = 1e-6;
// Bulk mass fractions per composition class + probability the material is present at that grade.
// Bulk densities (kg/m³): Carry 2012 (Planet. Space Sci. 73, 98) averages; Ryugu & Bennu measured 1190;
// metal-rich bodies are porous (Psyche ≈ 3900), so iron-meteorite grain density would overstate mass.
export const CLASSES = {
  M: { label: 'Metallic (M-type)', analog: 'Iron meteorites', density: 3900, albedo: 0.15,
       g: { Fe: .88, Ni: .09, Co: .005, Cu: 1.5e-4, Pt: 15*ppm, Pd: 4*ppm, Rh: 2*ppm, Ir: 5*ppm, Ru: 6*ppm, Os: 5*ppm, Au: 1*ppm, water: 0 },
       p: { metal: .9, pgm: .7, water: .05 } },
  X: { label: 'X-type (metal or enstatite)', analog: 'Mixed – needs radar/spectra', density: 2700, albedo: 0.15,
       g: { Fe: .45, Ni: .05, Co: .0025, Cu: 1e-4, Pt: 7*ppm, Pd: 2*ppm, Rh: 1*ppm, Ir: 2.5*ppm, Ru: 3*ppm, Os: 2.5*ppm, Au: .6*ppm, water: .02 },
       p: { metal: .45, pgm: .4, water: .3 } },
  S: { label: 'Stony (S-type)', analog: 'Ordinary chondrites', density: 2700, albedo: 0.25,
       g: { Fe: .2, Ni: .012, Co: 6e-4, Cu: 1e-4, Pt: 1*ppm, Pd: .6*ppm, Rh: .15*ppm, Ir: .5*ppm, Ru: .7*ppm, Os: .6*ppm, Au: .2*ppm, water: .001 },
       p: { metal: .8, pgm: .5, water: .1 } },
  Q: { label: 'Fresh stony (Q-type)', analog: 'Unweathered ordinary chondrites', density: 2700, albedo: 0.25,
       g: { Fe: .2, Ni: .012, Co: 6e-4, Cu: 1e-4, Pt: 1*ppm, Pd: .6*ppm, Rh: .15*ppm, Ir: .5*ppm, Ru: .7*ppm, Os: .6*ppm, Au: .2*ppm, water: .001 },
       p: { metal: .85, pgm: .55, water: .1 } },
  C: { label: 'Carbonaceous (C-type)', analog: 'CI/CM chondrites', density: 1300, albedo: 0.06,
       g: { Fe: .18, Ni: .011, Co: 5e-4, Cu: 1.2e-4, Pt: .9*ppm, Pd: .55*ppm, Rh: .13*ppm, Ir: .45*ppm, Ru: .68*ppm, Os: .49*ppm, Au: .15*ppm, water: .10 },
       p: { metal: .6, pgm: .5, water: .85 } },
  D: { label: 'Primitive (D/P-type)', analog: 'Tagish Lake-like, ice-rich', density: 1000, albedo: 0.05,
       g: { Fe: .15, Ni: .009, Co: 4e-4, Cu: 1e-4, Pt: .8*ppm, Pd: .5*ppm, Rh: .12*ppm, Ir: .4*ppm, Ru: .6*ppm, Os: .45*ppm, Au: .14*ppm, water: .2 },
       p: { metal: .5, pgm: .45, water: .6 } },
  E: { label: 'Enstatite (E-type)', analog: 'Aubrites / enstatite chondrites', density: 2700, albedo: 0.5,
       g: { Fe: .1, Ni: .006, Co: 3e-4, Cu: 1e-4, Pt: .6*ppm, Pd: .4*ppm, Rh: .1*ppm, Ir: .3*ppm, Ru: .4*ppm, Os: .3*ppm, Au: .1*ppm, water: 0 },
       p: { metal: .5, pgm: .3, water: .02 } },
  K: { label: 'Comet nucleus', analog: 'Rosetta / 67P measurements', density: 550, albedo: 0.04,
       g: { Fe: .08, Ni: .005, Co: 2.5e-4, Cu: 5e-5, Pt: .4*ppm, Pd: .25*ppm, Rh: .06*ppm, Ir: .2*ppm, Ru: .3*ppm, Os: .22*ppm, Au: .07*ppm, water: .3 },
       p: { metal: .4, pgm: .35, water: .95 } },
  V: { label: 'Basaltic (V-type)', analog: 'HED meteorites (Vesta)', density: 3000, albedo: 0.35,
       g: { Fe: .14, Ni: 2e-5, Co: 2e-5, Cu: 1e-5, Pt: .01*ppm, Pd: .01*ppm, Rh: .002*ppm, Ir: .005*ppm, Ru: .01*ppm, Os: .005*ppm, Au: .005*ppm, water: 0 },
       p: { metal: .3, pgm: .15, water: .02 } },
};

export const TIERS = [
  { key: 'mythic',    label: 'Mythic',    color: '#ff2e3f', top: 0.0002 },  // top 0.02% AND profitable
  { key: 'legendary', label: 'Legendary', color: '#ff9f1c', top: 0.005 },
  { key: 'epic',      label: 'Epic',      color: '#b26bff', top: 0.025 },
  { key: 'rare',      label: 'Rare',      color: '#3a8bff', top: 0.09 },
  { key: 'uncommon',  label: 'Uncommon',  color: '#3fcf6e', top: 0.28 },
  { key: 'common',    label: 'Common',    color: '#8a8f98', top: 1 },
];

// Bodies visited by spacecraft: composition from returned samples / in-situ measurements.
const GROUND_TRUTH = {
  '162173': { cls: 'C', basis: 'Hayabusa2 returned sample (2020): CI-chondrite-like, hydrated clays' },
  '101955': { cls: 'C', basis: 'OSIRIS-REx returned sample (2023): carbon- and water-rich' },
  '25143':  { cls: 'S', basis: 'Hayabusa returned sample (2010): LL ordinary chondrite' },
  '433':    { cls: 'S', basis: 'NEAR Shoemaker orbiter (2000–01): ordinary-chondrite composition' },
  '4':      { cls: 'V', basis: 'Dawn orbiter (2011–12): basaltic HED parent body' },
  '16':     { cls: 'M', basis: 'Spectra + radar: metal-rich; NASA Psyche mission arrives 2029' },
};
export const EVIDENCE = {
  sample:   { label: 'Confirmed',  color: '#3fcf6e', note: 'Visited by a spacecraft or sample brought back to Earth' },
  measured: { label: 'Measured',   color: '#3a8bff', note: 'Composition measured by telescope (light spectrum)' },
  inferred: { label: 'Estimated',  color: '#e9c46a', note: 'Estimated from how much light it reflects' },
  assumed:  { label: 'Guess',      color: '#8a909c', note: 'No data – typical for asteroids on this kind of orbit' },
};
function classify(o) {
  const num = (o.name || '').match(/^(\d+)\s/)?.[1];
  if (num && GROUND_TRUTH[num]) return { ...GROUND_TRUTH[num], conf: 0.97, evidence: 'sample' };
  if (o.comet) return { cls: 'K', conf: 0.8, basis: `Comet (${o.class || 'short-period'}) – Rosetta/67P analogue`, evidence: 'measured' };
  const t = (o.spec_B || o.spec_T || '').trim();
  if (t) {
    const s = t.replace(/[^A-Za-z]/g, '');
    const u = s.toUpperCase();
    let c = 'S';
    if (/^M/.test(u)) c = 'M';
    else if (/^XE/.test(u) || /^E/.test(u)) c = 'E';
    else if (/^X/.test(u)) c = 'X';
    else if (/^[CBFG]/.test(u)) c = 'C';
    else if (/^[DPT]/.test(u)) c = 'D';
    else if (/^Q/.test(u)) c = 'Q';
    else if (/^[VR]/.test(u)) c = 'V';
    else c = 'S';  // S, Sq, Sr, K, L, A, O...
    return { cls: c, conf: 0.85, basis: `Spectral type ${t}`, evidence: 'measured' };
  }
  if (o.albedo != null) {
    const p = o.albedo;
    if (p < 0.1) return { cls: 'C', conf: 0.5, basis: `Albedo ${p.toFixed(3)} (dark)`, evidence: 'inferred' };
    if (p < 0.3) return { cls: 'S', conf: 0.5, basis: `Albedo ${p.toFixed(3)} (moderate)`, evidence: 'inferred' };
    return { cls: 'E', conf: 0.35, basis: `Albedo ${p.toFixed(3)} (bright)`, evidence: 'inferred' };
  }
  if (o.a > 4.5) return { cls: 'D', conf: 0.3, basis: 'No spectra – Trojan/Centaur statistics', evidence: 'assumed' };
  if (o.a > 3.0) return { cls: 'C', conf: 0.25, basis: 'No spectra – outer-belt statistics', evidence: 'assumed' };
  if (o.a > 2.6) return { cls: 'C', conf: 0.2, basis: 'No spectra – mid-belt statistics', evidence: 'assumed' };
  return { cls: 'S', conf: 0.25, basis: 'No spectra – inner/NEO statistics', evidence: 'assumed' };
}

// ---------- delta-v (patched conic, Earth orbit = 1 AU circular) ----------
const VE = 29.78, D2R = Math.PI / 180;
function deltaV(a, e, incDeg) {
  const i = incDeg * D2R, q = a * (1 - e), Q = a * (1 + e);
  let vinf, dvArr, at;
  if (q <= 1 && Q >= 1) {           // orbit crosses 1 AU
    const v2 = 2 - 1 / a, vt = Math.sqrt(a * (1 - e * e)), vr = Math.sqrt(Math.max(0, v2 - vt * vt));
    vinf = Math.sqrt(Math.max(0, vr * vr + vt * vt + 1 - 2 * vt * Math.cos(i))) * VE;
    dvArr = 0.5 + 0.12 * vinf;       // phasing / matching margin
    at = a;
  } else {
    const r2 = q > 1 ? q : Q;        // reach nearest apsis
    at = (1 + r2) / 2;
    const v1 = Math.sqrt(2 - 1 / at);
    vinf = Math.abs(v1 - 1) * VE;
    const vt2 = Math.sqrt(2 / r2 - 1 / at), va = Math.sqrt(2 / r2 - 1 / a);
    dvArr = Math.sqrt(vt2 * vt2 + va * va - 2 * vt2 * va * Math.cos(i)) * VE;
  }
  const leo = depLEO(vinf);
  const moon = depMoon(vinf);
  const transferYr = Math.min(8, Math.max(0.25, 0.5 * Math.pow(at, 1.5)));
  // return: leave the asteroid (≈ arrival burn, +0.3 margin) and, if Earth arrival is too fast for a 12 km/s entry, brake
  const ret = dvArr + 0.3 + Math.max(0, entrySpeed(vinf) - 12);
  return { vinf, dvArr, leo, moon, ret, transferYr, src: 'estimate' };
}

// NASA NHATS: round trip from a 400 km LEO, >=8 day stay, <=450 days, Earth return by
// atmospheric entry. Rescale our Δv split so its total matches NASA's optimised value.
export function applyNhats(o, n) {
  const d = o.dv, est = d.leo + d.dvArr + d.ret, k = n.dv / est, lm = d.leo - d.moon;
  d.leo *= k; d.dvArr *= k; d.ret *= k; d.moon = Math.max(0.5, d.leo - lm);
  d.transferYr = Math.max(30, (n.dur - 8) / 2) / 365.25;
  d.src = 'nhats'; d.nhats = n;
}

export function prepare(row, F) {
  const o = {}; F.forEach((k, j) => o[k] = row[j]);
  const c = classify(o);
  const C = CLASSES[c.cls];
  const albedo = o.albedo ?? C.albedo;
  const dEst = o.diameter == null;
  const D = o.diameter ?? (o.H != null ? 1329 / Math.sqrt(albedo) * Math.pow(10, -o.H / 5) : (o.comet ? 2 : 0.1));
  const mass = C.density * Math.PI / 6 * Math.pow(D * 1000, 3); // kg
  const dv = deltaV(o.a, o.e, o.i);
  return { ...o, ...c, D, dEst, mass, dv, q: o.a * (1 - o.e), Q: o.a * (1 + o.e) };
}

// ---------- Economics ----------
export const DEFAULTS = {
  base: 'earth', costEarth: 500, moonPct: 10, dryMass: 25, buildCost: 150, opsCost: 10,
  isp: 380, oreCap: 500000, returnCap: 400, recovery: 60, procCost: 20, stayMonths: 9, risk: 20,
  isru: true, impact: true, launchMode: 'best',
};

const G0 = 9.80665;
export function evaluate(o, S, prices) {
  const C = CLASSES[o.cls];
  const ve = S.isp * G0 / 1000;
  const ore = Math.min(S.oreCap * 1000, o.mass * 0.5);      // kg processed
  // materials available
  const items = [];
  for (const k of ORDER) {
    const grade = C.g[k] || 0; if (!grade) continue;
    const M = MATERIALS[k];
    const chance = Math.min(0.97, C.p[M.group] * (0.4 + 0.6 * o.conf));
    const kg = ore * grade * S.recovery / 100;
    items.push({ k, grade, chance, kg, price: prices[k] || 0 });
  }
  const hasWater = (C.g.water || 0) > 0.02;
  const useIsru = S.isru && hasWater;
  const dry = S.dryMass * 1000;
  const mrRet = Math.exp(o.dv.ret / ve) - 1;
  if (useIsru) {  // water first becomes return propellant (upper bound: full payload)
    const w = items.find(i => i.k === 'water');
    w.kg = Math.max(0, w.kg - (dry + S.returnCap * 1000) * mrRet);
  }
  // fill return cap by expected value density
  let cap = S.returnCap * 1000, revenue = 0;
  const sorted = [...items].sort((a, b) => b.price * b.chance - a.price * a.chance);
  for (const it of sorted) {
    const take = Math.min(it.kg, cap);
    it.taken = take; cap -= take;
    const sup = MATERIALS[it.k].supply * 1000; // kg/yr
    const realized = S.impact ? it.price / (1 + take / sup) : it.price;
    it.realized = realized;
    it.value = take * realized * it.chance;
    revenue += it.value;
  }
  const payload = S.returnCap * 1000 - cap;
  const propRet = (dry + payload) * mrRet;
  const launchedRet = useIsru ? 0 : propRet;
  const dvOut = (S.base === 'moon' ? o.dv.moon : o.dv.leo) + o.dv.dvArr;
  const propOut = (dry + launchedRet) * (Math.exp(dvOut / ve) - 1);
  const launchMass = dry + launchedRet + propOut;
  const perKg = S.base === 'moon' ? S.costEarth * S.moonPct / 100 : S.costEarth;
  const years = 2 * o.dv.transferYr + S.stayMonths / 12;
  const costLaunch = launchMass * perKg;
  const costProc = (ore / 1000) * S.procCost;
  const costFixed = S.buildCost * 1e6 + S.opsCost * 1e6 * years;
  const cost = costLaunch + costProc + costFixed;
  const expRevenue = revenue * (1 - S.risk / 100);
  const profit = expRevenue - cost;
  return {
    items, revenue, expRevenue, cost, costLaunch, costProc, costFixed, profit, roi: profit / cost,
    launchMass, propOut, propRet, useIsru, payload, ore, dvOut, dvRet: o.dv.ret, years,
    perTonne: payload > 0 ? expRevenue / (payload / 1000) : 0,
  };
}

export function assignTiers(objs, extra = []) {
  // Tiers are percentiles of the asteroid population; optional layers (comets)
  // are slotted in by profit so toggling them never re-ranks the asteroids.
  const sorted = [...objs].sort((a, b) => b.ev.profit - a.ev.profit);
  const n = sorted.length;
  const floor = {};
  sorted.forEach((o, r) => {
    const f = (r + 1) / n;
    o.tier = TIERS.find(t => f <= t.top);
    if (o.tier.key === 'mythic' && !(o.ev.profit > 0)) o.tier = TIERS[1];
    o.rank = r + 1;
    floor[o.tier.key] = o.ev.profit;
  });
  for (const o of extra) {
    o.tier = TIERS.find(t => floor[t.key] !== undefined && o.ev.profit >= floor[t.key]) || TIERS[TIERS.length - 1];
    if (o.tier.key === 'mythic' && !(o.ev.profit > 0)) o.tier = TIERS[1];
    let lo = 0, hi = n;  // rank = position among asteroids
    while (lo < hi) { const m = (lo + hi) >> 1; sorted[m].ev.profit > o.ev.profit ? lo = m + 1 : hi = m; }
    o.rank = lo + 1;
  }
  return [...sorted, ...extra].sort((a, b) => b.ev.profit - a.ev.profit);
}
