# Astromine

Interactive prospecting map of real asteroids between Venus and Jupiter, ranked Common → Legendary by mission profit using live metal prices.

## Data
| What | Source | Refresh |
|---|---|---|
| Orbits, size, albedo, spectral type | NASA/JPL Small-Body Database API | GitHub Action, hourly |
| Earth close approaches (120 d) | NASA/JPL Close-Approach Data API | GitHub Action, hourly |
| Au, Ag, Pt, Pd, Cu | gold-api.com | Live in browser, every 60 s |
| Rh, Ir, Ru | Umicore daily prices | GitHub Action, hourly check |
| Os, Ni, Co, Fe, water | Reference values in `data/prices.json` | Manual / in-app override |

Positions are recomputed every second in the browser from Keplerian elements.

## Setup (once)
1. **Settings → Actions → General → Workflow permissions** → *Read and write*.
2. **Actions → Update space data → Run workflow** (fills `data/asteroids.json`).
3. **Settings → Pages** → Source: *Deploy from a branch*, `main` / root.

## Local
```
node scripts/fetch-data.mjs   # Node 20+
python3 -m http.server
```

## Model
Composition from spectral class → meteorite analogues; Δv via patched conics from LEO or lunar surface; rocket equation; optional ISRU return fuel; market-impact pricing; failure risk. Estimates, not investment advice.
