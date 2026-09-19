# Test strategy and evidence

## Repeatable automated layers

| Layer                 | Command                          | Purpose                                                                                                                      |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unit/API/algorithm    | `pnpm check`                     | Formatting, zero-warning lint, TypeScript, native Node tests and core coverage gates                                         |
| Real map              | Included above                   | Recorded Odeonsplatz network, actual park boundaries and signals; route continuity/closure/distance and quality assertions   |
| Memory regression     | `pnpm test:memory`               | Runs real Munich routing with a 96 MB Node heap ceiling                                                                      |
| Production Node.js    | `pnpm build && pnpm test:server` | Starts the compiled Next.js server and exercises validation, coordinate search and 10 km routing with recorded external data |
| Browser               | `pnpm test:ui` after build       | Playwright desktop and mobile Chromium; 27 scenarios each, screenshots and traces on failure                                 |
| Deployment            | `pnpm test:deployment URL`       | HTTPS page, coordinate API and invalid route input; no Overpass request                                                      |
| External availability | `pnpm test:live`                 | Explicit live Munich Overpass request, excluded from routine CI                                                              |

Dependency audit: `pnpm run audit` checks the whole lockfile and fails on high/critical advisories. Security overrides are narrow, documented version floors, not ignored advisories.

## Coverage scope

Cache tests cover expiry, key separation, bounded eviction, decompression limits, unavailable/hanging stores, corrupt entries, aborts, and avoiding error/oversized writes. Production-server tests repeat the Munich request and assert one provider download.

Core coverage includes `lib/routing.ts`, `scenery.ts`, `route-search.ts`, `providers.ts`, `http.ts`, `gpx.ts` and `errors.ts`. All maintained library files are included; unused starter utilities have been removed. Gates are 90% lines, 90% functions and 80% branches. Coverage is not a claim of correctness; the important assertions include missing graph links, no fabricated river/building connectors, conditional/private foot access, barriers, pedestrian one-way behavior, no-loop networks, geographic boundaries, response-size cancellation, adaptive dense-area retries preserving 10 km, provider failures and in-flight cleanup.

Scenery tests prove that a slightly longer park path wins over a shorter street path and that a signal penalty selects an unsignalled alternative. Polygon tests include joined/reversed multipolygon outlines and inner holes. The real-map assertion verifies over 88% green spaces and zero mapped signal encounters for the Munich recommendation.

UI tests cover empty state, example setup, three invalid distance cases, distance bounds, keyboard coordinate search through the Node.js API, recommendation explanations, pending controls/request payload, server and network failures, stale result clearing, alternatives and GPX coordinates, map pinning, unobscured route/map geometry, horizontal overflow at desktop/mobile widths, embedded mode and both Projects launch links, including navigation without JavaScript. UI route responses are derived from the recorded real map, with deterministic API interception; this isolates UI correctness from public API availability. The separate compiled production-server test exercises the real route handlers and algorithm together.

## Verification boundaries

The initialization PR passed 190 core tests and 42 desktop/mobile cases in GitHub Actions. This update adds interruption classification, cost invariance under geometry subdivision, strict-then-relaxed path search, surface start preference, distinct alternatives, and single-action location lookup tests. The browser suite now has 54 cases, including cancellation, malformed success data and gateway HTML failures. CI remains the authoritative status for each PR.

The refreshed 2026-09-15 Munich extract yields 10.260 km, 90.4% mapped green spaces, 99.3% paths/tracks, 2.5% repeated distance and zero mapped traffic-light, crossing, barrier, railway and stair encounters. The real-map regression asserts these properties with tolerances, not an exact route snapshot. OSM-derived counts cannot establish current closures, crowds or unmapped obstacles.

Production Node.js tests use the recorded external response with the real production handler and algorithm. UI tests use the derived route response to isolate UI behavior from public provider availability. No fixture is served by the production app as a fallback.

## Reproduce and refresh

The fixture was obtained on 2026-09-15 from the query in `tests/fixtures/munich-query.overpass`. It is ODbL data with attribution in `tests/fixtures/README.md`. Refresh deliberately, preserve routing/access/green-space/signal information, recompute `munich-result.json` with `findLoops`, and review changes in quality rather than blindly accepting new snapshots. No snapshot file is ever served as a fallback route.

The CI suite intentionally does not repeatedly call public geocoding/routing services. Run the opt-in live check when changing queries/provider contracts, and verify deployment smoke checks after changing Next.js packaging or routing.

Both desktop and mobile GPX download assertions passed in the first GitHub Actions run, including comparison against the displayed route coordinates.
