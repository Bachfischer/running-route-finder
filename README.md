# Running route finder

Plan a 2–25 km walking loop from an address, map pin or current location. Pick a preferred direction, compare up to five route candidates and export the selected one as GPX. The planner works on its own at `run.bachfischer.me` and supports `?embed=1` for `bachfischer.me`.

## Run locally

Use Node 24 and the pnpm version pinned in `package.json`. Create a free openrouteservice key at [HeiGIT](https://account.heigit.org/).

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local # Add ORS_API_KEY; keep this file untracked.
pnpm dev
```

`ORS_API_KEY` is required for routes and stays on the server. Search by address uses [Photon](https://github.com/komoot/photon) at `https://photon.komoot.io/api/`; optional `PHOTON_URL` selects another HTTPS instance. Coordinate entry does not use Photon. Map tiles come from OpenStreetMap with visible attribution. The service stores no routes, addresses or location history.

## Verify

```sh
pnpm build         # Formatting, lint, types, unit tests, then Next.js
pnpm test:server   # Compiled Next.js with a deterministic ORS response
pnpm exec playwright install chromium
pnpm test:ui       # Desktop and mobile browser flows
pnpm test:live     # Optional: one real Munich ORS search with .env.local
```

The live test consumes provider quota and is deliberately excluded from CI. CI also runs `pnpm audit`. A preview deployment should be checked with `pnpm test:deployment https://YOUR-PREVIEW-URL`; then exercise one real loop and GPX download before merging.

## Deploy

Vercel builds the `main` branch and previews pull requests. Configure `ORS_API_KEY` in both Preview and Production and redeploy after changing it. Both Vercel and GitHub Actions run `pnpm build`, which runs formatting, lint, types and unit tests before compiling Next.js. Vercel may rewrite `vercel.json` during its build, so Prettier excludes that generated configuration. Require the GitHub **Quality and routing regressions** check before merging. Configure Vercel Firewall limits for `/api/loops` to protect shared ORS quota; searches from different users run concurrently.

Each search compares four seeded `foot-walking` round trips with green and quiet preferences and mapped stairs avoided. A fifth request may correct an inaccurate distance. Candidates favor measured green and quiet segments and mapped running paths, while allowing modest differences from the requested distance or direction. ORS ratings describe mapped route segments and paths do not necessarily lie inside parks; the service does not count traffic lights or promise a stop-free run. Check local signs and conditions. API requests have bounded bodies and provider timeouts; failed providers produce readable errors without disclosing the key. `GET /api/health` checks the application only.

The website integration is maintained in the `Bachfischer/bachfischer.github.io` repository. This repository contains the standalone planner and its embed mode.
