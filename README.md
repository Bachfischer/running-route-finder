# Running route finder

A park-focused running-loop planner for Cloudflare Workers. Choose a start, 2–25 km, and a direction; compare loops, see green-space and traffic-light estimates, and download the displayed route as GPX. React/Vinext, Leaflet and OpenStreetMap; no LLM, database or routing API key.

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
pnpm check
pnpm test:memory
pnpm build
pnpm test:worker
node scripts/cloudflare-config.mjs
pnpm exec playwright install --with-deps chromium
pnpm test:ui
pnpm exec wrangler deploy --dry-run --config wrangler.deploy.json
```

`pnpm check` runs formatting, ESLint, TypeScript, and Node unit/API/regression tests with coverage gates (90% lines/functions; 80% branches). `test:worker` executes the compiled production bundle in Cloudflare's workerd runtime with recorded Overpass data. Playwright runs the UI scenarios at desktop and mobile sizes against the compiled local Worker. Public tile and routing requests are intercepted in those UI tests; coordinate lookup exercises the actual API. Tests do not need provider availability or Cloudflare credentials.

The real Munich OSM fixture includes park polygons and signal tags. Assertions require a closed loop within 500 m of 10 km, over 70% mapped green spaces, over 90% paths/tracks, under 5% repeat, and no mapped signal encounters. Access restrictions, barriers, pedestrian one-way rules, disconnected graphs, dense-area retries, response streaming limits, rate limits and provider failures have independent tests. See [testing details](docs/TESTING.md).

Optional live check, deliberately excluded from normal CI to avoid repeatedly hitting public providers:

```sh
pnpm test:live
```

## Cloudflare deployment

Use a separate Worker repository and GitHub Actions, keeping the existing Jekyll/GitHub Pages site. Read [the deployment and CI guide](docs/CLOUDFLARE.md) for the exact secrets, variables, custom domain, branch protection and rollback steps.

For the first deployment from your machine:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:worker
pnpm exec wrangler login
pnpm deploy:cloudflare
```

Workers Paid is recommended: routing exceeds the Free plan's CPU allowance. The generated config uses a 30-second CPU ceiling and serves UI assets and API from one Worker. No database or storage bindings are required. A deployment in your own account is independent of the private Sites copy and is public unless you separately configure Access.

## How recommendations work

1. Fetch a bounded area shifted toward the requested direction. A 10 km request starts with a 2.65 km query radius, replacing the former 4.7 km radius. Oversized data triggers a smaller area **without changing the requested run distance**. At most six queries and a 110-second search deadline.
2. Build an accessible pedestrian graph from actual OSM node sequences. Preserve foot restrictions, barriers and signal tags. Closed green-space outlines and multipolygons, including holes, classify parks, gardens, nature reserves, forests and recreation grounds.
3. Snap the start to a connected path within 300 m. Report the offset; never invent a straight connector across a building or river.
4. Try up to 96 waypoint-pair arrangements: eight bearings, six scales and two widths. Narrow shapes allow loops through long parks. Three A* legs connect start → waypoint → waypoint → start.
5. Always enable park preference in path costs: edges inside mapped green spaces retain their base cost; other edges cost 1.8 times as much. Add 180 equivalent cost-metres when entering a mapped traffic-signal node. Multiply reused-edge distance cost by four. These are search costs, not added route distance or predicted waiting time.
6. Rank candidates by `6 × relative distance error + 3 × repeated fraction + 0.9 × direction mismatch + 0.12 × non-path fraction + 2 × non-green fraction + 0.12 × signal encounters`. Direction mismatch is `(1 − cos(angle difference)) / 2`. Reject over 30% repeat or length outside 45–165% of target; return up to three distinct candidates. Stop the area search when the top candidate is within 12% of target and 15% repeat.

Park preference is always active, but accessible connections and the requested distance may require streets. Signals are penalized, not forbidden: banning every signal can disconnect a city. Counted signal encounters are mapped node visits, not inferred intersections; a junction with several signal nodes may count more than once. Green-space coverage estimates segments by their midpoint, so it is not a surveyed measurement. No tagged park is treated as traversable unless an accessible mapped path exists inside it.

“Best” means the lowest heuristic score among searched candidates, not global optimality. Direction describes the side explored, not the initial steps. Distances are geodesic, not elevation-adjusted. No elevation, lighting, current closures, traffic or surface-condition assessment is performed. Unmapped signals and incomplete park boundaries cannot be accounted for. GPX contains the exact displayed coordinates.

## Data and privacy

- Photon address search: `PHOTON_URL`, default `https://photon.komoot.io/api/`. Explicit searches only; no autocomplete traffic. Coordinates typed directly do not contact Photon.
- Overpass paths, green boundaries and signals: `OVERPASS_URL`, default `https://overpass-api.de/api/interpreter`. Streamed 18 MB response cap; 130,000-element graph cap; per-query timeout up to 40 seconds.
- OSM map tiles through locally bundled Leaflet; visible attribution. Tile requests reveal the viewed map area to the tile provider.

Coordinates go to Overpass; typed address searches go to Photon. There is no application location-history database. Provider URLs can be configured using environment variables when generating the Cloudflare config; both must be HTTPS and preserve the expected API format. Do not put credentials into URLs. Isolate-local cooldowns and one routing job per isolate limit pressure, but are not distributed abuse protection. Configure edge rate limiting and a managed/self-hosted provider before broad public use. Public endpoints can throttle and have no uptime guarantee.

See [Photon usage](https://github.com/komoot/photon#demo-server), [Overpass resource guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Website integration

Use `bachfischer.me/projects/running-routes/` as a Jekyll project article linking to the proposed `run.bachfischer.me` Worker. The app follows the existing AcademicPages typography and gray/cyan palette. `/projects/` is a visual example; `?embed=1` hides surrounding chrome for an optional iframe. See [the integration proposal](integration/README.md) and [reviewable Jekyll patch](integration/website-projects.patch). The original website repository and proposed custom domain have not been changed.

Inspired by [Simon Willison's running-route experiment](https://simonwillison.net/2026/Sep/12/astra-running-routes/). Map data © OpenStreetMap contributors, ODbL; fixture attribution is in `tests/fixtures/README.md`.
