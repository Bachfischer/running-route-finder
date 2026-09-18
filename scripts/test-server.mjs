// Real compiled Next.js + Node.js server; only external provider data is recorded.
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
      OVERPASS_URL: "",
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
      if ((await fetch(base)).ok) break;
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
  const bad = await fetch(base + "/api/loops", { method: "POST", body: "{}" });
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
    assert.ok(route.parks > 0.88 && route.paths > 0.98 && route.repeat < 0.05);
    for (const key of [
      "trafficLights",
      "crossings",
      "barriers",
      "railwayCrossings",
      "steps",
    ])
      assert.equal(route[key], 0);
    assert.deepEqual(route.coordinates[0], route.coordinates.at(-1));
    console.log(
      `Production Node.js API: ${(route.distance / 1000).toFixed(3)} km, ${(route.parks * 100).toFixed(1)}% green, zero mapped interruptions.`,
    );
  }
  await setTimeout(50); // Flush child stdout before asserting provider call count.
  assert.equal(output.split("TEST_PROVIDER_OVERPASS").length - 1, 1, output);
  console.log(
    "Validation, coordinate lookup, real-map routing and repeated-search cache passed.",
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill("SIGTERM");
  const timer = globalThis.setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}
