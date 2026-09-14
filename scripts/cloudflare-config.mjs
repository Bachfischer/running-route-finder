import { existsSync, writeFileSync } from "node:fs";
if (!existsSync("dist/server/index.js")) throw Error("Run pnpm build first.");
const name = process.env.WORKER_NAME || "loop-running-routes";
if (!/^[a-z][a-z0-9-]{0,62}$/.test(name))
  throw Error("WORKER_NAME must be a valid Worker name.");
const vars = {};
for (const key of ["PHOTON_URL", "OVERPASS_URL"])
  if (process.env[key]) {
    const url = new URL(process.env[key]);
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error(`${key} must be an HTTPS endpoint without credentials.`);
    vars[key] = url.toString();
  }
const config = {
  name,
  main: "dist/server/index.js",
  compatibility_date: "2026-05-15",
  compatibility_flags: ["nodejs_compat"],
  no_bundle: true,
  assets: { directory: "dist/client" },
  limits: { cpu_ms: 30000 },
  vars,
  workers_dev: true,
  preview_urls: true,
  observability: { enabled: true },
  rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
};
writeFileSync("wrangler.deploy.json", JSON.stringify(config, null, 2) + "\n");
console.log(`Created configuration for ${name}.`);
