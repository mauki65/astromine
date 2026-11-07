// One pipeline for everything: the map, the list, the detail card, the report page and
// the hourly job all build objects and rank them through these functions, so every
// number on the site comes from the same data and the same maths.
import { ORDER, prepare, evaluate, assignTiers, applyNhats } from './model.js';
import { depLEO, depMoon } from './lambert.js';

export const shortName = n => n.replace(/^\((.*)\)$/, '$1');
const OZT = 0.0311034768;

// Trajectory quality ladder: exact Lambert round trip (hourly job) > NASA NHATS > Hohmann estimate.
export function applyLambert(o, r) {
  o.lam = r;
  Object.assign(o.dv, {
    leo: depLEO(r.vinf), moon: depMoon(r.vinf), dvArr: r.arr, ret: r.d3,
    transferYr: (r.tof + r.tofRet) / 2 / 365.25, src: 'lambert',
  });
}

export function keysOf(o) {
  const num = o.name.match(/^(\d+)\s/)?.[1], prov = o.name.match(/\(([^)]+)\)/)?.[1];
  return [num, prov, shortName(o.name)].filter(Boolean);
}

// data = { ast, com, nh, lam, cad } (parsed JSON files); extra(o) lets the map add drawing fields
export function buildObjects(data, extra) {
  const NH = data.nh?.list || {}, LAM = data.lam?.list || {};
  const cad = new Map(); for (const c of data.cad?.list || []) if (!cad.has(c.des)) cad.set(c.des, c);
  const mk = F => r => {
    const o = prepare(r, F);
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
  };
  const objs = (data.ast?.rows || []).map(mk(data.ast.fields));
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
const LIVE = { XAU: 'Au', XAG: 'Ag', XPT: 'Pt', XPD: 'Pd', HG: 'Cu' };
export async function refreshSpot(metals) {
  let changed = false;
  await Promise.all(Object.entries(LIVE).map(async ([sym, k]) => {
    try {
      const j = await fetch(`https://api.gold-api.com/price/${sym}`, { cache: 'no-store' }).then(r => r.json());
      const v = sym === 'HG' ? j.price * 2.20462 : j.price / OZT;
      if (v > 0) {
        if (Math.abs(v - (metals[k]?.usdPerKg || 0)) / v > 1e-4) changed = true;
        metals[k] = { ...metals[k], usdPerKg: v, source: 'gold-api.com live spot', asOf: j.updatedAt || new Date().toISOString(), live: true };
      }
    } catch {}
  }));
  return changed;
}
