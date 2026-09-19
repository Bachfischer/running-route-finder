# Production runbook

## Maintenance review — 2026-09-19

The route finder uses six runtime packages: Next.js, React, React DOM, Leaflet, Lucide and the Vercel Functions SDK. Removed the unused starter component catalogue, database remnants, icon assets, animation stylesheet and 19 unused runtime dependencies. The two controls the app uses are small native React components. The existing visual theme and routing preferences remain.

| Open Dependabot PR   | Resolution in the maintenance PR                                                |
| -------------------- | ------------------------------------------------------------------------------- |
| #9 Base UI           | Removed unused package and its unused components                                |
| #8 Recharts          | Removed unused chart package and component                                      |
| #7 Input OTP         | Removed unused OTP package and component                                        |
| #6 setup-node        | Upgrade to v7, pinned to upstream commit                                        |
| #4 upload-artifact   | Upgrade to v7, pinned to upstream commit                                        |
| #3 pnpm/action-setup | Upgrade to v6, pinned to upstream commit                                        |
| #2 checkout          | Upgrade to v7.0.1, pinned to upstream commit; disable persisted Git credentials |

Next.js and eslint-config-next move together to 16.3.5; React/DOM and their types to 19.3.0; Tailwind/PostCSS to 4.3.3; pnpm to 11.26.0; Node types match runtime major 24. ESLint 9.39.5 is the latest compatible patch: the current Next.js React/import/accessibility plugins do not declare ESLint 10 support. ESLint 9 is upstream-deprecated; track plugin compatibility before the next major upgrade. TypeScript 5.9 remains to avoid coupling a compiler-major migration to runtime hardening.

Seven-day package maturity remains enabled. Targeted transitive security floors patch ws, Browserslist, Babel, baseline-browser-mapping and brace-expansion. Remove each override once upstream resolution supplies a patched version naturally. No audit advisories are suppressed. The full lockfile audit reported zero known vulnerabilities at review time; this is time-dependent, not a guarantee against unknown issues. Dependabot groups framework pairs, styling pairs and compatible tooling updates; Actions updates are grouped separately.

## Request lifecycle

- Route requests require JSON, a same-origin browser context when origin headers are present, at most 1,500 body bytes, and a five-second body-read budget. Non-browser clients may omit Origin. These checks complement rate limiting; they do not authenticate users.
- Provider requests bypass implicit framework caching, prohibit redirects, have bounded streaming bodies and a maximum 40-second fetch/body timeout. Only the explicit validated map cache persists provider data.
- Browser address requests time out after 45 seconds; route requests after 150 seconds. Cancelling a search aborts the browser fetch and ignores late responses. Server request cancellation propagates to map loading where the hosting platform delivers the disconnect signal.
- Route searches have up to six queries and a 110-second budget. Wall-clock checks between candidates preserve an already computed loop on budget exhaustion. Synchronous graph construction and A* legs cannot be interrupted mid-execution. The 180-second Vercel function limit is the final ceiling, not a promised response time.
- Rate-limited responses contain Retry-After, which the UI explains. Gateway HTML, malformed envelopes and network errors produce readable messages and release controls. Address results use `no-store` to avoid persisting searches in browser HTTP caches.

## Diagnostics and availability

`GET /api/health` returns `{ "status": "ok" }` without external provider calls or configuration disclosure. Monitor it for app availability; it does not prove Overpass/Photon availability or route quality. Use the opt-in `pnpm test:live` for a deliberate provider/routing check.

Search and route responses carry `X-Request-ID`. Application logs contain only request ID, operation, HTTP status and duration. They omit query strings, coordinates, addresses, client IPs and raw exceptions. Hosting access logs are controlled separately in Vercel. Start alerts for sustained 5xx responses, increased route latency, and unusual 429 volume. Inspect both provider availability and CPU duration before changing timeout limits.

Security headers disable MIME sniffing and plugin objects, restrict base URLs and allow framing only by the app and bachfischer.me. The app deliberately permits that embed; it does not set a conflicting X-Frame-Options header. The policy does not yet restrict scripts/styles: enforcing those requires a tested nonce strategy for Next.js and Leaflet. Camera and microphone are disabled. HTTPS/TLS are provided by Vercel.

## Launch settings still required in the hosting account

1. Require **Quality and routing regressions** before merging and prevent direct main pushes. Vercel native Git deployment does not wait for unrelated Actions jobs.
2. Configure Vercel Firewall limits for `/api/search` and `/api/loops`, based on expected usage and account capabilities. Instance-local cooldowns and the in-flight guard are not distributed protection. Start conservatively and tune from status/latency metrics.
3. Confirm provider terms, capacity and attribution for the expected audience. Public Overpass/Photon have no uptime guarantee. A managed or self-hosted provider is the next step for sustained traffic.
4. Configure monitoring and spending alerts, verify preview/production access, and smoke-test the actual deployed HTTPS URL. Confirm the custom-domain embed separately if enabling it.

The code tests recorded map data and production packaging; they do not load-test Vercel or exercise its remote cache. The Munich fixture verifies a 10.26 km recommendation with 90.4% green space and no mapped interruption counts. It is not a survey of current closures or conditions.

## Rollback and branch hygiene

Roll back to a known-good Vercel deployment, then revert the source change through a PR. Cache records expire after 15 minutes; change the cache namespace for incompatible map schemas.

After the replacement maintenance PR passes, close the seven superseded bot PRs. Remove their head branches only after verifying the dependency removal/upgrade is present in the replacement PR. The merged `initialize-route-planner`, `smoother-running-loops` and `nextjs-vercel-migration` branches may be deleted after confirming their PRs are merged. Preserve `main`, the active maintenance branch and any branch with unaccounted-for work. GitHub can restore a deleted PR head from its PR page if needed.
