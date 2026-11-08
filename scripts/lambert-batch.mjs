// Hourly: exact Lambert-optimised round trips (best launch window in the next 10 years)
// for every serious mining candidate. Results go to data/lambert.json and are used
// everywhere on the site, so the map, the detail card and the report show the same numbers.
import { readFile, writeFile } from 'node:fs/promises';
import { DEFAULTS } from '../js/model.js';
import { body, porkchop } from '../js/lambert.js';
import { jdNow, planetElements } from '../js/orbits.js';
import { buildObjects, rankAll, pricesFrom, decodeLambert, encodeLambert } from '../js/pipeline.js';

const ROOT = new URL('../', import.meta.url);
const read = async (f, d) => { try { return JSON.parse(await readFile(new URL(f, ROOT), 'utf8')); } catch (e) { if (d !== undefined) return d; throw e; } };
const BUDGET_MS = +(process.env.LAMBERT_BUDGET_MS || 12 * 60e3);
const TOP_N = 2500, STALE_MS = 3 * 864e5;
const t0 = Date.now();

const [ast, nh, pr, prevRaw, tax] = await Promise.all([
  read('data/asteroids.json'), read('data/nhats.json', { list: {} }), read('data/prices.json'), read('data/lambert.json', { list: {} }), read('data/taxonomy.json', null),
]);
const prev = decodeLambert(prevRaw);
const S = { ...DEFAULTS };
const stayDays = Math.round(S.stayMonths * 30.44);
// rank WITHOUT Lambert to choose candidates fairly
const objs = buildObjects({ ast, nh, tax });
rankAll(objs, S, pricesFrom(pr.metals));
const reach = objs.filter(o => o.Q <= 6);
const cand = new Map();
for (const o of [...reach].sort((a, b) => b.ev.profit - a.ev.profit).slice(0, TOP_N)) cand.set(o.name, o);
for (const o of reach) if (o.dv.src === 'nhats') cand.set(o.name, o);
// ...plus anything already Lambert-ranked highly, so the top never loses its trajectory
const byName = new Map(objs.map(o => [o.name, o]));
for (const name of Object.keys(prev.list)) { const o = byName.get(name); if (o && o.Q <= 6) cand.set(name, o); }

const now = Date.now(), jd = jdNow(), list = {};
const stale = r => !r || r.stay !== stayDays || now - Date.parse(r.at) > STALE_MS || (r.t0 - 2440587.5) * 864e5 < now + 15 * 864e5;
const order = [...cand.values()].sort((a, b) => b.ev.profit - a.ev.profit);
for (const o of order) if (!stale(prev.list[o.name])) list[o.name] = prev.list[o.name];
const todo = order.filter(o => stale(prev.list[o.name]));

const pe = planetElements('Earth', jd), earth = body(pe.a, pe.e, pe.i, pe.om, pe.w, pe.M, jd);
let done = 0;
for (const o of todo) {
  if (Date.now() - t0 > BUDGET_MS) break;
  const M = o.ma * Math.PI / 180 + Math.sqrt(2.9591220828559e-4 / o.a ** 3) * (jd - o.epoch);
  const r = porkchop(earth, body(o.a, o.e, o.i, o.om, o.w, M, jd), jd, { stayDays, step: 10 });
  done++;
  if (r) list[o.name] = {
    t0: Math.round(r.t0 * 10) / 10, tof: r.tof, tofRet: r.tofRet, t1: Math.round(r.t1 * 10) / 10, t2: Math.round(r.t2 * 10) / 10,
    vinf: +r.vinf.toFixed(4), arr: +r.arr.toFixed(4), d3: +r.d3.toFixed(4), vEntry: +r.vEntry.toFixed(3), total: +r.total.toFixed(4),
    stay: stayDays, at: new Date().toISOString(),
  };
  else if (prev.list[o.name]) list[o.name] = prev.list[o.name];
}
const remaining = todo.length - done;
await writeFile(new URL('data/lambert.json', ROOT), JSON.stringify(encodeLambert({
  generated: new Date().toISOString(), stayDays, source: 'Lambert-optimised round trips (Astromine hourly job)',
  coverage: { candidates: cand.size, computed: Object.keys(list).length, pending: remaining },
}, list)));
console.log(`lambert: computed ${done} in ${((Date.now() - t0) / 1000).toFixed(0)}s, total ${Object.keys(list).length}/${cand.size}, pending ${remaining}`);
