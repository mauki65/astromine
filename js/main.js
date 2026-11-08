import { MATERIALS, ORDER, CLASSES, TIERS, DEFAULTS, EVIDENCE, evaluate } from './model.js';
import { buildObjects, rankAll, pricesFrom, refreshSpot, applyLambert, decodeLambert, decodeRows } from './pipeline.js';
import { body, fixedLaunch, depLEO, depMoon } from './lambert.js';
import { jdNow, orbitBasis, posAt, orbitPath, planets, moonAngle, planetElements } from './orbits.js';

const $ = s => document.querySelector(s);
const OZT = 0.0311034768;

// ---------- state ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('astromine.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('astromine.' + k, JSON.stringify(v)); } catch {} },
};
const S = { ...DEFAULTS, ...store.get('settings', {}) };
delete S.costMoon; if (!(S.moonPct >= 0)) S.moonPct = DEFAULTS.moonPct;
const st = {
  jd: jdNow(), live: true, playing: false, speed: 30, frame: store.get('frame', 'earth'),
  view: { cx: 0, cy: 0, scale: 1 }, sel: null, hover: null,
  tiers: new Set(TIERS.map(t => t.key)), comets: store.get('comets', false), asteroids: store.get('asteroids', true), group: 'all', onlyProfit: false, query: '',
};
let objs = [], ranked = [], prices = {}, priceMeta = {}, overrides = store.get('overrides', {});
let posX, posY, pl, cad = new Map(), meta = {};

// ---------- formatting ----------
const money = v => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'k';
  return s + '$' + a.toFixed(a < 10 ? 2 : 0);
};
const mass = kg => kg >= 1e12 ? (kg / 1e12).toPrecision(3) + ' Gt' : kg >= 1e9 ? (kg / 1e9).toPrecision(3) + ' Mt' : kg >= 1e3 ? (kg / 1e3).toPrecision(3) + ' t' : kg.toPrecision(3) + ' kg';
const grade = g => g >= 0.001 ? +(g * 100).toPrecision(2) + ' %' : +(g * 1e6).toPrecision(2) + ' ppm';
const dist = km => km >= 1 ? km.toPrecision(3) + ' km' : Math.round(km * 1000) + ' m';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const typeLabel = o => o.comet ? 'Comet' : o.cls === 'D' && o.a > 4.5 ? (o.class === 'TJN' ? 'Trojan · D-type' : 'D-type') : o.cls + '-type';
const shortName = n => n.replace(/^\((.*)\)$/, '$1');

// ---------- prices ----------
function effectivePrices() { return pricesFrom(priceMeta, overrides); }
async function refreshLive() {
  if (await refreshSpot(priceMeta)) { recompute(); renderMaterials(); }
  updateStatus();
}

// ---------- data ----------
async function load() {
  const [pr, ca] = await Promise.all([
    fetch('data/prices.json', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ metals: {} })),
    fetch('data/close-approaches.json', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ list: [] })),
  ]);
  priceMeta = pr.metals || {};
  let ast;
  try { ast = await fetch('data/asteroids.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw 0; return r.json(); }); }
  catch {
    const d = document.createElement('div'); d.className = 'empty';
    d.innerHTML = 'No asteroid data yet.<br>Run the “Update space data” workflow in the GitHub Actions tab once — it pulls the catalogue from NASA/JPL.';
    $('#tab-map').append(d); ast = { rows: [], fields: [] };
  }
  meta = { generated: ast.generated, source: ast.source, prices: pr.generated };
  const J = f => fetch(`data/${f}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [nh, com, lam, tax] = await Promise.all([J('nhats.json'), J('comets.json'), J('lambert.json'), J('taxonomy.json')]);
  meta.lambert = lam?.generated;
  objs = buildObjects({ ast, com, nh, lam, tax, cad: ca }, o => {
    o.B = orbitBasis(o.a, o.e, o.i, o.om, o.w);
    o.M0 = o.ma * Math.PI / 180;
  });
  posX = new Float32Array(objs.length); posY = new Float32Array(objs.length);
  recomputeNow(); renderFilters();
  // deep link: ?obj=Bennu opens that object (used by the report page)
  const want = new URLSearchParams(location.search).get('obj');
  if (want) {
    const w = want.toLowerCase(), hit = objs.find(o => shortName(o.name).toLowerCase() === w) || objs.find(o => o.name.toLowerCase().includes(w));
    if (hit) { if (hit.comet && !st.comets) setLayer('comets', true); setTimeout(() => { select(hit); focus(hit); }, 50); }
  }
  fit();
  propagate();
  refreshLive();
  setInterval(refreshLive, 60000);
}

let rcTimer;
function recomputeNow() {
  prices = effectivePrices();
  ranked = rankAll(objs, S, prices);   // same function the report and the hourly job use
  for (const o of objs) o.evDate = o.dvDate && S.launchMode === 'date' ? evaluate({ ...o, dv: o.dvDate }, S, prices) : null;
  renderLegend(); renderList(); if (st.sel) renderDetail(st.sel); draw(); renderMaterials();
}
function recompute() { clearTimeout(rcTimer); rcTimer = setTimeout(recomputeNow, 30); }

// ---------- map ----------
const cv = $('#map'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  draw();
}
function fit() { st.view = { cx: 0, cy: 0, scale: Math.min(W, H) / 2 / (st.frame === 'earth' ? 6.3 : 5.6) }; }
const MAXR = 11; // AU shown

function propagate() {
  pl = planets(st.jd);
  if (st.sel && S.launchMode === 'date' && st.sel.lamDate?.key !== lamKey()) optimise(st.sel, 150);
  for (let k = 0; k < objs.length; k++) {
    const o = objs[k];
    const [x, y] = posAt(o.B, o.M0 + o.B.n * (st.jd - o.epoch));
    posX[k] = x; posY[k] = y;
  }
  draw();
}

const origin = () => st.frame === 'earth' && pl ? pl.Earth.pos : [0, 0];
const toS = (x, y, O) => [W / 2 + (x - O[0] - st.view.cx) * st.view.scale, H / 2 - (y - O[1] - st.view.cy) * st.view.scale];

function visible(o) {
  if (o.comet ? !st.comets : !st.asteroids) return false;
  if (!st.tiers.has(o.tier.key)) return false;
  if (st.group === 'neo' && !o.neo) return false;
  if (st.group === 'belt' && o.neo) return false;
  if (st.group === 'metal' && !(o.cls === 'M' || o.cls === 'X')) return false;
  if (st.group === 'water' && !(o.cls === 'C' || o.cls === 'D' || o.cls === 'K')) return false;
  if (st.onlyProfit && o.ev.profit <= 0) return false;
  return true;
}

function strokePath(pts, O) {
  ctx.beginPath();
  for (let k = 0; k < pts.length; k += 2) {
    const [sx, sy] = toS(pts[k], pts[k + 1], O);
    k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
  }
  ctx.closePath(); ctx.stroke();
}

// Tier shapes (not only colours) so tiers stay distinguishable for colour-blind viewers.
export const SHAPE = { common: 'dot', uncommon: 'square', rare: 'circle', epic: 'triangle', legendary: 'diamond', mythic: 'star' };
function shapePath(kind, x, y, r) {
  ctx.beginPath();
  if (kind === 'triangle') { const h = r * 1.25; ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.95, y + h * 0.6); ctx.lineTo(x - h * 0.95, y + h * 0.6); ctx.closePath(); }
  else if (kind === 'diamond') { const h = r * 1.3; ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); }
  else if (kind === 'star') { const R = r * 1.5, q = R * 0.45; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? q : R; k ? ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.closePath(); }
  else if (kind === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r);
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}

let raf = 0;
function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawNow(); }); }
function drawNow() {
  ctx.fillStyle = '#06070a'; ctx.fillRect(0, 0, W, H);
  if (!pl) return;
  const O = origin(), sc = st.view.scale;

  // distance rings (AU) around frame origin
  ctx.strokeStyle = '#11141a'; ctx.lineWidth = 1; ctx.fillStyle = '#2a2f3a'; ctx.font = '10px JetBrains Mono, monospace';
  const [ox, oy] = toS(O[0], O[1], O);
  for (let r = 1; r <= (st.frame === 'earth' ? MAXR + 1 : MAXR); r++) {
    if (r > 6 && r % 2) continue;
    ctx.beginPath(); ctx.arc(ox, oy, r * sc, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText(r + ' AU', ox + 4, oy - r * sc - 3);
  }

  // planet orbits
  ctx.lineWidth = 1;
  for (const p of Object.values(pl)) {
    if (!p.path) p.path = orbitPath(p.B, 256);
    ctx.strokeStyle = p.name === 'Earth' ? 'rgba(90,176,255,.35)' : 'rgba(255,255,255,.09)';
    strokePath(p.path, O);
  }

  // asteroids — draw low tiers first
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const big = sc > 400;
  for (const tk of order) {
    if (!st.tiers.has(tk)) continue;
    const T = TIERS.find(t => t.key === tk);
    if (tk === 'common') {
      ctx.fillStyle = 'rgba(138,143,152,.55)';
      for (let k = 0; k < objs.length; k++) {
        const o = objs[k]; if (o.tier.key !== tk || !visible(o)) continue;
        const [sx, sy] = toS(posX[k], posY[k], O);
        if (sx < -5 || sy < -5 || sx > W + 5 || sy > H + 5) continue;
        ctx.fillRect(sx - 0.8, sy - 0.8, 1.6, 1.6);
      }
      continue;
    }
    if (tk === 'uncommon') {
      ctx.fillStyle = T.color; ctx.globalAlpha = 0.75;
      for (let k = 0; k < objs.length; k++) {
        const o = objs[k]; if (o.tier.key !== tk || !visible(o)) continue;
        const [sx, sy] = toS(posX[k], posY[k], O);
        if (sx < -5 || sy < -5 || sx > W + 5 || sy > H + 5) continue;
        ctx.fillRect(sx - 1.1, sy - 1.1, 2.2, 2.2);
      }
      ctx.globalAlpha = 1; continue;
    }
    const rad = { rare: 2.6, epic: 3.3, legendary: 4.2, mythic: 5 }[tk] + (big ? 1 : 0);
    ctx.strokeStyle = T.color; ctx.lineWidth = tk === 'mythic' ? 2.2 : tk === 'legendary' ? 1.8 : 1.3; ctx.fillStyle = '#06070a';
    for (let k = 0; k < objs.length; k++) {
      const o = objs[k]; if (o.tier.key !== tk || !visible(o)) continue;
      const [sx, sy] = toS(posX[k], posY[k], O);
      if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
      if (tk === 'mythic') {  // pulsing red halo
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
        ctx.save(); ctx.globalAlpha = 0.15 + 0.2 * pulse; ctx.strokeStyle = T.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, rad + 6 + 3 * pulse, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (tk === 'legendary' || tk === 'mythic') {
        ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = T.color;
        ctx.beginPath(); ctx.arc(sx, sy, rad + 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      shapePath(SHAPE[tk], sx, sy, rad); ctx.fill(); ctx.stroke();
    }
  }

  // comets: tier-coloured diamond + anti-sunward tail
  if (st.comets) {
    for (let k = 0; k < objs.length; k++) {
      const o = objs[k]; if (!o.comet || !visible(o)) continue;
      const [sx, sy] = toS(posX[k], posY[k], O);
      if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
      const r = Math.hypot(posX[k], posY[k]), L = Math.max(0, 28 * (3 - r) / 3);
      if (L > 1) {
        const ux = posX[k] / r, uy = -posY[k] / r, g = ctx.createLinearGradient(sx, sy, sx + ux * L, sy + uy * L);
        g.addColorStop(0, 'rgba(111,195,223,.7)'); g.addColorStop(1, 'rgba(111,195,223,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * L, sy + uy * L); ctx.stroke();
      }
      const d = o.tier.key === 'common' ? 2.2 : 3.2;
      ctx.strokeStyle = o.tier.color; ctx.fillStyle = '#06070a'; ctx.lineWidth = 1.3;
      shapePath(o.tier.key === 'common' || o.tier.key === 'uncommon' ? 'circle' : SHAPE[o.tier.key], sx, sy, d); ctx.fill(); ctx.stroke();
    }
  }

  // selected orbit
  for (const o of [st.hover, st.sel]) {
    if (!o) continue;
    if (!o.path) o.path = orbitPath(o.B, 200);
    ctx.strokeStyle = o.tier.color; ctx.globalAlpha = o === st.sel ? 0.8 : 0.4; ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]); strokePath(o.path, O); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const k = objs.indexOf(o), [sx, sy] = toS(posX[k], posY[k], O);
    ctx.strokeStyle = o.tier.color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
    if (o === st.sel) { ctx.fillStyle = '#e6e8ec'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(shortName(o.name), sx + 13, sy + 4); }
  }

  // Sun
  const [sx, sy] = toS(0, 0, O);
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 18);
  g.addColorStop(0, 'rgba(255,214,120,.9)'); g.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd98a'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9aa0ab'; ctx.font = '11px Inter, sans-serif'; ctx.fillText('Sun', sx + 9, sy + 4);

  // planets + Moon
  ctx.font = '11px Inter, sans-serif';
  for (const p of Object.values(pl)) {
    const [px, py] = toS(p.pos[0], p.pos[1], O);
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI * 2); ctx.fill();
    if (p.ring) { ctx.strokeStyle = 'rgba(227,207,143,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(px, py, p.size + 5, (p.size + 5) * 0.35, -0.4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#9aa0ab'; ctx.fillText(p.name, px + p.size + 5, py + 4);
    if (p.name === 'Earth') {
      const a = moonAngle(st.jd), mr = Math.max(14, 0.00257 * sc);
      const mx = px + Math.cos(a) * mr, my = py - Math.sin(a) * mr;
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(px, py, mr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#c9ccd2'; ctx.beginPath(); ctx.arc(mx, my, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b717c'; ctx.font = '10px Inter, sans-serif'; ctx.fillText('Moon', mx + 5, my + 3); ctx.font = '11px Inter, sans-serif';
    }
  }
}

function pick(mx, my) {
  const O = origin(); let best = null, bd = 12 * 12;
  for (let k = 0; k < objs.length; k++) {
    const o = objs[k]; if (!visible(o)) continue;
    const [sx, sy] = toS(posX[k], posY[k], O);
    const d = (sx - mx) ** 2 + (sy - my) ** 2;
    const bias = o.tier.key === 'common' ? 1.6 : 1;   // favour ranked objects
    if (d * bias < bd) { bd = d * bias; best = o; }
  }
  return best;
}

// interactions
let drag = null, moved = false;
cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: st.view.cx, cy: st.view.cy }; moved = false; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => {
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; cv.classList.add('drag'); }
    st.view.cx = drag.cx - dx / st.view.scale; st.view.cy = drag.cy + dy / st.view.scale; draw(); return;
  }
  const o = pick(mx, my);
  if (o !== st.hover) { st.hover = o; draw(); }
  const tip = $('#tip');
  if (o) {
    tip.style.display = 'block'; tip.style.left = (mx + 14) + 'px'; tip.style.top = (my + 10) + 'px';
    tip.innerHTML = `<b style="color:${o.tier.color}">${esc(shortName(o.name))}</b> · ${o.tier.label}<br><span class="muted">${typeLabel(o)} · ${dist(o.D)} · </span><span class="${o.ev.profit > 0 ? 'pos' : 'neg'}">${money(o.ev.profit)}</span>`;
  } else tip.style.display = 'none';
});
cv.addEventListener('pointerup', e => {
  cv.classList.remove('drag');
  if (drag && !moved) { const r = cv.getBoundingClientRect(); const o = pick(e.clientX - r.left, e.clientY - r.top); select(o); }
  drag = null;
});
cv.addEventListener('pointerleave', () => { st.hover = null; $('#tip').style.display = 'none'; draw(); });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - W / 2, my = e.clientY - r.top - H / 2;
  const f = Math.exp(-e.deltaY * 0.0015), s0 = st.view.scale, s1 = Math.min(20000, Math.max(Math.min(W, H) / 2 / 13, s0 * f));
  st.view.cx += mx / s0 - mx / s1; st.view.cy -= my / s0 - my / s1; st.view.scale = s1; draw();
}, { passive: false });
// pinch zoom
const touches = new Map(); let pinch0 = null;
cv.addEventListener('touchstart', e => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch0 = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: st.view.scale }; drag = null; } }, { passive: true });
cv.addEventListener('touchmove', e => { if (pinch0 && e.touches.length === 2) { const [a, b] = e.touches; st.view.scale = Math.min(20000, Math.max(Math.min(W, H) / 2 / 13, pinch0.s * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch0.d)); draw(); } }, { passive: true });
cv.addEventListener('touchend', () => { pinch0 = null; touches.clear(); });

function focus(o) {
  const k = objs.indexOf(o), O = origin();
  st.view.cx = posX[k] - O[0]; st.view.cy = posY[k] - O[1];
  st.view.scale = Math.max(st.view.scale, Math.min(W, H) / 2 / 1.2); draw();
}

// ---------- time ----------
let last = 0;
function tick(t) {
  if (!st.playing) return;
  const dt = last ? (t - last) / 1000 : 0; last = t;
  st.jd += dt * st.speed; propagate(); updateDate();
  requestAnimationFrame(tick);
}
$('#play').onclick = () => { st.playing = !st.playing; if (st.playing) st.live = false; if (!st.playing && st.sel) optimise(st.sel, 100); $('#play').textContent = st.playing ? '❚❚' : '▶'; last = 0; if (st.playing) requestAnimationFrame(tick); };
$('#speed').onchange = e => st.speed = +e.target.value;
$('#now').onclick = () => { st.live = true; st.playing = false; $('#play').textContent = '▶'; st.jd = jdNow(); propagate(); updateDate(); };
setInterval(() => { if (st.live && !st.playing && objs.length) { st.jd = jdNow(); propagate(); updateDate(); } }, 1000);
setInterval(async () => {  // pick up new catalogue/price commits from the hourly Action
  try { const j = await fetch('data/prices.json', { cache: 'no-store' }).then(r => r.json());
    let ch = false; for (const [k, m] of Object.entries(j.metals || {})) if (!priceMeta[k]?.live && priceMeta[k]?.usdPerKg !== m.usdPerKg) { priceMeta[k] = m; ch = true; }
    if (ch) recompute();
    // new trajectories from the hourly job → apply them so the map matches the report
    const l = decodeLambert(await fetch('data/lambert.json', { cache: 'no-store' }).then(r => r.json()));
    if (l.generated !== meta.lambert) {
      meta.lambert = l.generated;
      for (const o of objs) { const r = l.list[o.name]; if (r && !o.comet && r.at !== o.lam?.at) applyLambert(o, r); }
      recompute();
    }
  } catch {}
}, 300000);
function updateDate() {
  const d = new Date((st.jd - 2440587.5) * 86400000);
  $('#date').innerHTML = st.live && !st.playing ? '<span class="live"></span>' + d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : d.toISOString().slice(0, 10);
}
segment('#frame', st.frame, v => { st.frame = v; store.set('frame', v); fit(); draw(); });

// ---------- UI: settings ----------
const FIELDS = [
  ['h', 'Costs'],
  ['costEarth', 'Earth → LEO launch ($/kg)'],
  ['moonPct', 'Moon → lunar orbit (% of Earth)', 'moon'],
  ['buildCost', 'Spacecraft build ($M)'],
  ['opsCost', 'Operations ($M / year)'],
  ['procCost', 'Processing ($ / t ore)'],
  ['h', 'Spacecraft'],
  ['dryMass', 'Dry mass (t)'],
  ['isp', 'Engine Isp (s)'],
  ['oreCap', 'Ore processed (t)'],
  ['returnCap', 'Max return cargo (t)'],
  ['stayMonths', 'Time at asteroid (months)'],
  ['h', 'Risk & market'],
  ['recovery', 'Metal recovery (%)'],
  ['risk', 'Mission failure risk (%)'],
  ['isru', 'Make return fuel from asteroid water', 'chk'],
  ['impact', 'Price drops if you flood the market', 'chk'],
];
function renderSettings() {
  $('#settings').innerHTML = FIELDS.map(([k, label, x]) => {
    if (k === 'h') return `<h4>${label}</h4>`;
    if (x === 'chk') return `<label class="chk"><input type="checkbox" data-k="${k}" ${S[k] ? 'checked' : ''}>${label}</label>`;
    if (x && x !== S.base) return '';
    return `<label for="s-${k}">${label}</label><input id="s-${k}" type="number" min="0" step="any" data-k="${k}" value="${S[k]}">`;
  }).join('');
  $('#settings').querySelectorAll('input').forEach(inp => inp.oninput = () => {
    S[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : Math.max(0, +inp.value || 0);
    if (inp.dataset.k === 'stayMonths') resetLambert();
    store.set('settings', S); recompute();
  });
}
segment('#base', S.base, v => { S.base = v; store.set('settings', S); renderSettings(); recompute(); resetLambert(); });
segment('#launch', S.launchMode, v => { S.launchMode = v; store.set('settings', S); resetLambert(); });
function resetLambert() { for (const o of objs) if (o.lamDate || o.dvDate) { o.dvDate = null; o.lamDate = null; } if (st.sel) optimise(st.sel); recompute(); }
$('#reset').onclick = () => { Object.assign(S, DEFAULTS); store.set('settings', S); segment('#base', S.base); segment('#launch', S.launchMode); resetLambert(); renderSettings(); recompute(); };
$('#collapse-left').onclick = () => { const p = $('#mission'); p.classList.toggle('collapsed'); $('#collapse-left').textContent = p.classList.contains('collapsed') ? '+' : '–'; };

function segment(sel, val, cb) {
  const el = $(sel);
  el.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === val);
    if (cb) b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); cb(b.dataset.v); };
  });
}

// ---------- UI: legend, filters, list ----------
function icon(kind, c) {
  const P = { dot: '<circle cx="7" cy="7" r="2" fill="C"/>', square: '<rect x="4" y="4" width="6" height="6" fill="C"/>',
    circle: '<circle cx="7" cy="7" r="4.2" fill="none" stroke="C" stroke-width="1.8"/>',
    triangle: '<path d="M7 2.2 12 11H2z" fill="none" stroke="C" stroke-width="1.6" stroke-linejoin="round"/>',
    diamond: '<path d="M7 1.6 12.4 7 7 12.4 1.6 7z" fill="none" stroke="C" stroke-width="1.6"/>',
    star: '<path d="M7 1 8.6 5.1 13 5.3 9.6 8 10.8 12.3 7 9.9 3.2 12.3 4.4 8 1 5.3 5.4 5.1z" fill="none" stroke="C" stroke-width="1.5" stroke-linejoin="round"/>' };
  return `<svg class="ic" width="14" height="14" viewBox="0 0 14 14">${P[kind].replace(/C/g, c)}</svg>`;
}
function renderLegend() {
  const counts = {};
  for (const o of objs) if (o.comet ? st.comets : st.asteroids) counts[o.tier.key] = (counts[o.tier.key] || 0) + 1;
  const nA = objs.filter(o => !o.comet).length, nC = objs.length - nA;
  $('#legend').innerHTML = [...TIERS].map(t => `<button data-t="${t.key}" class="${st.tiers.has(t.key) ? '' : 'off'}">${icon(SHAPE[t.key], t.color)}<b>${t.label}</b><span class="mono">${(counts[t.key] || 0).toLocaleString()}</span></button>`).join('') +
    `<span class="lsep"></span>` +
    `<button data-k="asteroids" class="${st.asteroids ? '' : 'off'}"><svg class="ic" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.2" fill="none" stroke="#9aa0ab" stroke-width="1.8"/></svg><b>Asteroids</b><span class="mono">${nA.toLocaleString()}</span></button>` +
    `<button data-k="comets" class="${st.comets ? '' : 'off'}"><svg class="ic" width="14" height="14" viewBox="0 0 14 14"><path d="M5 9 13 1" stroke="#6fc3df" stroke-width="1.6" opacity=".6"/><circle cx="4.5" cy="9.5" r="3" fill="none" stroke="#6fc3df" stroke-width="1.6"/></svg><b>Comets</b><span class="mono">${nC.toLocaleString()}</span></button>`;
  $('#legend').querySelectorAll('button').forEach(b => b.onclick = () => {
    if (b.dataset.k) setLayer(b.dataset.k, !st[b.dataset.k]);
    else { const k = b.dataset.t; st.tiers.has(k) ? st.tiers.delete(k) : st.tiers.add(k); renderLegend(); renderList(); draw(); }
  });
}
function setLayer(k, on) {
  st[k] = on; store.set(k, on);
  if (st.sel && !visible(st.sel)) select(null);
  const cb = $('#show-comets'); if (cb) cb.checked = st.comets;
  renderLegend(); renderList(); draw();
}
const GROUPS = [['all', 'All'], ['neo', 'Near-Earth'], ['belt', 'Belt'], ['metal', 'Metal-rich'], ['water', 'Water-rich']];
function renderFilters() {
  $('#filters').innerHTML = GROUPS.map(([k, l]) => `<button class="chip ${st.group === k ? 'on' : ''}" data-g="${k}">${l}</button>`).join('') +
    `<button class="chip ${st.onlyProfit ? 'on' : ''}" data-p="1">Profitable only</button>` +
    `<div class="evkey">${Object.values(EVIDENCE).map(e => `<span title="${e.note}"><i class="evd" style="background:${e.color}"></i>${e.label}</span>`).join('')}</div>` +
    `<label class="tick"><input type="checkbox" id="show-comets" ${st.comets ? 'checked' : ''}> Show short-period comets <span class="muted">(${objs.filter(o => o.comet).length.toLocaleString()})</span></label>`;
  $('#show-comets').onchange = e => setLayer('comets', e.target.checked);
  $('#filters').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    if (b.dataset.p) st.onlyProfit = !st.onlyProfit; else st.group = b.dataset.g;
    renderFilters(); renderList(); draw();
  });
}
$('#search').oninput = e => { st.query = e.target.value.trim().toLowerCase(); renderList(); };

function renderList() {
  const q = st.query;
  const list = [];
  for (const o of ranked) {
    if (o.comet ? !st.comets : !st.asteroids) continue;
    if (q ? !o.name.toLowerCase().includes(q) : !visible(o)) continue;
    list.push(o); if (list.length >= 60) break;
  }
  const prof = objs.filter(o => o.ev.profit > 0 && (o.comet ? st.comets : st.asteroids)).length;
  $('#tcount').textContent = `${prof.toLocaleString()} profitable`;
  $('#tlist').innerHTML = list.map(o => `<li data-i="${objs.indexOf(o)}">
    <span class="bar" style="background:${o.tier.color}"></span>
    <span><div class="n">${icon(SHAPE[o.tier.key], o.tier.color)} ${esc(shortName(o.name))}</div><div class="s"><i class="evd" style="background:${EVIDENCE[o.evidence].color}" title="${EVIDENCE[o.evidence].label}"></i>#${o.rank} · ${typeLabel(o)} · ${dist(o.D)} · Δv ${(o.ev.dvOut + o.ev.dvRet).toFixed(1)}${o.dv.src === 'estimate' ? '~' : ''} km/s</div></span>
    <span class="v ${o.ev.profit > 0 ? 'pos' : 'neg'}">${money(o.ev.profit)}</span></li>`).join('') || '<li class="muted" style="display:block">No matches</li>';
  $('#tlist').querySelectorAll('li[data-i]').forEach(li => li.onclick = () => { const o = objs[+li.dataset.i]; select(o); focus(o); });
}

// ---------- detail ----------
function select(o) {
  st.sel = o;
  $('#detail').hidden = !o; $('#targets').hidden = !!o;
  if (o) { renderDetail(o); optimise(o); }
  draw();
}
// Best launch windows are precomputed hourly (data/lambert.json) and shared by every view.
// "On map date" prices a launch on exactly the clock's date for the selected object only;
// it never changes ranks or tiers.
let lamTimer = 0, lamPending = false;
function lamKey() { return `${S.base}|${S.stayMonths}|${Math.round(st.jd)}`; }
function optimise(o, delay = 30) {
  if (!o || S.launchMode !== 'date' || o.Q > 6 || o.comet) return;
  if (o.lamDate && o.lamDate.key === lamKey()) return;
  if (lamPending && delay < 1e6) return;            // throttle while the clock runs
  clearTimeout(lamTimer); lamPending = true;
  o.lamBusy = !o.lamDate;
  const box = $('#lam'); if (box) box.innerHTML = lamText(o);
  lamTimer = setTimeout(() => {
    lamPending = false;
    if (st.sel !== o || S.launchMode !== 'date') { o.lamBusy = false; return; }
    const jd = st.jd, pe = planetElements('Earth', jd), key = lamKey();
    const earth = body(pe.a, pe.e, pe.i, pe.om, pe.w, pe.M, jd);
    const ast = body(o.a, o.e, o.i, o.om, o.w, o.M0 + o.B.n * (jd - o.epoch), jd);
    const r = fixedLaunch(earth, ast, jd, { stayDays: S.stayMonths * 30.44, base: S.base });
    o.lamBusy = false;
    o.lamDate = r ? { ...r, key } : { none: true, key };
    o.dvDate = r ? { ...o.dv, leo: depLEO(r.vinf), moon: depMoon(r.vinf), dvArr: r.arr, ret: r.d3, transferYr: (r.tof + r.tofRet) / 2 / 365.25, src: 'lambert-date' } : null;
    recompute();
  }, delay);
}
const rt = d => (S.base === 'moon' ? d.moon : d.leo) + d.dvArr + d.ret;
function lamText(o) {
  const d = o.dv, nh = d.nhats ? ` NASA NHATS best (8-day stay): ${d.nhats.dv.toFixed(2)} km/s.` : '';
  const legs = r => `launch <b>${jdDate(r.t0)}</b>, arrive ${jdDate(r.t0 + r.tof)}, leave ${jdDate(r.t1)}, back ${jdDate(r.t2)}. Atmospheric entry at ${Math.min(12, r.vEntry).toFixed(1)} km/s${r.vEntry > 12.05 ? ` (after a braking burn from ${r.vEntry.toFixed(1)})` : ''}.`;
  if (S.launchMode === 'date') {
    if (o.Q > 6 || o.comet) return 'Fixed-date launches are only computed for objects within 6 AU (not comets).';
    if (o.lamBusy || !o.lamDate) return `Computing a launch on ${jdDate(st.jd)}…`;
    if (o.lamDate.none) return `No round trip found for a launch on ${jdDate(st.jd)}.`;
    return `<b>Launch on map date</b> (${rt(o.dvDate || o.dv).toFixed(2)} km/s total) — ${legs(o.lamDate)}${o.lam ? ` Best window instead: ${jdDate(o.lam.t0)} at ${rt(o.dv).toFixed(2)} km/s.` : ''} <span class="muted">Rank and tier stay based on the best window.</span>`;
  }
  const stayNote = o.lam && Math.round(S.stayMonths * 30.44) !== o.lam.stay ? ` <span class="muted">(windows computed for a ${Math.round(o.lam.stay / 30.44)}-month stay)</span>` : '';
  if (o.lam) return `<b>Best launch window</b> (exact trajectory, ${rt(d).toFixed(2)} km/s round trip) — ${legs(o.lam)}${nh}${stayNote}`;
  if (d.src === 'nhats') return `Δv from <b>NASA NHATS</b>: ${d.nhats.dv.toFixed(2)} km/s round trip, ${d.nhats.dur} days (launch ${d.nhats.w}). Exact trajectory pending in the hourly job.`;
  return 'Δv is a Hohmann-transfer <b>estimate</b> — not a mining candidate at default costs, so no exact trajectory was computed.';
}
const jdDate = jd => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
function renderDetail(o) {
  const ev = o.evDate || o.ev, T = o.tier, el = $('#detail');
  el.style.setProperty('--tier', T.color);
  const conf = Math.round(o.conf * 100);
  const maxV = Math.max(...ev.items.map(i => i.value), 1);
  const ca = o.ca ? `<div class="callout">☄ Close approach to Earth on <b>${esc(o.ca.date)}</b> at ${(o.ca.distAU * 389.17).toFixed(1)} lunar distances — a short-trip launch window.</div>` : '';
  const sb = encodeURIComponent(o.name.match(/^\d+/)?.[0] || (o.name.match(/\(([^)]+)\)/)?.[1] || o.name));
  el.innerHTML = `
  <div class="dh">
    <div class="row"><div><h2>${esc(shortName(o.name))}</h2>
      <span class="badge" title="Rank uses the best launch window">${icon(SHAPE[T.key], T.color)} ${T.label} · #${o.rank.toLocaleString()}</span><span class="verdict ${ev.profit > 0 ? 'pos' : 'neg'}">${ev.profit > 0 ? 'Worth mining' : 'Not worth it'}</span></div>
      <button class="icon" id="close" title="Close">✕</button></div>
  </div>
  <div class="db">
    <div class="muted">Expected profit per mission</div>
    <div class="big ${ev.profit > 0 ? 'pos' : 'neg'}">${money(ev.profit)}</div>
    <div class="muted" style="margin-bottom:12px">ROI ${(ev.roi * 100).toFixed(0)} % · ${ev.years.toFixed(1)} yr mission</div>
    ${ca}
    <h3>What it’s made of</h3>
    <div class="kv">
      <span>Type</span><span>${CLASSES[o.cls].label}</span>
      <span>Evidence</span><span>${esc(o.basis)}</span>
      <span>Data quality</span><span><span class="ev" style="--c:${EVIDENCE[o.evidence].color}" title="${EVIDENCE[o.evidence].note}">${EVIDENCE[o.evidence].label}</span>${o.radar ? ' <span class="ev" style="--c:#6fc3df" title="Size, shape and spin measured by Goldstone/Arecibo radar">Radar-scanned</span>' : ''}</span>
      <span>Confidence</span><span>${conf} %</span>
      <span>Meteorite analogue</span><span>${CLASSES[o.cls].analog}</span>
    </div>
    <table class="mats"><tbody>
    ${ev.items.filter(i => i.k !== 'Fe' || i.taken > 0).map(i => `<tr><td><span class="dot" style="background:${MATERIALS[i.k].color}"></span>${MATERIALS[i.k].name}<div class="meter"><i style="width:${(i.value / maxV * 100).toFixed(1)}%;background:${MATERIALS[i.k].color}"></i></div></td>
      <td title="Chance it is present at this grade">${Math.round(i.chance * 100)}%</td><td title="Grade">${grade(i.grade)}</td><td title="Returned">${i.taken > 0 ? mass(i.taken) : '–'}</td><td title="Expected value">${i.value > 0 ? money(i.value) : '–'}</td></tr>`).join('')}
    </tbody></table>
    <div class="note">Chance × grade × recovery × price. Cargo filled with the most valuable material first, up to ${S.returnCap} t.</div>
    <h3>Economics</h3>
    <div class="kv">
      <span>Expected revenue (after ${S.risk}% risk)</span><span class="pos">${money(ev.expRevenue)}</span>
      <span>Launch (${mass(ev.launchMass)} @ $${(S.base === 'moon' ? S.costEarth * S.moonPct / 100 : S.costEarth).toLocaleString()}/kg)</span><span class="neg">−${money(ev.costLaunch).slice(0)}</span>
      <span>Spacecraft + operations</span><span class="neg">−${money(ev.costFixed)}</span>
      <span>Processing ${mass(ev.ore)} ore</span><span class="neg">−${money(ev.costProc)}</span>
      <span>Return fuel</span><span>${ev.useIsru ? 'made from asteroid water' : mass(ev.propRet) + ' carried'}</span>
    </div>
    <h3>Getting there</h3>
    <div class="callout" id="lam">${lamText(o)}</div>
    <div class="kv">
      <span>Δv from ${S.base === 'moon' ? 'low lunar orbit' : 'low Earth orbit'}</span><span>${ev.dvOut.toFixed(2)} km/s</span>
      <span>Δv to return</span><span>${ev.dvRet.toFixed(2)} km/s</span>
      <span>${o.lam?.tof ? 'Trip out / back' : 'One-way trip'}</span><span>${o.lam?.tof ? Math.round(o.lam.tof) + ' d / ' + Math.round(o.lam.tofRet) + ' d' : (o.dv.transferYr * 12).toFixed(0) + ' months'}</span>
      <span>Diameter</span><span>${o.dEst ? '~' : ''}${dist(o.D)}${o.dEst ? ' (from brightness)' : ' (measured)'}</span>
      <span>Radar</span><span>${o.radar ? `observed · ${o.radar} measurements` : 'not observed'}</span>
      <span>Total mass</span><span>${mass(o.mass)}</span>
      <span>Orbit a / e / i</span><span>${o.a.toFixed(3)} AU / ${o.e.toFixed(3)} / ${o.i.toFixed(1)}°</span>
      <span>Perihelion – aphelion</span><span>${o.q.toFixed(2)} – ${o.Q.toFixed(2)} AU</span>
      ${o.moid != null ? `<span>Closest orbit distance to Earth</span><span>${o.moid.toFixed(4)} AU</span>` : ''}
      <span>Group</span><span>${o.neo ? 'Near-Earth' : 'Main belt / other'}${o.pha ? ' · PHA' : ''}${o.class ? ' · ' + o.class : ''}</span>
    </div>
    <button class="link" id="focus">Centre on map</button> · <a class="link" href="https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${sb}" target="_blank" rel="noopener">JPL record ↗</a>
  </div>`;
  $('#close').onclick = () => select(null);
  $('#focus').onclick = () => focus(o);
}

// ---------- materials tab ----------
function renderMaterials() {
  const tbl = $('#mat-table'); if (!tbl) return;
  const rows = ORDER.map(k => {
    const M = MATERIALS[k], m = priceMeta[k] || {}, ov = overrides[k] > 0;
    const src = ov ? '<span class="src">your price</span>' : m.live ? '<span class="src s-live">live</span>' : /reference|assumption/i.test(m.source || '') ? '<span class="src">reference</span>' : '<span class="src s-daily">daily</span>';
    const p = prices[k] || 0;
    const best = Object.entries(CLASSES).sort((a, b) => (b[1].g[k] || 0) - (a[1].g[k] || 0))[0];
    const perOz = M.group === 'pgm' ? `<div class="muted">$${(p * OZT).toLocaleString(undefined, { maximumFractionDigits: 0 })}/ozt</div>` : '';
    return `<tr><td><span class="dot" style="background:${M.color}"></span><b>${M.name}</b> <span class="muted">${k === 'water' ? 'H₂O' : k}</span></td>
      <td class="num">$${p.toLocaleString(undefined, { maximumFractionDigits: p < 100 ? 2 : 0 })}/kg${perOz}</td>
      <td>${src}<div class="muted" style="font-size:11px;margin-top:4px">${esc(m.source || '')}${m.asOf ? ' · ' + esc(String(m.asOf).slice(0, 16).replace('T', ' ')) : ''}</div></td>
      <td class="num">${M.supply >= 1e6 ? (M.supply / 1e6).toLocaleString() + ' Mt' : M.supply.toLocaleString() + ' t'}</td>
      <td>${best[0]}-type · ${grade(best[1].g[k])}</td>
      <td class="muted">${M.uses}</td>
      <td><input type="number" min="0" step="any" placeholder="auto" data-k="${k}" value="${ov ? overrides[k] : ''}"></td></tr>`;
  }).join('');
  tbl.innerHTML = `<thead><tr><th>Material</th><th style="text-align:right">Price</th><th>Source</th><th style="text-align:right">World supply /yr</th><th>Richest asteroid type</th><th>Used for</th><th>Override $/kg</th></tr></thead><tbody>${rows}</tbody>`;
  tbl.querySelectorAll('input').forEach(inp => inp.onchange = () => {
    const v = +inp.value; if (v > 0) overrides[inp.dataset.k] = v; else delete overrides[inp.dataset.k];
    store.set('overrides', overrides); recompute();
  });
  $('#class-table').innerHTML = `<thead><tr><th>Type</th><th>Analogue</th><th style="text-align:right">Value / t (all)</th><th style="text-align:right">Precious metals / t</th><th style="text-align:right">Water / t</th><th>Count on map</th></tr></thead><tbody>` +
    Object.entries(CLASSES).map(([c, C]) => {
      let all = 0, pgm = 0;
      for (const k of ORDER) { const v = (C.g[k] || 0) * 1000 * (prices[k] || 0); all += v; if (MATERIALS[k].group === 'pgm') pgm += v; }
      const n = objs.filter(o => o.cls === c).length;
      return `<tr><td><b>${C.label}</b></td><td class="muted">${C.analog}</td><td class="num">${money(all)}</td><td class="num">${money(pgm)}</td><td class="num">${money((C.g.water || 0) * 1000 * (prices.water || 0))}</td><td class="num">${n.toLocaleString()}</td></tr>`;
    }).join('') + '</tbody>';
  $('#mat-status').innerHTML = `Gold, silver, platinum, palladium and copper refresh live every minute from gold-api.com. Rhodium, iridium and ruthenium are checked hourly against Umicore (published once per business day). Others are reference values — override them to run your own scenario.`;
}

// ---------- status ----------
function updateStatus() {
  const live = Object.values(priceMeta).some(m => m.live);
  const gen = meta.generated ? new Date(meta.generated).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  $('#status').innerHTML = `<span>${live ? '<span class="live"></span>Prices live' : 'Prices: daily'}</span><span>${objs.length.toLocaleString()} objects · JPL ${gen}</span>`;
}

// ---------- tabs ----------
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'map') resize();
});

$('#about').innerHTML = `
<h1>How it works</h1>
<p>You run a space-mining company. Every dot is a real asteroid tracked by NASA/JPL, placed where it actually is today. Your job: pick the ones that make money and skip the ones that don’t.</p>
<h2>Data</h2>
<ul>
<li><b>Orbits</b> — NASA/JPL Small-Body Database: all near-Earth asteroids down to ~25 m, every body larger than 12 km out to ~11 AU (Saturn), the brighter Jupiter Trojans and the Centaurs, and every asteroid with a measured spectral type. Catalogue refreshed hourly by a GitHub Action. Positions are recomputed every second in your browser, so the map shows where everything is right now.</li>
<li><b>Comets</b> (optional layer) — short-period comets (Jupiter-family, Encke-, Chiron- and Halley-type) from the same database; composition from Rosetta’s measurements of comet 67P (~30% water ice). Diameters are often unknown, so many are assumed at 2 km. Ranked against the asteroid tiers, so turning them on never re-ranks asteroids.</li>
<li><b>Close approaches</b> — JPL Close-Approach API, next 120 days. Flagged as launch windows.</li>
<li><b>Prices</b> — Au/Ag/Pt/Pd/Cu refresh every minute in your browser (gold-api.com); Rh/Ir/Ru are checked hourly (Umicore publishes once per business day); the rest are reference values.</li>
</ul>
<h2>How much to trust each number</h2>
<ul>
<li><b>Data quality badge</b> on every object: <i>Confirmed</i> (visited or sampled by a spacecraft – Ryugu, Bennu, Itokawa, Eros, Vesta, Psyche), <i>Measured</i> (composition from a telescope spectrum), <i>Estimated</i> (guessed from how much light it reflects), <i>Guess</i> (no data – typical for that kind of orbit). Most of the catalogue is a Guess; treat those rankings as hypotheses.</li>
<li><b>Δv</b> has three levels, best first: an <b>exact trajectory</b> (Lambert-optimised round trip, best launch in the next 10 years, Earth return by atmospheric entry ≤ 12 km/s like NASA) computed every hour for every serious mining candidate; NASA’s <b>NHATS</b> optimised round trips for objects still queued; and a Hohmann <b>estimate</b> (marked ~) for everything else. The map, the list, the detail card and the Report page all use the same results, so the numbers always match.</li>
<li><b>Launch date matters.</b> Metal prices are market prices and don’t depend on where planets are, but mission cost does: Earth and the asteroid have to line up. <i>Best window</i> (default) uses the cheapest launch in the next 10 years. <i>On map date</i> prices a launch on exactly the day on the map clock for the object you opened — press play to watch costs swing as the geometry changes. Ranks and tiers always use the best window, so they never change when you click or move the clock.</li>
<li><b>Radar-scanned</b> badge: the asteroid was measured by Goldstone/Arecibo radar (count of delay + Doppler measurements from NASA/JPL), so its size and shape are well known.</li>
<li>Sizes from brightness can be off by ×2 (mass by ×8). “(measured)” marks diameters from infrared or radar.</li>
</ul>
<h2>Composition</h2>
<p>Nobody has assayed these asteroids. Composition comes from the spectral class (or, failing that, the albedo or orbit) mapped to meteorite analogues: metallic asteroids ≈ iron meteorites (~90% iron-nickel, 10–50 ppm platinum-group metals), stony ≈ ordinary chondrites, carbonaceous ≈ CI/CM chondrites (up to ~10–20% water). Each material gets a <i>chance</i> that reflects how sure we are of the class.</p>
<h2>Mission model</h2>
<ul>
<li>Δv from patched conics: Hohmann-type transfer from 1 AU to the asteroid’s nearest apsis with plane change, or relative velocity at 1 AU for Earth-crossers. Departure from a 400 km LEO (3.2 km/s to escape) or from a 100 km low lunar orbit (0.7 km/s to escape). Return by atmospheric entry at up to 12 km/s (NASA’s limit); faster arrivals pay for a braking burn.</li>
<li><b>Moon vs Earth launch</b> — reaching orbit takes ~9.4 km/s from Earth’s surface but only ~1.9 km/s from the Moon’s (1/6 gravity, no air). With the rocket equation that is ~7–8× less propellant per kg; with lunar-made propellant and reusable landers the long-run cost is assumed at ~10% of Earth→LEO (editable). Today, shipping cargo <i>to</i> the Moon still costs ~$1M/kg, so this models a future lunar industry.</li>
<li>Propellant from the rocket equation with your Isp. Return fuel can be made from asteroid water (C/D/X types).</li>
<li>Cargo is filled with the most valuable material first. Selling hundreds of tonnes of rhodium crashes its price — the market-impact switch models that.</li>
<li>Profit = expected revenue × (1 − failure risk) − launch − spacecraft − operations − processing.</li>
<li>Rarity is your rank by expected profit: top 0.02% Mythic (and only if actually profitable), 0.5% Legendary, 2.5% Epic, 9% Rare, 28% Uncommon. Change your costs and the whole map re-ranks.</li>
</ul>
<p class="muted">First-order estimates for exploring the trade-offs, not investment advice.</p>`;

setInterval(() => { if (!st.playing && ranked.some(o => o.tier.key === 'mythic' && st.tiers.has('mythic'))) draw(); }, 50);
window.addEventListener('resize', resize);
window.addEventListener('keydown', e => { if (e.key === 'Escape') select(null); });
if (innerWidth < 860) { $('#mission').classList.add('collapsed'); $('#collapse-left').textContent = '+'; }
renderSettings(); renderFilters(); updateDate(); resize(); fit();
load();
