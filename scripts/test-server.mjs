// Real compiled Next.js server with a deterministic ORS response.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
const base = "http://127.0.0.1:8788";
let output = "";
const child = spawn(
  process.execPath,
  [
    "--import",
    fileURLToPath(
      new URL("../tests/support/provider-preload.mjs", import.meta.url),
    ),
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "8788",
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "",
      ORS_API_KEY: "test-only-key",
      PHOTON_URL: "",
      ROUTE_TEST_FIXTURES: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const exited = new Promise((resolve) => child.once("exit", resolve));
try {
  const deadline = Date.now() + 30000;
  while (true) {
    assert.equal(child.exitCode, null, output);
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {
      /* wait for listen */
    }
    if (Date.now() > deadline)
      throw Error("Next.js startup timed out: " + output);
    await setTimeout(100);
  }
  const location = await fetch(base + "/api/search?q=48.142,11.577");
  assert.equal(location.status, 200);
  assert.equal((await location.json()).places[0].lat, 48.142);
  assert.ok(location.headers.has("x-request-id"));
  assert.equal(location.headers.get("x-content-type-options"), "nosniff");
  assert.ok(
    location.headers
      .get("content-security-policy")
      .includes("https://bachfischer.me"),
  );
  assert.equal(location.headers.has("x-powered-by"), false);
  const health = await fetch(base + "/api/health");
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(health.headers.get("cache-control"), "no-store");
  const bad = await fetch(base + "/api/loops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(bad.status, 400);
  for (const ip of ["192.0.2.1", "192.0.2.2"]) {
    const response = await fetch(base + "/api/loops", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({
        lat: 48.142,
        lon: 11.577,
        distance: 10,
        direction: "N",
      }),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(response.headers.get("cache-control"), "no-store");
    const route = result.routes[0];
    assert.ok(Math.abs(route.distance - 10000) < 500);
    assert.equal(result.quality[0].green, 1);
    assert.equal(result.quality[0].quiet, 1);
    assert.deepEqual(route.coordinates[0], route.coordinates.at(-1));
    console.log(
      `Production Node.js API: ${(route.distance / 1000).toFixed(2)} km.`,
    );
  }
  assert.ok(output.includes("TEST_PROVIDER_ORS"), output);
  console.log("Validation, coordinate lookup and ORS-backed route passed.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill("SIGTERM");
  const timer = globalThis.setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}
