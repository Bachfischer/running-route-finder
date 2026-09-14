// Exercise the compiled production bundle in workerd; no public API calls.
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Response: WorkerResponse } = wranglerRequire("miniflare");
const fixture = gunzipSync(
  readFileSync(
    new URL("../tests/fixtures/munich-10km.json.gz", import.meta.url),
  ),
).toString();
let requests = 0;
const mf = new Miniflare({
  modules: readdirSync(resolve("dist/server"), { recursive: true })
    .filter((p) => /\.(m?js)$/.test(p))
    .sort((a, b) =>
      a === "index.js" ? -1 : b === "index.js" ? 1 : a.localeCompare(b),
    )
    .map((path) => ({ type: "ESModule", path: resolve("dist/server", path) })),
  modulesRoot: resolve("dist/server"),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],

  outboundService: async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "overpass-api.de") {
      requests++;
      return new WorkerResponse(fixture, {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected outbound request to ${url.hostname}`);
  },
});
try {
  const bad = await mf.dispatchFetch("https://loop.test/api/loops", {
    method: "POST",
    body: "{}",
  });
  assert.equal(bad.status, 400);
  const location = await mf.dispatchFetch(
    "https://loop.test/api/search?q=48.142,11.577",
  );
  assert.equal(location.status, 200);
  const response = await mf.dispatchFetch("https://loop.test/api/loops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lat: 48.142,
      lon: 11.577,
      distance: 10,
      direction: "N",
    }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.ok(Math.abs(data.routes[0].distance - 10000) < 500);
  assert.equal(requests, 1);
  console.log(
    "Compiled workerd API: validation, coordinate search, and real-map 10 km routing passed.",
  );
} finally {
  await mf.dispose();
}
