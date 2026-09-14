# Cloudflare Workers and GitHub Actions

## Integration scenario

Keep `Bachfischer/bachfischer.github.io` on its existing GitHub Pages/Jekyll pipeline. Place this application in a separate GitHub repository (suggested name: `running-route-finder`). This repository's `.github/workflows/ci.yml` owns the Worker; the blog's existing workflow owns the Projects article. A link between them requires no CORS, proxy or shared build dependencies.

After deploying the Worker, add `run.bachfischer.me` under the Worker's Settings → Domains & Routes → Add → Custom Domain, using the Cloudflare account containing the active domain zone. Set Jekyll's `running_routes_url` to that verified URL and apply `integration/website-projects.patch`. Run the existing Jekyll checks and merge normally. The working `workers.dev` URL is sufficient until the custom domain is ready.

## First deployment

Use Node 24 and the pnpm version pinned in package.json. Enable Workers Paid; the Free CPU budget is insufficient for local graph routing. The app requests 30,000 ms CPU per invocation, not 30 seconds of external fetch wall time. Inspect actual Worker CPU and memory metrics under your workload; the 96 MB Node heap test is a regression guard, not proof of a production memory guarantee.

```sh
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm check
pnpm test:memory
pnpm build
pnpm test:worker
node scripts/cloudflare-config.mjs
pnpm exec playwright install --with-deps chromium
pnpm test:ui
pnpm exec wrangler deploy --dry-run --config wrangler.deploy.json
pnpm exec wrangler login
pnpm exec wrangler deploy --config wrangler.deploy.json
```

`wrangler.deploy.json` is generated and ignored. Optional generation inputs: `WORKER_NAME` (default `loop-running-routes`), `PHOTON_URL`, `OVERPASS_URL`. There are no required API secrets, database migrations or bindings. Do not use `wrangler deploy` without `--config wrangler.deploy.json`: the development configuration is separate.

## Activate GitHub CI/CD

Push this source to your app repository. The included workflow runs on pull requests, main pushes and manual dispatch. Create a `production` GitHub environment. Add these GitHub secrets (environment or repository):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers Scripts Edit for your account; scope to the intended account. Use Cloudflare's Workers deployment token guidance for any additional permission your domain setup needs. |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

Add repository variables:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_DEPLOY_ENABLED` | `true` when automatic main-branch deployment should begin |
| `WORKER_NAME` | Optional stable Worker name |
| `APP_URL` | Verified HTTPS production URL, enabling post-deploy smoke checks |
| `PHOTON_URL`, `OVERPASS_URL` | Optional compatible managed/self-hosted provider URLs |

Provider/name variables belong at repository scope because the quality job generates the config before entering the production environment. Keep secrets out of the generated config, source and PR workflows.

The quality job runs formatting/lint/types, coverage-gated tests, constrained-memory routing, a production build, compiled workerd API tests, desktop/mobile Playwright tests and Wrangler's deployment dry run. It uploads the tested `dist/` and generated configuration. Deployment depends on that job and downloads its exact artifact; it does not rebuild. Only main pushes with the enabling variable deploy. Pull requests, including forks, do not receive deployment secrets. A production smoke check verifies the page, coordinate search, and invalid-request handling without requesting a public map extract.

Make **Quality and routing regressions** a required main-branch status check and disallow direct pushes if desired. Enable required reviews in branch protection. Optional production environment reviewers add a deployment approval gate; the workflow itself does not require one. Dependabot proposes weekly npm and monthly Actions updates. Do not enable another independent Cloudflare auto-build for this same branch: it could deploy without this quality gate.

## Hooks

`pnpm hooks:install` sets `core.hooksPath` to `.githooks`; `prepare` also attempts installation outside CI. Existing custom hook paths are preserved by refusing to overwrite them. The pre-commit hook requires a fully staged change and runs `pnpm check` equivalent checks; the pre-push hook runs the same gate. Hooks do not auto-format or silently stage changes. Run `pnpm format`, review the diff, stage the intended complete change, then commit. Local hooks can be bypassed by Git, so CI and branch protection remain authoritative.

## Operations and rollback

The public Worker does not inherit the private Sites audience. Choose whether to publish publicly or put Cloudflare Access in front of it. For a public launch, configure edge rate limits on `/api/search` and `/api/loops` and provision suitable providers for expected traffic. Isolate-local cooldowns are deliberately documented as best-effort. Suggested initial edge limits are 10 searches/minute/IP and 4 loop requests/minute/IP; tune to actual usage and account capabilities.

Observe `/api/loops` success/error rates and Worker CPU/memory. A single fixture cannot establish high-concurrency capacity. Provider failures produce explicit errors; the service never substitutes a made-up route. Do not add route-coordinate logging or location analytics casually.

For a bad release, use Cloudflare's Worker deployment rollback to the previous known-good version, then revert the offending source commit in GitHub so the next main deployment preserves the fix. Keep test reports and traces from failed CI runs. `pnpm test:deployment https://YOUR-VERIFIED-URL` is a lightweight health check; `pnpm test:live` makes a deliberate live Munich provider request.

## Official references

- [Cloudflare GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers limits and CPU configuration](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Worker rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)

The source and workflows are prepared; no Worker in your own account, GitHub repository settings, secrets, custom domain or blog publication is configured by this change.
