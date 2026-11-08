// Lambert-optimised round trip (Earth → asteroid → Earth) over the next ~10 years.
// Universal-variable Lambert solver (Curtis, Orbital Mechanics for Engineering Students, Alg. 5.2).
// Units: AU, days. Output Δv in km/s.
const MU = 2.9591220828559e-4;     // GM_sun, AU^3/day^2
const KMS = 1731.456837;           // AU/day → km/s
const D2R = Math.PI / 180;

// 3-D Keplerian state from elements
export function kepler(el) {
  const { a, e, i, om, w } = el;
  const I = i * D2R, O = om * D2R, W = w * D2R;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(W), sw = Math.sin(W), ci = Math.cos(I), si = Math.sin(I);
  const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
  const n = Math.sqrt(MU / (a * a * a)), b = a * Math.sqrt(1 - e * e);
  return (M) => {
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 15; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-11) break; }
    const cE = Math.cos(E), sE = Math.sin(E), x = a * (cE - e), y = b * sE;
    const rr = a * (1 - e * cE), vx = -a * n * sE / (1 - e * cE) * 1, vy = b * n * cE / (1 - e * cE);
    return {
      r: [P[0] * x + Q[0] * y, P[1] * x + Q[1] * y, P[2] * x + Q[2] * y],
      v: [P[0] * vx + Q[0] * vy, P[1] * vx + Q[1] * vy, P[2] * vx + Q[2] * vy],
      rr,
    };
  };
}
export function stateAt(B, jd) {
  // B: { el, M0, epoch, n }
  const M = B.M0 + B.n * (jd - B.epoch);
  return B.fn(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
}
export function body(a, e, i, om, w, M0rad, epoch) {
  return { fn: kepler({ a, e, i, om, w }), M0: M0rad, epoch, n: Math.sqrt(MU / (a * a * a)) };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.sqrt(dot(a, a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function stumpC(z) { if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z; if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z; return 0.5 - z / 24; }
function stumpS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120;
}

// prograde single-revolution Lambert. Returns [v1, v2] or null.
export function lambert(r1, r2, t) {
  const R1 = norm(r1), R2 = norm(r2);
  const c = cross(r1, r2);
  let dth = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (R1 * R2))));
  if (c[2] < 0) dth = 2 * Math.PI - dth;
  const A = Math.sin(dth) * Math.sqrt(R1 * R2 / (1 - Math.cos(dth)));
  if (!isFinite(A) || Math.abs(A) < 1e-9) return null;
  const y = z => R1 + R2 + A * (z * stumpS(z) - 1) / Math.sqrt(stumpC(z));
  const F = z => { const yz = y(z); return Math.pow(yz / stumpC(z), 1.5) * stumpS(z) + A * Math.sqrt(yz) - Math.sqrt(MU) * t; };
  // bracket a root
  let lo = -4 * Math.PI * Math.PI, hi = 4 * Math.PI * Math.PI * 0.999;
  while (y(lo) < 0) lo += 0.1;
  let flo = F(lo), fhi = F(hi);
  if (!(flo < 0 && fhi > 0)) return null;
  let z = 0;
  for (let k = 0; k < 44; k++) {
    z = 0.5 * (lo + hi); const fz = F(z);
    if (Math.abs(fz) < 1e-12) break;
    if (fz < 0) lo = z; else hi = z;
  }
  const yz = y(z);
  if (!(yz > 0)) return null;
  const f = 1 - yz / R1, g = A * Math.sqrt(yz / MU), gd = 1 - yz / R2;
  const v1 = [(r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g, (r2[2] - f * r1[2]) / g];
  const v2 = [(gd * r2[0] - r1[0]) / g, (gd * r2[1] - r1[1]) / g, (gd * r2[2] - r1[2]) / g];
  return [v1, v2];
}

// Δv to leave a 400 km LEO / low lunar orbit with hyperbolic excess vinf (km/s)
// Patched-conic departure burns (constants from GM_Earth, GM_Moon; audited 2026-11-08):
// LEO 400 km: v_circ 7.669, v_esc 10.845 km/s.
export const depLEO = vinf => Math.sqrt(vinf * vinf + 10.845 ** 2) - 7.669;
// Low lunar orbit 100 km (v_circ 1.634, v_esc 2.310): leave the Moon with the excess u needed so that,
// added to the Moon's orbital speed (1.018), it reaches Earth-escape-plus-vinf at lunar distance (v_esc 1.440).
export const depMoon = vinf => { const u = Math.max(0, Math.sqrt(vinf * vinf + 1.440 ** 2) - 1.018); return Math.sqrt(u * u + 2.310 ** 2) - 1.634; };
// Atmospheric entry speed at 120 km for an arrival excess vinf; NASA NHATS limits it to 12 km/s.
// Faster arrivals need a braking burn at perigee (entry - 12) before entry.
export const entrySpeed = vinf => Math.sqrt(vinf * vinf + 11.08 ** 2);
const brake = vinf => Math.max(0, entrySpeed(vinf) - 12);

// Search the next `years` for the cheapest round trip: coarse grid over departure date ×
// outbound time of flight, then local refinement, then the same for the return leg.
// Return leg ends with atmospheric entry (no braking burn), capped at 12 km/s like NASA NHATS.
const MAX_TOF = 720; // days per leg – refinement stays inside the searched range
export function porkchop(earth, ast, jd0, { years = 10, stayDays = 270, base = 'earth' } = {}) {
  const dep = base === 'moon' ? depMoon : depLEO;
  const out = (t0, tof) => {
    const E = stateAt(earth, t0), A = stateAt(ast, t0 + tof);
    const L = lambert(E.r, A.r, tof); if (!L) return null;
    const vinf = norm(sub(L[0], E.v)) * KMS; if (vinf > 9) return null;
    const arr = norm(sub(A.v, L[1])) * KMS;
    return { t0, tof, vinf, d1: dep(vinf), arr, c: dep(vinf) + arr };
  };
  const back = (t1, tof) => {
    const A = stateAt(ast, t1), E = stateAt(earth, t1 + tof);
    const L = lambert(A.r, E.r, tof); if (!L) return null;
    const vArr = norm(sub(L[1], E.v)) * KMS, vEntry = entrySpeed(vArr); if (vEntry > 20) return null;
    return { tofRet: tof, d3: norm(sub(L[0], A.v)) * KMS + brake(vArr), vEntry };
  };
  // 1) coarse outbound grid
  const outs = [];
  for (let t0 = jd0 + 30; t0 < jd0 + years * 365.25; t0 += 15)
    for (let tof = 30; tof <= 720; tof += 30) { const o = out(t0, tof); if (o) outs.push(o); }
  outs.sort((a, b) => a.c - b.c);
  // 2) refine the best distinct windows
  const seeds = [];
  for (const o of outs) { if (seeds.every(s => Math.abs(s.t0 - o.t0) > 45 || Math.abs(s.tof - o.tof) > 90)) seeds.push(o); if (seeds.length >= 14) break; }
  const refined = [];
  for (const s of seeds) {
    let b = s;
    for (const [dt, dd] of [[10, 15], [4, 6], [2, 2]])
      for (let t0 = Math.max(jd0 + 30, b.t0 - dt * 2); t0 <= Math.min(jd0 + years * 365.25, b.t0 + dt * 2); t0 += dt)  // never before now+30 d
        for (let tof = Math.max(20, b.tof - dd * 2); tof <= Math.min(MAX_TOF, b.tof + dd * 2); tof += dd) { const o = out(t0, tof); if (o && o.c < b.c) b = o; }
    refined.push(b);
  }
  // 3) return leg for each refined window
  let best = null;
  for (const o of refined) {
    const t1 = o.t0 + o.tof + stayDays;
    let r = null;
    for (let tof = 30; tof <= 720; tof += 20) { const x = back(t1, tof); if (x && (!r || x.d3 < r.d3)) r = x; }
    if (!r) continue;
    for (const dd of [8, 3, 1]) for (let tof = r.tofRet - dd * 2; tof <= Math.min(MAX_TOF, r.tofRet + dd * 2); tof += dd) { const x = tof >= 20 && back(t1, tof); if (x && x.d3 < r.d3) r = x; }
    const total = o.d1 + o.arr + r.d3;
    if (!best || total < best.total) best = { ...o, ...r, total, t1, t2: t1 + r.tofRet };
  }
  return best;
}

// Cheapest round trip for a departure on exactly day t0 (outbound TOF and return TOF free).
export function fixedLaunch(earth, ast, t0, { stayDays = 270, base = 'earth' } = {}) {
  const dep = base === 'moon' ? depMoon : depLEO;
  const E = stateAt(earth, t0), outs = [];
  for (let tof = 20; tof <= 900; tof += 5) {
    const A = stateAt(ast, t0 + tof);
    const L = lambert(E.r, A.r, tof); if (!L) continue;
    const vinf = norm(sub(L[0], E.v)) * KMS, arr = norm(sub(A.v, L[1])) * KMS;
    outs.push({ t0, tof, vinf, d1: dep(vinf), arr });
  }
  outs.sort((a, b) => (a.d1 + a.arr) - (b.d1 + b.arr));
  let best = null;
  for (const o of outs.slice(0, 25)) {
    const t1 = o.t0 + o.tof + stayDays, A = stateAt(ast, t1);
    for (let tof = 30; tof <= 900; tof += 10) {
      const E2 = stateAt(earth, t1 + tof);
      const L = lambert(A.r, E2.r, tof); if (!L) continue;
      const vArr = norm(sub(L[1], E2.v)) * KMS, vEntry = entrySpeed(vArr);
      const d3 = norm(sub(L[0], A.v)) * KMS + brake(vArr);
      const total = o.d1 + o.arr + d3;
      if (!best || total < best.total) best = { ...o, tofRet: tof, d3, vEntry, total, t1, t2: t1 + tof };
    }
  }
  return best;
}
