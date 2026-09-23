# Vercel deployment and GitHub Actions

## First deployment

1. Merge reviewed changes only after **Quality and routing regressions** passes. In GitHub Settings → Rules → Rulesets (or branch protection), require that check and pull requests for `main`; prevent bypass/direct pushes where your GitHub plan permits.
2. In Vercel, choose Add New → Project and import `Bachfischer/running-route-finder`. Authorize the Vercel GitHub app for this repository. Keep Framework **Next.js**, root **./**, Node **24.x**, production branch **main**, and Fluid Compute enabled. Use the committed install/build settings; no output-directory override.
3. Create a free openrouteservice API key at [HeiGIT](https://account.heigit.org/). In Vercel Project → Settings → Environment Variables, set `ORS_API_KEY` as a sensitive server-side value for both Preview and Production, then redeploy both. Never put the key in Git, a URL, `NEXT_PUBLIC_*`, or chat. Without a key the public Overpass engine remains available, but its hosts have timed out in production. No database is required.
4. Verify the deployment URL using `pnpm test:deployment https://YOUR-DEPLOYMENT.vercel.app`. Then select the Munich example and request 10 km. Smoke checks use no public map request; the interactive run deliberately does.
5. Add `run.bachfischer.me` under Settings → Domains. Apply the DNS record Vercel displays and wait for domain/TLS verification. Keep the existing website's apex DNS and GitHub Pages deployment intact.

Build success is not a launch acceptance test: the fixture-based CI suite does not prove that Vercel can reach the public map providers. Complete the live checks below before announcing a working deployment.

## Environment variables

Copy `.env.example` to an uncommitted `.env.local` for local live routing, or set the key in Vercel project environment settings for Preview and Production separately, then deploy a new version. Deterministic tests need no key.

| Variable       | Default                                   | When to set it                                         |
| -------------- | ----------------------------------------- | ------------------------------------------------------ |
| `ORS_API_KEY`  | unset                                     | Recommended: enables managed green/quiet walking loops |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | A tested, compatible HTTPS map provider                |
| `PHOTON_URL`   | `https://photon.komoot.io/api/`           | A tested, compatible HTTPS address-search provider     |

With `ORS_API_KEY` set, routing uses the openrouteservice foot-walking round-trip API at `api.heigit.org`. At most four candidate requests prefer green, quiet paths and avoid mapped stairs/ferries; distance, direction and green/quiet ratings rank the results. A user request can consume up to four free-tier provider calls. ORS cannot guarantee a stop-free route or count traffic lights. Without the key, a connection failure or timeout at the default Overpass host triggers one sequential attempt at `https://overpass.private.coffee/api/interpreter`. Each provider has a fresh timeout of up to 40 seconds. HTTP errors, throttling, cancellation and invalid data do not trigger failover. Setting **any** `OVERPASS_URL` disables the public fallback. Do not put credentials into either URL or set `VERCEL` yourself.

## Cloudflare DNS and the production domain

In Vercel, add `run.bachfischer.me` to this project's production environment. In Cloudflare, create the `run` CNAME using the **exact target Vercel shows for this project**. Keep Cloudflare nameservers and the existing apex/GitHub Pages records unchanged. Vercel recommends DNS-only (grey cloud) for this setup, avoiding an extra reverse proxy. Do not change existing security/proxy settings without reviewing their purpose.

Wait for Vercel to validate the domain and issue TLS. Check that the domain is assigned to the intended production deployment, not an older deployment or preview branch. A successful JSON response from `/api/search` means the request reached the app; changing DNS will not repair an outbound Overpass connection failure.

## Verify every production deployment

1. In Vercel Deployments, check the **commit SHA** and wait for Ready. A merged PR is not necessarily live yet. Redeploying an old failed commit does not deploy the fix.
2. Open `https://run.bachfischer.me` in a fresh page. Confirm there are no blog tabs, the description starts with “Choose your starting point and distance”, and the button says “Find a running route”. These markers distinguish the standalone version from the earlier page, not every subsequent commit.
3. Run the inexpensive smoke check:

   ```sh
   pnpm test:deployment https://run.bachfischer.me
   ```

   This checks the page, coordinate lookup and input validation only. It does **not** contact Photon or Overpass. `/api/health` similarly checks only app availability.

4. Search for `Odeonsplatz, Munich` to exercise live address lookup. Then use **Try 10 km from Odeonsplatz** and **Find a running route**. Wait for a route, inspect the distance/map, and download the GPX. Check that cancellation releases the controls. Do not repeatedly submit while a search is running.
5. For a reproducible live routing diagnostic, run this **once**, deliberately outside CI:

   ```sh
   curl --silent --show-error --max-time 150 \
     --dump-header route-headers.txt --output route-response.json \
     --write-out 'HTTP %{http_code}; %{time_total}s\n' \
     'https://run.bachfischer.me/api/loops' \
     --header 'Content-Type: application/json' \
     --data '{"lat":48.142,"lon":11.577,"distance":10,"direction":"N"}'
   ```

   Expect HTTP 200 and a nonempty `routes` array containing actual coordinates and a distance reasonably close to 10,000 metres. An error envelope, empty route or HTML login page is a failure, regardless of the build status. Inspect continuity and mapped interruption counts; live OSM data need not match the recorded fixture exactly. Keep response files locally, not in Git. Respect `Retry-After` on 429; do not run this as a frequent uptime probe.

## Troubleshooting

| Symptom                                               | Check / action                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier warns about `vercel.json`                    | Deploy the current commit. Its build command formats only this file before running all checks. Do not remove the quality gate.                                                   |
| New commit is Ready, but old UI remains               | Verify production domain assignment and commit, then refresh the page. Check any explicitly configured external caching.                                                         |
| Preview returns 401 or Vercel login                   | Sign in with an authorized account to test the preview. Do not disable deployment protection or treat the login page as an app failure.                                          |
| App returns “Could not connect…” / “Could not reach…” | The outbound provider request failed. Inspect Production environment overrides and Vercel runtime logs; this message alone does not distinguish DNS, TLS or connection failures. |
| App returns map timeout or busy error                 | The provider/query deadline or an upstream HTTP failure was reached. Respect rate limits. Do not repeatedly retry or blindly increase the function timeout.                      |
| App returns 429                                       | Respect `Retry-After`. Check both app cooldowns and provider capacity.                                                                                                           |

For a failed live request, retain the UTC time, deployment SHA, HTTP status, duration, `X-Request-ID` and `X-Vercel-ID` from the response headers. In the project's **Logs** view, select Production and filter `POST /api/loops` around that time. Build logs are a different view. Application logs contain status/duration and the application request ID. Within the same invocation, `map_provider` events report `primary`, `backup` or `custom`, an outcome (`success`, `timeout`, `connection`, `cancelled`, `capacity` or `response`) and duration, without provider URLs, coordinates or raw exceptions. A primary timeout followed by backup success demonstrates failover; two timeouts still mean live routing failed. The earlier 40,007 ms application failure matched its map deadline, not the 180-second Vercel function limit. Share only relevant redacted logs—never cookies, tokens or private address searches.

Test a replacement provider from the deployed function before switching production. Public Overpass instances provide no SLA. Do not claim the connectivity issue is fixed until a live deployed route succeeds.

## Previews and quality gates

Vercel's native Git integration builds each PR commit and provides a preview URL. `vercel.json` runs `pnpm exec prettier --write vercel.json && pnpm check && pnpm build`. The first step normalizes the deployment copy of the config; source formatting remains checked in CI and hooks, and failed core tests still prevent a successful deployment. GitHub Actions additionally runs the 96 MB memory regression, the compiled production-server functional tests, and desktop/mobile Playwright tests. Test reports and failure traces are retained as workflow artifacts.

Require the GitHub quality job before merging: Vercel does **not** wait for unrelated GitHub Actions runs, and a direct push to `main` can otherwise deploy before UI tests finish. Do not add a second CLI deployment workflow; native Git deployment owns publication. If branch protection is unavailable for your private-repository plan, keep production deployment manual until you have an enforceable merge gate.

Hooks install through `pnpm install`/`prepare` or `pnpm hooks:install`. Pre-commit checks the fully staged source; pre-push repeats formatting, lint, types and coverage. CI is authoritative since local hooks can be bypassed. Browser/production tests run in CI rather than making every small commit slow.

Preview Deployment Protection may require sign-in. Use the signed-in browser to inspect a protected preview; the CLI smoke check expects an accessible HTTPS deployment. Do not weaken production access settings merely to make a smoke check pass.

## Runtime and caching

API handlers explicitly use Node.js. Routing has a 180-second function limit; address search has 60 seconds. The existing route search allows up to six map queries with a 110-second area-search deadline; the candidate loop also checks wall-clock time and preserves an already found valid loop. A graph build or A* leg already underway cannot be preempted. Frankfurt (`fra1`) keeps execution close to the initial Munich audience. The graph algorithm is unchanged by this migration.

Vercel Runtime Cache shares compressed map areas across instances, with a 15-minute TTL and project-specific namespace. The application enforces a 1.95 MB serialized entry cap, below the documented 2 MB limit. Cache errors/timeouts fail open. Preview and production caches are separated by Vercel. Local development uses four bounded in-memory entries. Graphs and final routes are not cached.

The recorded Munich production-server test verifies a 10.26 km closed loop, over 88% mapped green space, over 98% paths, under 5% repeat and no mapped signals, crossings, barriers, railway crossings or stairs. It also verifies two searches require one Overpass download. This exercises production packaging with recorded external data, not Vercel's remote cache service or present-day path conditions.

The cooldown uses Vercel's `x-real-ip` header. Cooldowns and the in-flight guard are best-effort per instance, not distributed rate limiting. On another Node host, a trusted reverse proxy must overwrite that header. Configure Vercel Firewall rate limits and suitable map providers before broad public traffic; public Overpass/Photon services can throttle.

## Website integration and rollback

Apply `integration/website-projects.patch` in the existing website repository, set `running_routes_url` to the verified app URL, run its Jekyll checks, and open a separate PR. The project article links to the app; `?embed=1` is optional. This repository does not alter the website or its DNS.

Use Vercel's deployment rollback for a bad release and revert the source change through a PR. If the map schema/query changes, increment the cache key/namespace version. Existing data expires within 15 minutes; deployment rollback alone does not clear Runtime Cache.

References: [GitHub integration](https://vercel.com/docs/git/vercel-for-github), [custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [Cloudflare DNS-only guidance](https://vercel.com/kb/guide/vercel-waf-vs-cloudflare-waf), [runtime logs](https://vercel.com/docs/logs/runtime), [Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js), [Runtime Cache](https://vercel.com/docs/caching/runtime-cache), [cache SDK](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [request headers](https://vercel.com/docs/headers/request-headers).

See [the production runbook](PRODUCTION.md) for request limits, monitoring, dependency maintenance and launch requirements.
