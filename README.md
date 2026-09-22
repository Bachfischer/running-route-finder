# Running route finder

A park-focused running-loop planner on Next.js and Vercel. Choose a start, 2–25 km, and a direction; compare loops, see green-space and traffic-light estimates, and download the displayed route as GPX. React/Next.js, Leaflet and OpenStreetMap; no LLM, database or routing API key.

## Local development

Use Node 24 and the pinned pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm dev
```

Open the URL printed by the development server. The Munich example selects Odeonsplatz, 10 km and north. Click **Find my loop** to request a real route. Example data is used only in tests, never as a production fallback.

## Quality checks

```sh
pnpm run audit
pnpm check
pnpm test:memory
pnpm build
pnpm test:server
pnpm exec playwright install --with-deps chromium
pnpm test:ui
```

`pnpm check` runs formatting, ESLint, TypeScript, and Node unit/API/regression tests with coverage gates (90% lines/functions; 80% branches). `test:server` exercises a real compiled Next.js server with recorded Overpass data, including repeated-search caching. Playwright runs the UI scenarios at desktop and mobile sizes against the compiled Node.js server. Public tile and routing requests are intercepted in those UI tests; coordinate lookup exercises the actual API. Tests do not need provider availability or Vercel credentials.

The real Munich OSM fixture includes park polygons and signal tags. Assertions require a closed loop within 500 m of 10 km, over 88% mapped green spaces, over 98% paths/tracks, under 5% repeat, and no mapped signal encounters. Access restrictions, barriers, pedestrian one-way rules, disconnected graphs, dense-area retries, response streaming limits, rate limits and provider failures have independent tests. See [testing details](docs/TESTING.md).

Optional live check, deliberately excluded from normal CI to avoid repeatedly hitting public providers:

```sh
pnpm test:live
```

## Vercel deployment

Import this repository into Vercel as a Next.js project using Node 24. Pull requests receive preview deployments; `main` is production. `vercel.json` selects Frankfurt and runs core checks before building. Require **Quality and routing regressions** before merging, since the full browser suite runs in GitHub Actions. Vercel Git deployment does not wait for unrelated Actions jobs.

See [the deployment and CI guide](docs/VERCEL.md) for the initial import, custom domain, branch protection and rollback. No GitHub deployment token or database is needed. The existing Jekyll/GitHub Pages site stays in its own repository.

## Production operation

The app has six runtime dependencies. Formatting and lint cover all maintained components and scripts; CI also audits development and production dependencies. See [the production runbook](docs/PRODUCTION.md) for dependency decisions, diagnostics, timeout behavior and remaining launch settings.

## Map cache

Validated Overpass areas are gzip-compressed and cached for 15 minutes using Vercel Runtime Cache. Exact queries share downloads across function instances in the same region/environment; different areas and providers have separate keys. The app caps entries below the platform's 2 MB limit, bounds decompression to 18 MB, and treats unavailable, corrupt or expired cache entries as misses. Cache operations have a 250 ms budget each. Oversized areas remain usable without caching.

Local Node.js uses a bounded four-entry memory cache. Route graphs and recommendations are recalculated, so this reduces provider traffic but does not remove CPU work. Only public map data is cached; keys hash the query/provider and values contain map geometry, not user identities or saved runs. Eviction can happen before expiry. This is not an offline-routing guarantee.

## How recommendations work

1. Fetch a bounded area shifted toward the requested direction. A 10 km request starts with a 2.65 km query radius, replacing the former 4.7 km radius. Oversized data triggers a smaller area **without changing the requested run distance**. At most six queries and a 110-second search deadline.
2. Build an accessible pedestrian graph from actual OSM node sequences. Preserve foot restrictions, barriers and signal tags. Closed green-space outlines and multipolygons, including holes, classify parks, gardens, nature reserves, forests and recreation grounds.
3. Project the start onto an accessible path within 300 m. Prefer surface paths over underground paths and stairs, with a fallback where those are the only access. Preserve pedestrian one-way restrictions; never invent a connector across a river or building.
4. Try up to 96 waypoint-pair arrangements. For each A* leg, first try without mapped signals, gates, railway crossings or stairs. If that leg cannot be connected within the cost budget, allow those features with explicit penalties. This makes continuous park paths the first choice while keeping legally accessible fallback connections.
5. Park edges retain their base cost; other edges cost 1.8 times as much. Signals cost 600 equivalent cost-metres, unsignalled mapped crossings 120, gates/barriers 180, and railway crossings 900. Stairs have a base factor of 6. Way-only crossing costs are distributed over their length so extra geometry nodes do not multiply the penalty. A node marking takes precedence over a duplicate way marking. Reused edges cost four times as much. These are preferences, not predicted waiting times.
6. Rank complete loops by `6 × relative distance error + 4 × repeated fraction + 0.4 × direction mismatch + 0.12 × non-path fraction + 3 × non-green fraction + 0.65 × signal sections + 0.2 × crossing sections + 0.35 × barriers + 0.9 × railway sections + 0.015 × stair metres + 0.04 × sharp turns`. Direction mismatch is `(1 − cos(angle difference)) / 2`. Sharp turns are over 110° at branching junctions, with adjoining segments at least 5 m long. This is a candidate-ranking penalty, not turn-aware A*.
7. Reject over 30% repeated distance and loops outside 45–165% of the requested distance. Return up to three alternatives with less than 85% overlap of their unique undirected edge length, measured against the shorter unique path. Reversing the same loop is not an alternative. Search another area if the best route still has interruptions; stop early only within 12% of the target, at most 10% repeat, zero mapped signals/barriers/railway crossings/stairs and at most two crossing sections. Keep an already-found real route if a later provider request fails.

Park preference is always active. Accessible connections and target distance can still require streets or an interruption. Adjacent markings of the same kind are grouped into encountered sections in the displayed counts; node-based search costs remain conservative. Counts are not guaranteed real-world stops. Crossings follow OpenStreetMap's [node](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dcrossing) and [way](https://wiki.openstreetmap.org/wiki/Tag:footway%3Dcrossing) tagging conventions; mapped [gates](https://wiki.openstreetmap.org/wiki/Tag:barrier%3Dgate) receive a penalty even when foot access is permitted.

“Best” means the lowest heuristic score among searched candidates, not global optimality. Direction describes the side explored, not the first steps. Green coverage uses segment midpoints. Unmapped obstacles, crowds, current closures and surface conditions are unknown. A step-free, signal-free route in the map is not a promise of an uninterrupted run. GPX contains the exact displayed coordinates.

On the refreshed 2026-09-15 Odeonsplatz extract, the 10 km recommendation is **10.26 km, 90.4% green space, 99.3% paths/tracks, 2.5% repeat, and zero mapped lights, crossing sections, barriers, railway crossings or stairs**. The next distinct candidate is 9.97 km with 88.2% green space and the same zero-interruption counts. These are regression results, not a physical route survey.

## Data and privacy

- Photon address search: `PHOTON_URL`, default `https://photon.komoot.io/api/`. Explicit searches only; no autocomplete traffic. Coordinates typed directly do not contact Photon.
- Overpass paths, green boundaries and signals: `OVERPASS_URL`, default `https://overpass-api.de/api/interpreter`. Streamed 18 MB response cap; 130,000-element graph cap; per-query timeout up to 40 seconds.
- OSM map tiles through locally bundled Leaflet; visible attribution. Tile requests reveal the viewed map area to the tile provider.

Coordinates go to Overpass; if the default host cannot be reached, one request to the Private.coffee Overpass instance is attempted within the same deadline. Custom providers never use that public fallback. Typed address searches go to Photon. There is no application location-history database. Provider URLs can be configured using environment variables in Vercel project settings; both must be HTTPS and preserve the expected API format. Do not put credentials into URLs. Instance-local cooldowns and one routing job per instance limit pressure, but are not distributed abuse protection. Configure edge rate limiting and a managed/self-hosted provider before broad public use. Public endpoints can throttle and have no uptime guarantee.

See [Photon usage](https://github.com/komoot/photon#demo-server), [Overpass resource guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Website integration

Use `bachfischer.me/projects/running-routes/` as a Jekyll project article linking to the proposed `run.bachfischer.me` Vercel app. The app follows the existing AcademicPages typography and gray/cyan palette. `/projects/` is a visual example; `?embed=1` hides surrounding chrome for an optional iframe. See [the integration proposal](integration/README.md) and [reviewable Jekyll patch](integration/website-projects.patch). The original website repository and proposed custom domain have not been changed.

Inspired by [Simon Willison's running-route experiment](https://simonwillison.net/2026/Sep/12/astra-running-routes/). Map data © OpenStreetMap contributors, ODbL; fixture attribution is in `tests/fixtures/README.md`.
