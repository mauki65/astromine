// "About this object": real photo (only for bodies imaged up close by spacecraft or well
// photographed by telescopes — hand-verified list), the Wikipedia summary where an article
// exists, and an origin story derived from the object's own orbit and composition data.
import { CLASSES, EVIDENCE } from './model.js';

// Verified real images on Wikimedia Commons (lead images of each Wikipedia article, checked 2026-11-08).
const PHOTOS = {
  '1': ['Ceres_-_RC3_-_Haulani_Crater_(22381131691)_(cropped).jpg', 'Dawn'],
  '4': ['Vesta_in_natural_color.jpg', 'Dawn'],
  '21': ['Rosetta_triumphs_at_asteroid_Lutetia.jpg', 'Rosetta'],
  '243': ['243_ida_crop.jpg', 'Galileo'],
  '253': ['253_Mathilde_NASA_crop.png', 'NEAR Shoemaker'],
  '433': ['Eros_-_PIA02923_(color).jpg', 'NEAR Shoemaker'],
  '951': ['951_Gaspra.jpg', 'Galileo'],
  '2867': ['2867_Steins.jpg', 'Rosetta'],
  '4179': ['4179_Toutatis_HQ.png', "Chang'e 2"],
  '5535': ['Annefrank_5535.jpg', 'Stardust'],
  '9969': ['9969_Braille_HQ.png', 'Deep Space 1'],
  '25143': ['Asteroid_(25143)_Itokawa_seen_in_close-up_(eso1405c).jpg', 'Hayabusa'],
  '52246': ['Donaldjohanson_Combined.png', 'Lucy'],
  '65803': ['Dimorphos_and_Didymos_as_seen_by_DARTMission.png', 'DART'],
  '101955': ['Bennu_mosaic_OSIRIS-REx_(square).png', 'OSIRIS-REx'],
  '152830': ["Dinkinesh_First_Look_L'LORRI.png", 'Lucy'],
  '162173': ['162173_Ryugu_brightened.png', 'Hayabusa2'],
  '1P': ['Lspn_comet_halley.jpg', 'ground-based telescope, 1986'],
  '2P': ['Comet_Encke.jpg', 'telescope'],
  '9P': ['PIA02142_Tempel_1_bottom_sharped.jpg', 'Deep Impact'],
  '19P': ['Comet_Borrelly_Nucleus.jpg', 'Deep Space 1'],
  '67P': ['Comet_67P_True_color.jpg', 'Rosetta'],
  '81P': ['Wild2_3.jpg', 'Stardust'],
  '103P': ['Introducing_Comet_Hartley_2.png', 'EPOXI'],
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const strip = h => String(h ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const idOf = o => o.comet ? o.name.match(/^(\d+P)/)?.[1] : o.name.match(/^(\d+)\s/)?.[1];

// Wikipedia title candidates from our designation
function titles(o) {
  const n = o.name, num = n.match(/^(\d+)\s/)?.[1], prov = n.match(/\(([^)]+)\)/)?.[1];
  if (o.comet) return [n, n.replace('-', '–'), n.split('/')[0]];
  const nm = num && n.replace(/^\d+\s+/, '').replace(/\s*\(.*\)$/, '');
  const out = [];
  if (num && nm && !/^\d{4}\s/.test(nm) && !nm.startsWith('(')) out.push(`${num} ${nm}`);
  if (num && prov) out.push(`(${num}) ${prov}`);
  if (!num && prov) out.push(prov);
  return out;
}
const ASTRO = /asteroid|comet|minor planet|dwarf planet|trojan|centaur|near-earth|object|planetoid/i;
async function wiki(o) {
  for (const t of titles(o)) {
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j.type === 'standard' && ASTRO.test(`${j.description} ${j.extract}`)) return j;
    } catch {}
  }
  return null;
}
const creditCache = new Map();
export function photoOf(o) { return PHOTOS[idOf(o)] || null; }
export function credit(file) {
  if (!creditCache.has(file)) creditCache.set(file, creditFetch(file));
  return creditCache.get(file);
}
async function creditFetch(file) {
  try {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&titles=File:${encodeURIComponent(file)}`;
    const p = Object.values((await fetch(u).then(r => r.json())).query.pages)[0].imageinfo[0];
    const m = p.extmetadata || {};
    return { src: p.thumburl || p.url, page: p.descriptionurl, artist: strip(m.Artist?.value).slice(0, 120), lic: strip(m.LicenseShortName?.value) };
  } catch { return null; }
}

// ---------- origin story from the object's own data ----------
const GROUPS = {
  IEO: ['an Atira', 'its whole orbit lies inside Earth’s, so it is one of the hardest asteroids to spot — it is always near the Sun in our sky'],
  ATE: ['an Aten', 'it spends most of its time inside Earth’s orbit and crosses it near its farthest point from the Sun'],
  APO: ['an Apollo', 'its orbit crosses Earth’s — the most common kind of near-Earth asteroid'],
  AMO: ['an Amor', 'it approaches Earth’s orbit from outside but does not cross it'],
  MCA: ['a Mars-crosser', 'it crosses Mars’s orbit, one step on the way from the asteroid belt toward Earth'],
};
function tisserand(a, e, i) { return 5.204 / a + 2 * Math.cos(i * Math.PI / 180) * Math.sqrt(a / 5.204 * (1 - e * e)); }
function discoveryYear(n) {
  const m = n.match(/\((\d{4}) [A-Z]/) || n.match(/^\(?(\d{4}) [A-Z]{1,2}\d*\)?$/); if (m) return +m[1];
  const o = n.match(/\(A(\d)(\d{2}) [A-Z]/); if (o) return 1000 + +o[1] * 100 + +o[2];
  return null;
}
function sizeLike(km) {
  if (km < 0.03) return 'about the size of a house';
  if (km < 0.12) return 'about the length of a football pitch';
  if (km < 0.45) return 'roughly as tall as the Eiffel Tower is high';
  if (km < 2) return 'about as wide as a small town';
  if (km < 30) return 'about the size of a city';
  if (km < 200) return 'as wide as a small country';
  return 'a small world in its own right';
}
const COMPOSITION = {
  C: 'It is carbon-rich and dark — primitive material that has barely changed since the Solar System formed 4.6 billion years ago, including clay minerals that once held liquid water. Samples from Ryugu and Bennu contained amino acids and other organic molecules.',
  D: 'Its dark, reddish surface suggests organic-rich ices and dust, typical of bodies that formed far out in the cold outer Solar System.',
  S: 'It is made of silicate rock and metal, like the ordinary chondrite meteorites that most often fall on Earth. Its material was heated, but never fully melted, early in Solar System history.',
  Q: 'It looks like freshly exposed rock — the same material as ordinary chondrite meteorites, with a surface not yet darkened by space weathering, often a sign of a recent close pass by a planet that shook it up.',
  M: 'Its spectrum suggests metal. Metal-rich asteroids may be pieces of the iron cores of early protoplanets that were shattered by collisions — a way to study planetary cores we can never reach on Earth.',
  X: 'Its spectrum is featureless, so it could be metal-rich, enstatite rock, or primitive dark material; radar or a spacecraft visit would be needed to tell.',
  E: 'It has a very bright surface of enstatite, a mineral that forms only where there is almost no oxygen — like the rare aubrite meteorites.',
  V: 'Its surface is basalt — solidified lava — a sign it came from a body large enough to melt and form a crust.',
  K: 'A comet nucleus is a loose mix of ice, dust and organic compounds, often less dense than water. Near the Sun its ices turn to gas and form the coma and tail.',
};
function originStory(o) {
  const p = [], cls = o.class || '', a = o.a, e = o.e, i = o.i, T = tisserand(a, e, i);
  const P = Math.pow(a, 1.5);
  if (o.comet) {
    const fam = { JFc: ['a Jupiter-family comet', 'It most likely came from the Kuiper belt or the scattered disc beyond Neptune; close passes by Jupiter pulled it into its current short orbit.'],
      HTC: ['a Halley-type comet', 'Its long, often steeply tilted orbit suggests it came from the distant Oort cloud or the outer scattered disc and was trapped by the giant planets.'],
      ETc: ['an Encke-type comet', 'It orbits entirely inside Jupiter’s orbit — unusual for a comet — and is thought to be an old Jupiter-family comet whose orbit slowly decoupled from Jupiter.'],
      CTc: ['a Chiron-type comet', 'It orbits among the giant planets, like the Centaurs, and probably escaped the Kuiper belt not long ago in cosmic terms.'] }[cls] || ['a short-period comet', 'It probably originated in the Kuiper belt or Oort cloud far beyond Neptune.'];
    p.push(`This is ${fam[0]}, circling the Sun every ${P.toFixed(1)} years. ${fam[1]}`);
    p.push('Each pass near the Sun boils away some of its ice, so on cosmic timescales it will fade, break up, or end as a dark, inactive rock.');
  } else if (GROUPS[cls]) {
    const [g, why] = GROUPS[cls];
    p.push(`This is ${g} asteroid — ${why}. It goes around the Sun once every ${P.toFixed(1)} years.`);
    let src = 'Like nearly all near-Earth asteroids, it almost certainly formed in the main asteroid belt between Mars and Jupiter. Over millions of years sunlight gently pushed on its surface (the Yarkovsky effect) until it drifted into an orbital resonance with Jupiter or Saturn, which stretched its orbit toward Earth.';
    if (T < 3 && a > 2.6) src = 'Its orbit is comet-like (strongly influenced by Jupiter), so it may be an extinct comet — a nucleus that has lost its ice — rather than a rock from the asteroid belt.';
    else if (a < 2.0) src += ' Its compact orbit points to the inner edge of the belt, where the ν6 resonance with Saturn feeds many near-Earth asteroids.';
    else if (a > 2.35 && a < 2.7) src += ' Its orbit size matches the 3:1 resonance with Jupiter near 2.5 AU, one of the main “escape hatches” from the belt.';
    p.push(src);
    p.push('Near-Earth orbits do not last: typically after a few million years such bodies hit the Sun or a planet, or are flung out of the inner Solar System.');
  } else if (cls === 'TJN') {
    p.push(`This is a Jupiter Trojan — it shares Jupiter’s orbit, travelling about 60° ahead of or behind the giant planet in a stable gravitational “parking spot”, once every ${P.toFixed(1)} years.`);
    p.push('Trojans are thought to have been captured about 4 billion years ago when the giant planets migrated, so they may be leftovers from the far outer Solar System. NASA’s Lucy spacecraft will fly past several Trojans from 2027.');
  } else if (cls === 'CEN') {
    p.push(`This is a Centaur, orbiting among the giant planets (once every ${P.toFixed(0)} years). Centaurs are refugees from the Kuiper belt beyond Neptune.`);
    p.push('Their orbits last only a few million years before a giant planet throws them out — or pushes them inward, where some become comets.');
  } else {
    const zone = a < 2.0 && i > 15 ? 'Hungaria group, a tight cluster at the inner edge of the belt' : a < 2.5 ? 'inner asteroid belt' : a < 2.82 ? 'middle asteroid belt' : a < 3.3 ? 'outer asteroid belt' : a > 3.7 && a < 4.2 ? 'Hilda group, locked in a 3:2 rhythm with Jupiter (three orbits for every two of Jupiter’s)' : 'outer reaches of the asteroid belt';
    p.push(`This asteroid lives in the ${zone}, going around the Sun every ${P.toFixed(1)} years.`);
    p.push('The belt is material that never became a planet — Jupiter’s gravity kept stirring it up. Many asteroids here are fragments of larger bodies broken apart in collisions billions of years ago.');
  }
  const C = COMPOSITION[o.cls];
  if (C) p.push(C);
  if (/^4 Vesta/.test(o.name)) p.push('Vesta is the second-largest body in the asteroid belt and a surviving protoplanet: it melted, formed an iron core and a basalt crust, and fragments of it reach Earth as HED meteorites.');
  if (o.cls === 'V' && o.D < 60 && a > 2.2 && a < 2.5 && i > 4 && i < 9) p.push('Its orbit and basaltic surface suggest it is a chip of the giant asteroid Vesta, blasted off by the impact that dug Vesta’s huge Rheasilvia crater about a billion years ago.');
  return p;
}

function facts(o) {
  const f = [];
  f.push(['Size', `${o.dEst ? '~' : ''}${o.D >= 1 ? o.D.toPrecision(3) + ' km' : Math.round(o.D * 1000) + ' m'} — ${sizeLike(o.D)}`]);
  f.push(['Year length', `${Math.pow(o.a, 1.5).toFixed(2)} Earth years`]);
  f.push(['Distance from the Sun', `${(o.a * (1 - o.e)).toFixed(2)}–${(o.a * (1 + o.e)).toFixed(2)} AU (Earth = 1)`]);
  if (o.moid != null) f.push(['Closest its orbit gets to Earth’s', `${(o.moid * 389.17).toFixed(o.moid < 0.05 ? 1 : 0)} × the Moon’s distance`]);
  const y = discoveryYear(o.name); if (y) f.push(['First spotted', String(y)]);
  f.push(['Composition evidence', `${EVIDENCE[o.evidence].label} — ${o.basis}`]);
  return f;
}

export async function openAbout(o) {
  let el = document.getElementById('about-modal');
  if (!el) { el = document.createElement('div'); el.id = 'about-modal'; document.body.append(el); }
  const id = idOf(o), ph = PHOTOS[id];
  const render = (w, c) => {
    el.innerHTML = `<div class="am-back" data-close></div><article class="am" role="dialog" aria-label="About ${esc(o.name)}">
      <button class="icon am-x" data-close title="Close">✕</button>
      ${ph ? `<figure class="am-photo">${c ? `<img src="${esc(c.src)}" alt="${esc(o.name)} photographed by ${esc(ph[1])}">` : `<div class="am-ph-load">${w === undefined ? 'Loading photo…' : `Photo could not be loaded — <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(ph[0])}" target="_blank" rel="noopener">view it on Wikimedia Commons</a>`}</div>`}
        <figcaption>Real image · ${esc(ph[1])}${c ? ` · ${esc(c.artist || 'see source')} · ${esc(c.lic)} · <a href="${esc(c.page)}" target="_blank" rel="noopener">source</a>` : ''}</figcaption></figure>`
        : `<div class="am-nophoto">No spacecraft has photographed ${esc(o.name.replace(/\s*\(.*\)$/, ''))} up close yet${o.radar ? ' — it has been imaged by radar, but those images are not shown here' : ''}. Like most small bodies, it is only a point of light in telescopes.</div>`}
      <h2>${esc(o.name)}</h2>
      <p class="muted">${esc(CLASSES[o.cls]?.label || '')}${o.comet ? '' : ` · ${esc(o.class || '')}`}</p>
      <h3>Where it came from</h3>
      ${originStory(o).map(t => `<p>${esc(t)}</p>`).join('')}
      <div class="kv">${facts(o).map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>
      ${w === undefined ? '<h3>From Wikipedia</h3><p class="muted">Loading…</p>'
        : w ? `<h3>From Wikipedia</h3><p>${esc(w.extract)}</p><p class="muted">Text: Wikipedia (CC BY-SA) · <a href="${esc(w.content_urls?.desktop?.page)}" target="_blank" rel="noopener">Read the full article ↗</a></p>` : ''}
      <p class="note">“Where it came from” is written automatically from this object’s orbit and composition data using established models of how asteroids and comets reach their current orbits; it describes the most likely history, not a certainty.</p>
    </article>`;
    el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { el.innerHTML = ''; });
  };
  render(undefined, null);
  const [w, c] = await Promise.all([wiki(o), ph ? credit(ph[0]) : null]);
  if (document.getElementById('about-modal').innerHTML) render(w, c);
}
