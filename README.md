# Running route finder

Plan a 2–25 km running loop from an address, map pin or current location. Pick a distance, get a loop through the best parks nearby, compare alternatives and export the selected one as GPX. The planner works on its own at `run.bachfischer.me` and supports `?embed=1` for `bachfischer.me`.

## Run locally

Use Node 24 and the pnpm version pinned in `package.json`. Create a free openrouteservice key at [HeiGIT](https://account.heigit.org/).

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local # Add ORS_API_KEY; keep this file untracked.
pnpm dev
```

`ORS_API_KEY` is required for routes and stays on the server. Search by address uses [Photon](https://github.com/komoot/photon) at `https://photon.komoot.io/api/`; optional `PHOTON_URL` selects another HTTPS instance. Coordinate entry does not use Photon. Park, wood and lake outlines come from OpenStreetMap via the public [Overpass API](https://overpass-api.de/) (with one fallback mirror) and are cached per server instance for six hours. Map tiles come from OpenStreetMap with visible attribution. The service stores no routes, addresses or location history.

## Verify

```sh
pnpm build         # Formatting, lint, types, unit tests, then Next.js
pnpm test:server   # Compiled Next.js with a deterministic ORS response
pnpm exec playwright install chromium
pnpm test:ui       # Desktop and mobile browser flows
pnpm test:live     # Optional: 10 km from Odeonsplatz must run through Englischer Garten
```

The live test consumes provider quota and is deliberately excluded from CI. CI also runs `pnpm audit`. A preview deployment should be checked with `pnpm test:deployment https://YOUR-PREVIEW-URL`; then exercise one real loop and GPX download before merging.

## Deploy

Vercel builds the `main` branch and previews pull requests. Configure `ORS_API_KEY` in both Preview and Production and redeploy after changing it. Both Vercel and GitHub Actions run `pnpm build`, which runs formatting, lint, types and unit tests before compiling Next.js. Vercel may rewrite `vercel.json` during its build, so Prettier excludes that generated configuration. Require the GitHub **Quality and routing regressions** check before merging. Configure Vercel Firewall limits for `/api/loops` to protect shared ORS quota; searches from different users run concurrently.

### How loops are chosen (parks first)

1. **Map the green space.** Parks, woods, recreation grounds and lakes within reach of the start (≈ target ÷ 2.4) are rasterised into a grid. Connected green areas are sized; large parks (≥ 15 ha, e.g. Englischer Garten) count fully, pocket parks less. Lakes are cut out. The Odeonsplatz example uses a bundled approximate Englischer Garten corridor so a public map-service outage does not send it back onto streets; its displayed coverage is labeled approximate.
2. **Plan waypoints inside parks.** Candidate points are taken deep inside green areas. Every start → A → B (→ C) → start combination is scored by the share of its straight legs that lie in green space and how well its expected length (straight × detour factor 1.3) matches the target; sharp out-and-back spurs are penalised. The three best, mutually distinct plans are routed in parallel with ORS `foot-walking` (stairs and ferries avoided, mild green/quiet weighting).
3. **Calibrate length.** If the best loop is more than 7 % off, the observed detour factor is fed back into the planner and up to two corrected plans are routed.
4. **Rank by real park time.** Each route's geometry is measured against the park grid. Ranking: share inside parks first, then distance error, ORS green, path and quiet ratings. The result names the parks the loop runs through.
5. **Fallback.** Without park data (Overpass down) or without reachable green space, the planner uses seeded ORS round trips with green and quiet preferences as before.

A search uses one Overpass request and 3–5 ORS requests. ORS ratings describe mapped route segments; the service does not count traffic lights or promise a stop-free run. Check local signs and conditions. API requests have bounded bodies and provider timeouts; failed providers produce readable errors without disclosing the key. `GET /api/health` checks the application only.

The website integration is maintained in the `Bachfischer/bachfischer.github.io` repository. This repository contains the standalone planner and its embed mode.
