# Vercel deployment and GitHub Actions

## First deployment

1. Review and merge the migration PR after **Quality and routing regressions** passes. In GitHub Settings → Rules → Rulesets (or branch protection), require that check and pull requests for `main`; prevent bypass/direct pushes where your GitHub plan permits.
2. In Vercel, choose Add New → Project and import the private `Bachfischer/running-route-finder` repository. Authorize the Vercel GitHub app for this repository. Keep Framework **Next.js**, root **./**, Node **24.x**, production branch **main**, and Fluid Compute enabled. Use the committed install/build settings; no output-directory override.
3. Deploy. No provider API keys, database, Cloudflare account, or GitHub deployment secrets are required. Optional `OVERPASS_URL` and `PHOTON_URL` environment variables override the default HTTPS providers; configure Preview and Production separately. No credentials in URLs.
4. Verify the deployment URL using `pnpm test:deployment https://YOUR-DEPLOYMENT.vercel.app`. Then select the Munich example and request 10 km. Smoke checks use no public map request; the interactive run deliberately does.
5. Add `run.bachfischer.me` under Settings → Domains. Apply the DNS record Vercel displays and wait for domain/TLS verification. Keep the existing website's apex DNS and GitHub Pages deployment intact.

This repository is deployment-ready; importing it into your Vercel account and configuring GitHub rules are account actions, not settings this repository can silently enforce.

## Previews and quality gates

Vercel's native Git integration builds each PR commit and provides a preview URL. `vercel.json` runs `pnpm check && pnpm build`, so failed core tests cannot produce a successful deployment. GitHub Actions additionally runs the 96 MB memory regression, the compiled production-server functional tests, and desktop/mobile Playwright tests. Test reports and failure traces are retained as workflow artifacts.

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

References: [GitHub integration](https://vercel.com/docs/git/vercel-for-github), [Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js), [Runtime Cache](https://vercel.com/docs/caching/runtime-cache), [cache SDK](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [request headers](https://vercel.com/docs/headers/request-headers).

See [the production runbook](PRODUCTION.md) for request limits, monitoring, dependency maintenance and launch requirements.
