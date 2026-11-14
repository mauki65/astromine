# Astromine — which asteroids are worth mining?

**Live:** https://astromine.live/ · **Monthly-style report (auto-updated):** https://astromine.live/report/

![Astromine map](assets/screenshot.png)

An interactive map of 50,000+ real asteroids and comets from Venus to Saturn, ranked **Common → Uncommon → Rare → Epic → Legendary → Mythic** by expected profit per mining mission. Plug in your own launch costs, spacecraft and risk, launch from Earth or the Moon, and watch the whole solar system re-rank.

## What's real
| | Source | Refresh |
|---|---|---|
| Orbits, sizes, spectral types, radar measurements | NASA/JPL Small-Body Database | several times a day |
| Optimised round-trip Δv for ~6,000 near-Earth asteroids | NASA/JPL NHATS | several times a day |
| Earth close approaches | NASA/JPL Close-Approach Data | several times a day |
| Au, Pt, Pd, Cu prices | gold-api.com | every minute in the browser |
| Rh, Ir, Ru prices | Umicore | several checks a day (published daily) |
| Exact launch windows | Lambert solver, run by the job for every mining candidate | several times a day |
| Composition classes and sizes (gap-filling) | SsODNet ssoBFT (Berthier et al. 2023, A&A 671, A151) | weekly |
| Photos and object summaries | Wikipedia / Wikimedia Commons (per-image credits) | on demand |

Positions are recomputed every second from Keplerian elements.

## What's estimated
Composition comes from asteroid type → meteorite analogues (only a handful — Ryugu, Bennu, Itokawa, Eros, Vesta, Ceres — have been sampled or orbited). Every object carries a data-quality badge: **Confirmed**, **Measured**, **Estimated** or **Guess**. Sizes from brightness can be off by ×2. Each trip sells either metals on Earth (heat-shielded capsule) or water at a fuel depot near the Moon (Earth–Moon L1). Water has no market yet, so it is valued at what launching the same water there from Earth would cost — it follows the launch-cost setting. The ~$1B spacecraft is reused for 10 trips by default. This is an exploration tool, not investment advice.

## How it runs
Static site on GitHub Pages. A GitHub Action (`.github/workflows/update-data.yml`) runs `scripts/fetch-data.mjs`, `scripts/taxonomy.py`, `scripts/lambert-batch.mjs`, `scripts/report.mjs` and `scripts/validate.mjs` on an hourly schedule (GitHub runs scheduled jobs when it has capacity — in practice several times a day) and deploys the site with fresh data straight to GitHub Pages — data is not committed, so the repo stays small. No servers, no API keys.

```
node scripts/fetch-data.mjs && node scripts/lambert-batch.mjs && node scripts/report.mjs   # Node 20+
python3 -m http.server
```

## Licence
MIT
