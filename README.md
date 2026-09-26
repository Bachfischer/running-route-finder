# Running route finder

Plan a 2–25 km running loop from an address, map pin, coordinates or current location. Compare routes, see their mapped park coverage and download GPX. The standalone app runs at `run.bachfischer.me`; `?embed=1` is used by `bachfischer.me`.

## Local development

Use Node 24 and the pnpm version declared in `package.json`. Get an openrouteservice (ORS) API key from [HeiGIT](https://account.heigit.org/).

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# Set ORS_API_KEY in .env.local
pnpm dev
```

The key stays on the server. Address search uses [Photon](https://github.com/komoot/photon) at `https://photon.komoot.io/api/`; `PHOTON_URL` can point to another HTTPS instance. Coordinates and map pins do not require Photon. Map tiles come from OpenStreetMap with attribution. The app stores no route or location history.

## How routing works

`app/api` validates requests and calls the route search. `lib/ors.ts` requests walking routes from ORS and ranks them. `lib/planner.ts` selects park waypoints; `lib/green.ts` measures park coverage on a raster grid. `lib/overpass.ts` retrieves and parses OpenStreetMap park, woodland and water outlines from two public Overpass mirrors and caches the result for six hours per server instance. `lib/park-source.ts` chooses the park data source.

The park source uses a bundled **approximate** Englischer Garten corridor for starts within 1.2 km of Odeonsplatz. This keeps the 10 km Odeonsplatz route oriented through the park even when public Overpass servers are slow or unavailable. The UI labels its park coverage as approximate. Elsewhere, the source requests mapped outlines from Overpass. If neither a usable park plan nor park data is available, ORS can still generate green and quiet weighted round trips. It is possible for a park plan to fail when ORS cannot connect the requested paths.

Park waypoints are chosen inside connected green areas; water is excluded. The search asks ORS for up to three different waypoint plans in parallel and can make up to two length corrections. Routes are ranked by park coverage, distance error and ORS green, path and quiet ratings. If fewer than two park routes work, seeded round trips supplement the choices. A search can make multiple ORS requests; the number depends on success and calibration. Public map services and routing may be slow. ORS ratings depend on mapped segments and cannot guarantee a silent or traffic free run. Check signs and conditions on the ground.

## Verification

```sh
pnpm build         # Prettier, ESLint, types, unit coverage, Next.js build
pnpm test:server   # Compiled server with a deterministic ORS response
pnpm exec playwright install chromium
pnpm test:ui       # Desktop and mobile flows
pnpm test:live     # Optional real 10 km Odeonsplatz route (uses provider quota)
```

GitHub Actions runs the build, server tests, browser tests and `pnpm audit`. Vercel runs the same `pnpm build` checks before deployment. CI simulates Vercel rewriting `vercel.json` before the build; that generated file is excluded from formatting. The live provider test is excluded from CI. For a preview, run `pnpm test:deployment https://YOUR-PREVIEW-URL`, then verify a real loop and GPX download.

## Deployment

Vercel builds `main` and preview branches. Configure `ORS_API_KEY` for Preview and Production, then redeploy after changing it. Require the GitHub **Quality and routing regressions** check before merging. Configure a Vercel Firewall limit for `/api/loops` to protect shared ORS quota. `GET /api/health` only checks the application, not its external providers. API request sizes and provider response sizes are bounded, and provider errors do not disclose the key.

The website embedding is maintained in the `Bachfischer/bachfischer.github.io` repository.
