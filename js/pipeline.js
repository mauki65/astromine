// One pipeline for everything: the map, the list, the detail card, the report page and
// the hourly job all build objects and rank them through these functions, so every
// number on the site comes from the same data and the same maths.
import { ORDER, prepare, evaluate, assignTiers, applyNhats } from './model.js';
import { depLEO, depMoon, entrySpeed, capL1 } from './lambert.js';

// asteroids.json is columnar (see scripts/fetch-data.mjs); older row format still accepted
export function decodeRows(d) {
  if (!d || d.rows) return d;
  const rows = Array.from({ length: d.n }, () => new Array(d.fields.length).fill(null));
  d.fields.forEach((f, j) => {
    if (d.cols[f]) d.cols[f].forEach((v, i) => { rows[i][j] = v; });
    else { for (const [i, v] of Object.entries(d.sparse[f] || {})) rows[i][j] = v; if (['neo', 'pha', 'radar'].includes(f)) rows.forEach(r => { if (r[j] === null) r[j] = 0; }); }
  });
  return { ...d, rows };
}
// lambert.json stores each trajectory as a compact array
const LAM_FIELDS = ['t0', 'tof', 'tofRet', 't1', 't2', 'vinf', 'arr', 'd3', 'vEntry', 'total', 'stay', 'at', 'ver'];
export const LAM_VERSION = 2; // bump when trajectory physics change → everything is recomputed
export function decodeLambert(l) {
  if (!l || !l.fields) return l;
  const first = Object.values(l.list)[0];
  if (first && !Array.isArray(first)) return l;   // already decoded (idempotent)
  return { ...l, list: Object.fromEntries(Object.entries(l.list).map(([k, a]) => [k, Object.fromEntries(l.fields.map((f, j) => [f, a[j]]))])) };
}
export function encodeLambert(meta, list) {
  return { ...meta, fields: LAM_FIELDS, list: Object.fromEntries(Object.entries(list).map(([k, r]) => [k, LAM_FIELDS.map(f => r[f])])) };
}

export const PRICE_BOUNDS = { // $/kg, generous but excludes unit mix-ups (×31 troz, ×1000 g, ×2.2 lb)
  Au: [30e3, 400e3], Pt: [15e3, 250e3], Pd: [8e3, 250e3], Rh: [30e3, 2e6], Ir: [30e3, 2e6],
  Ru: [3e3, 400e3], Os: [3e3, 100e3], Cu: [3, 40], Ni: [5, 60], Co: [10, 200], Fe: [0.05, 5],
};

export const shortName = n => n.replace(/^\((.*)\)$/, '$1');
const OZT = 0.0311034768;

// Trajectory quality ladder: exact Lambert round trip (hourly job) > NASA NHATS > Hohmann estimate.
// Δv set from a Lambert round trip. The trip ends in Earth's atmosphere (metal capsule); a cargo
// for the L1 depot drops the braking burn and instead pays a propulsive capture (perigee burn + L1 insertion).
export function lamDv(r) {
  const vArr = Math.sqrt(Math.max(0, r.vEntry ** 2 - entrySpeed(0) ** 2));
  return {
    leo: depLEO(r.vinf), moon: depMoon(r.vinf), dvArr: r.arr, ret: r.d3,
    retDepot: r.d3 - Math.max(0, r.vEntry - 12) + capL1(vArr), transferYr: (r.tof + r.tofRet) / 2 / 365.25,
  };
}
export function applyLambert(o, r) {
  o.lam = r;
  Object.assign(o.dv, lamDv(r), { src: 'lambert' });
}

function tkeys(name) {
  const k = [name], p = name.match(/\(([^)]+)\)/)?.[1], n = name.match(/^(\d+)\s/)?.[1];
  if (p) k.push(p); if (n) k.push(n);
  if (name.includes('/')) k.push(...name.split('/', 2));
  return k;
}

function keysOf(o) {
  const num = o.name.match(/^(\d+)\s/)?.[1], prov = o.name.match(/\(([^)]+)\)/)?.[1];
  return [num, prov, shortName(o.name)].filter(Boolean);
}

// data = { ast, com, nh, lam, cad } (parsed JSON files); extra(o) lets the map add drawing fields
export function buildObjects(data, extra) {
  const NH = data.nh?.list || {}, LAM = decodeLambert(data.lam)?.list || {};
  const ast = decodeRows(data.ast);
  const cad = new Map(); for (const c of data.cad?.list || []) if (!cad.has(c.des)) cad.set(c.des, c);
  const TAX = data.tax || { ast: {}, com: {} };
  const mk = F => {
    const ix = Object.fromEntries(F.map((f, j) => [f, j]));
    return r => {
    // fill gaps in NASA's record with SsODNet (spectra/survey colours, measured sizes)
    let tech = null;
    const keys = tkeys(r[0]);
    if (ix.comet !== undefined && r[ix.comet]) {
      const D = keys.map(k => TAX.com[k]).find(v => v);
      if (D && r[ix.diameter] == null) { r = r.slice(); r[ix.diameter] = D; }
    } else {
      const t = keys.map(k => TAX.ast[k]).find(Boolean);
      if (t) {
        r = r.slice();
        if (t[0] && !r[ix.spec_B] && !r[ix.spec_T]) { r[ix.spec_T] = t[0]; tech = t[1] || 'survey'; }
        if (t[2] && r[ix.diameter] == null) r[ix.diameter] = t[2];
        if (t[3] && r[ix.albedo] == null) r[ix.albedo] = t[3];
      }
    }
    const o = prepare(r, F);
    if (tech) {
      const spec = /spec/i.test(tech);
      const tail = o.basis.match(/, (?:bright|dark) .*$/)?.[0] || '';   // albedo note from classify()
      o.basis = `${spec ? 'Spectrum' : 'Survey colours (Gaia/SDSS)'} – type ${o.spec_T} (SsODNet)${tail}`;
      if (!spec) o.conf = 0.7;
    }
    o.keys = keysOf(o);
    o.ca = o.keys.map(k => cad.get(k)).find(Boolean) || null;
    o.belt = !o.neo && !o.comet;
    if (!o.comet) {
      const n = o.keys.map(k => NH[k]).find(Boolean);
      if (n) applyNhats(o, n);
      const l = LAM[o.name];
      if (l) applyLambert(o, l);
    }
    if (extra) extra(o);
    return o;
  }; };
  const objs = (ast?.rows || []).map(mk(ast.fields));
  if (data.com?.rows?.length) objs.push(...data.com.rows.map(mk(data.com.fields)));
  return objs;
}

export function rankAll(objs, S, prices) {
  for (const o of objs) o.ev = evaluate(o, S, prices);
  return assignTiers(objs.filter(o => !o.comet), objs.filter(o => o.comet));
}

export function pricesFrom(metals, overrides = {}) {
  return Object.fromEntries(ORDER.map(k => [k, overrides[k] > 0 ? overrides[k] : (metals[k]?.usdPerKg || 0)]));
}

// Live spot prices (gold-api.com, CORS-enabled). Mutates `metals`; returns true if anything changed.
const LIVE = { XAU: 'Au', XPT: 'Pt', XPD: 'Pd', HG: 'Cu' };
export async function refreshSpot(metals) {
  let changed = false;
  await Promise.all(Object.entries(LIVE).map(async ([sym, k]) => {
    try {
      const j = await fetch(`https://api.gold-api.com/price/${sym}`, { cache: 'no-store' }).then(r => r.json());
      const v = sym === 'HG' ? j.price * 2.20462 : j.price / OZT;
      const ref = metals[k]?.usdPerKg;
      if (v > 0 && (!ref || Math.abs(v / ref - 1) < 0.4)) {  // ignore glitchy ticks
        if (Math.abs(v - (ref || 0)) / v > 1e-4) changed = true;
        metals[k] = { ...metals[k], usdPerKg: v, source: 'gold-api.com live spot', asOf: j.updatedAt || new Date().toISOString(), live: true };
      }
    } catch {}
  }));
  return changed;
}
