// "How it works" text — shown in the map's tab and on the static /about/ page (one source).
export const GUIDE_HTML = `
<h1>How it works</h1>
<p>You run a space-mining company. Every dot is a real asteroid tracked by NASA/JPL, placed where it actually is today. Your job: pick the ones that make money and skip the ones that don’t.</p>
<h2>Data</h2>
<ul>
<li><b>Orbits</b> — NASA/JPL Small-Body Database: all near-Earth asteroids down to ~25 m, every body larger than 12 km out to ~11 AU (Saturn), the brighter Jupiter Trojans and the Centaurs, and every asteroid with a measured spectral type. Catalogue refreshed automatically several times a day. Positions are recomputed every second in your browser, so the map shows where everything is right now.</li>
<li><b>Comets</b> (optional layer) — short-period comets (Jupiter-family, Encke-, Chiron- and Halley-type) from the same database; composition from Rosetta’s measurements of comet 67P (~30% water ice). Diameters are often unknown, so many are assumed at 2 km. Ranked against the asteroid tiers, so turning them on never re-ranks asteroids.</li>
<li><b>Close approaches</b> — JPL Close-Approach API, next 120 days. Flagged as launch windows.</li>
<li><b>Composition classes and sizes</b> — where NASA has none, from SsODNet’s Best-Fit Table (Berthier et al. 2023, A&amp;A 671, A151: spectra and Gaia/SDSS survey colours), refreshed weekly.</li>
<li><b>Photos and object summaries</b> — Wikipedia and Wikimedia Commons (credited on each photo); only real spacecraft or telescope images.</li>
<li><b>Prices</b> — Au/Pt/Pd/Cu refresh every minute in your browser (gold-api.com); Rh/Ir/Ru are checked several times a day (Umicore publishes once per business day); Os/Ni/Co/Fe are reference values; water follows the launch cost (see below).</li>
</ul>
<h2>How much to trust each number</h2>
<ul>
<li><b>Data quality badge</b> on every object: <i>Confirmed</i> (sampled or orbited by a spacecraft – Ryugu, Bennu, Itokawa, Eros, Vesta, Ceres), <i>Measured</i> (composition from a telescope spectrum, survey colours or radar – this includes Psyche until NASA’s spacecraft arrives in 2029), <i>Estimated</i> (guessed from how much light it reflects), <i>Guess</i> (no data – typical for that kind of orbit). Most of the catalogue is a Guess; treat those rankings as hypotheses.</li>
<li><b>Δv</b> has three levels, best first: an <b>exact trajectory</b> (Lambert-optimised round trip, best launch in the next 10 years, Earth return by atmospheric entry ≤ 12 km/s like NASA) computed for every serious mining candidate and refreshed with each data update; NASA’s <b>NHATS</b> optimised round trips for objects still queued; and a Hohmann <b>estimate</b> (marked ~) for everything else. The map, the list, the detail card and the Report page all use the same results, so the numbers always match.</li>
<li><b>Launch date matters.</b> Metal prices are market prices and don’t depend on where planets are, but mission cost does: Earth and the asteroid have to line up. <i>Best window</i> (default) uses the cheapest launch in the next 10 years. <i>On map date</i> prices a launch on exactly the day on the map clock for the object you opened — press play to watch costs swing as the geometry changes. Ranks and tiers always use the best window, so they never change when you click or move the clock.</li>
<li><b>Radar-scanned</b> badge: the asteroid was measured by Goldstone/Arecibo radar (count of delay + Doppler measurements from NASA/JPL), so its size and shape are well known.</li>
<li>Sizes from brightness can be off by ×2 (mass by ×8). “(measured)” marks diameters from infrared or radar.</li>
</ul>
<h2>Composition</h2>
<p>Nobody has assayed these asteroids. Composition comes from the spectral class (or, failing that, the albedo or orbit) mapped to meteorite analogues: metallic asteroids ≈ iron meteorites (~90% iron-nickel, 10–50 ppm platinum-group metals), stony ≈ ordinary chondrites, carbonaceous ≈ CI/CM chondrites (up to ~10–20% water). Each material gets a <i>chance</i> that reflects how sure we are of the class.</p>
<h2>Mission model</h2>
<ul>
<li>Δv from patched conics: Hohmann-type transfer from 1 AU to the asteroid’s nearest apsis with plane change, or relative velocity at 1 AU for Earth-crossers. Departure from a 400 km LEO (3.2 km/s to escape) or from a 100 km low lunar orbit (0.7 km/s to escape). Metal cargo returns by atmospheric entry at up to 12 km/s (NASA’s limit); faster arrivals pay for a braking burn.</li>
<li><b>Where the cargo is sold</b> — each mission takes the better of two options. <i>Metals → Earth</i>: a capsule with a heat shield (~15% of the cargo mass) enters the atmosphere and the metals sell at market prices. <i>Water → fuel depot near the Moon</i> (Earth–Moon L1): there is no atmosphere to brake in, so the tanker fires its engine close to Earth, where a burn is most effective, and then settles at the depot — about 0.8 km/s for the gentlest arrivals, ~1.5 km/s for a 4 km/s arrival. Water there has no market yet, so it is valued at what it would cost to launch the same water from Earth (launch price × the rocket-equation cost of the extra 3.8 km/s, ≈ 2.75× at the defaults) — or from the Moon if you launch from there. Cheaper rockets therefore make asteroid water cheaper too.</li>
<li><b>Reusable spacecraft</b> — a mining spacecraft costs about $1B (asteroid missions such as OSIRIS-REx and Psyche cost around that). It is assumed to fly 10 trips, so each trip pays one tenth of its price and of its launch. One trip alone can never pay for it.</li>
<li><b>Moon vs Earth launch</b> — reaching orbit takes ~9.4 km/s from Earth’s surface but only ~1.9 km/s from the Moon’s (1/6 gravity, no air). With the rocket equation that is roughly 15× less propellant per kg; with lunar-made propellant and reusable landers the long-run cost is assumed at ~10% of Earth→LEO (editable). Today, shipping cargo <i>to</i> the Moon still costs ~$1M/kg, so this models a future lunar industry.</li>
<li>Propellant from the rocket equation with your Isp. Return fuel can be made from asteroid water (C- and D-types, comets). What is left over is the water sold at the depot. Up to 50,000 t of rock is processed per stay.</li>
<li>Cargo is filled with the most valuable material first, and only with material worth more than it costs to carry home — iron and nickel stay behind. Selling hundreds of tonnes of rhodium crashes its price — the market-impact switch models that.</li>
<li>Profit = expected revenue × (1 − failure risk) − launch − spacecraft − operations − processing.</li>
<li>Rarity is your rank by expected profit: top 0.02% Mythic (and only if actually profitable), 0.5% Legendary, 2.5% Epic, 9% Rare, 28% Uncommon. Change your costs and the whole map re-ranks.</li>
</ul>
<p class="muted">First-order estimates for exploring the trade-offs, not investment advice.</p>`;
