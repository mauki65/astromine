// Keplerian propagation, heliocentric ecliptic, top-down (x,y) in AU.
const D2R = Math.PI / 180, K = 0.01720209895; // Gaussian grav. const (rad/day, AU)

export const jdNow = (ms = Date.now()) => ms / 86400000 + 2440587.5;

function solveE(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d; if (Math.abs(d) < 1e-9) break;
  }
  return E;
}

// precompute rotation for an orbit
export function orbitBasis(a, e, iDeg, omDeg, wDeg) {
  const i = iDeg * D2R, O = omDeg * D2R, w = wDeg * D2R;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i);
  return {
    a, e, b: a * Math.sqrt(1 - e * e),
    Px: cO * cw - sO * sw * ci, Py: sO * cw + cO * sw * ci,
    Qx: -cO * sw - sO * cw * ci, Qy: -sO * sw + cO * cw * ci,
    n: K / Math.pow(a, 1.5),
  };
}

export function posAt(B, M) {
  const E = solveE(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), B.e);
  const x = B.a * (Math.cos(E) - B.e), y = B.b * Math.sin(E);
  return [B.Px * x + B.Qx * y, B.Py * x + B.Qy * y];
}

export function orbitPath(B, steps = 160) {
  const pts = new Float32Array(steps * 2);
  for (let k = 0; k < steps; k++) {
    const E = k / steps * 2 * Math.PI;
    const x = B.a * (Math.cos(E) - B.e), y = B.b * Math.sin(E);
    pts[2 * k] = B.Px * x + B.Qx * y; pts[2 * k + 1] = B.Py * x + B.Qy * y;
  }
  return pts;
}

// JPL approximate planetary elements (Standish), J2000 + rates per century
const PL = {
  Venus:   { el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], r: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], color: '#d8c79a', size: 4 },
  Earth:   { el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], r: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0], color: '#5ab0ff', size: 5 },
  Mars:    { el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], r: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], color: '#e07a5f', size: 4 },
  Jupiter: { el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], r: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], color: '#d9a066', size: 7 },
  Saturn:  { el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], r: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], color: '#e3cf8f', size: 6, ring: true },
};

export function planets(jd) {
  const T = (jd - 2451545) / 36525, out = {};
  for (const [name, p] of Object.entries(PL)) {
    const [a, e, i, L, wbar, O] = p.el.map((v, k) => v + p.r[k] * T);
    const B = orbitBasis(a, e, i, O, wbar - O);
    const M = (L - wbar) * D2R;
    out[name] = { name, B, pos: posAt(B, M), color: p.color, size: p.size, ring: p.ring };
  }
  return out;
}

// Moon geocentric direction (mean longitude only – for display)
export function moonAngle(jd) { return (218.316 + 13.176396 * (jd - 2451545)) * D2R; }
