# Test strategy and evidence

## Repeatable automated layers

| Layer | Command | Purpose |
| --- | --- | --- |
| Unit/API/algorithm | `pnpm check` | Formatting, zero-warning lint, TypeScript, native Node tests and core coverage gates |
| Real map | Included above | Recorded Odeonsplatz network, actual park boundaries and signals; route continuity/closure/distance and quality assertions |
| Memory regression | `pnpm test:memory` | Runs real Munich routing with a 96 MB Node heap ceiling |
| Cloudflare runtime | `pnpm build && pnpm test:worker` | Loads the compiled production modules in workerd and exercises validation, coordinate search and 10 km routing with recorded external data |
| Browser | `pnpm test:ui` after build/config | Playwright desktop and mobile Chromium; 21 scenarios each, screenshots and traces on failure |
| Deployment | `pnpm test:deployment URL` | HTTPS page, coordinate API and invalid route input; no Overpass request |
| External availability | `pnpm test:live` | Explicit live Munich Overpass request, excluded from routine CI |

## Coverage scope

Core coverage includes `lib/routing.ts`, `scenery.ts`, `route-search.ts`, `providers.ts`, `http.ts`, `gpx.ts` and `errors.ts`. Unused starter database/UI utilities are excluded. Gates are 90% lines, 90% functions and 80% branches. Coverage is not a claim of correctness; the important assertions include missing graph links, no fabricated river/building connectors, conditional/private foot access, barriers, pedestrian one-way behavior, no-loop networks, geographic boundaries, response-size cancellation, adaptive dense-area retries preserving 10 km, provider failures and in-flight cleanup.

Scenery tests prove that a slightly longer park path wins over a shorter street path and that a signal penalty selects an unsignalled alternative. Polygon tests include joined/reversed multipolygon outlines and inner holes. The real-map assertion verifies over 70% green spaces and zero mapped signal encounters for the Munich recommendation.

UI tests cover empty state, example setup, three invalid distance cases, distance bounds, keyboard coordinate search through the Worker, recommendation explanations, pending controls/request payload, server and network failures, stale result clearing, alternatives and GPX coordinates, map pinning, unobscured route/map geometry, horizontal overflow at desktop/mobile widths, embedded mode and both Projects launch links, including navigation without JavaScript. UI route responses are derived from the recorded real map, with deterministic API interception; this isolates UI correctness from public API availability. The separate compiled workerd test exercises the real route handlers and algorithm together.

## Verification boundaries

The live Node provider/algorithm smoke check passed for Munich. The managed development browser exercised the real form and provider-error recovery; its workerd backend could not reach Overpass. The success screen and alternatives were therefore visually checked using the recorded real route with a temporary local handler, restored before the production build. Browser checks and generated CI tests are different evidence: the Playwright suite must run in your GitHub environment before its status is considered passing. The included workflow installs Chromium and executes it automatically. The first GitHub run passed all 181 original core tests and 35 of 36 browser cases; the mobile Projects failure exposed a Vinext Link runtime error. Standard document links fix that dependency, with regression cases for both launch links. The expanded core suite now contains 190 tests, including segment snapping and separately mapped sidewalk access. Local controlled-browser checks do not claim a completed remote GitHub Actions run.

The recorded result is approximately 9.974 km, 74.3% mapped green spaces, 91.9% paths/tracks, 4.6% repeated distance and zero mapped traffic-light encounters. These describe OSM data, not a physically surveyed route, current closures or unmapped lights. The comparison trades some repeated distance for substantially more green coverage.

## Reproduce and refresh

The fixture was obtained on 2026-09-13 from the query in `tests/fixtures/munich-query.overpass`. It is ODbL data with attribution in `tests/fixtures/README.md`. Refresh deliberately, preserve routing/access/green-space/signal information, recompute `munich-result.json` with `findLoops`, and review changes in quality rather than blindly accepting new snapshots. No snapshot file is ever served as a fallback route.

The CI suite intentionally does not repeatedly call public geocoding/routing services. Run the opt-in live check when changing queries/provider contracts, and verify deployment smoke checks after changing Worker packaging or routing.

Both desktop and mobile GPX download assertions passed in the first GitHub Actions run, including comparison against the displayed route coordinates.
