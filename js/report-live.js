// Live report: re-renders the static report with the same data, pipeline and live prices
// the map uses, so both pages always show identical numbers. Refreshes every minute.
import { DEFAULTS } from './model.js';
import { buildObjects, rankAll, pricesFrom, refreshSpot } from './pipeline.js';
import { renderReport, pickPast } from './report-core.js';

const J = f => fetch(`../data/${f}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
let objs = null, metals = null, ca = null, hist = null, lam = null;

async function loadData() {
  const [ast, com, nh, l, pr, c, h] = await Promise.all(['asteroids.json', 'comets.json', 'nhats.json', 'lambert.json', 'prices.json', 'close-approaches.json', 'history.json'].map(J));
  if (!ast || !pr) return false;
  lam = l; ca = c || { list: [] }; hist = h || { days: {} };
  // keep live spot values across data reloads
  const live = metals ? Object.fromEntries(Object.entries(metals).filter(([, m]) => m.live)) : {};
  metals = { ...pr.metals, ...live };
  objs = buildObjects({ ast, com, nh, lam, cad: ca });
  return true;
}

function render() {
  const ranked = rankAll(objs, { ...DEFAULTS }, pricesFrom(metals));
  const today = new Date().toISOString().slice(0, 10);
  const { past, refDate } = pickPast(hist, today);
  const updated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const { main } = renderReport({ ranked, prices: pricesFrom(metals), cadList: ca.list, past, refDate, live: true, updated, coverage: lam?.coverage });
  document.getElementById('report').innerHTML = main;
}

if (await loadData()) {
  await refreshSpot(metals);
  render();
  setInterval(async () => { if (await refreshSpot(metals)) render(); }, 60000);
  setInterval(async () => { if (await loadData()) { await refreshSpot(metals); render(); } }, 300000);
}
