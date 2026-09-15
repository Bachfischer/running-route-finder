import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findLoops, meters } from "../lib/routing.ts";
test("real Munich regression: 10 km route closes, follows graph and stays near target", () => {
  const data = JSON.parse(
    gunzipSync(
      readFileSync(new URL("./fixtures/munich-10km.json.gz", import.meta.url)),
    ).toString(),
  );
  const found = findLoops(data.elements, [11.577, 48.142], 10000, "N");
  const route = found.routes[0];
  assert.ok(Math.abs(route.distance - 10000) < 500);
  assert.ok(route.repeat < 0.05);
  assert.ok(route.parks > 0.7);
  assert.ok(route.paths > 0.9);
  assert.equal(route.trafficLights, 0);
  assert.deepEqual(route.coordinates[0], route.coordinates.at(-1));
  assert.ok(found.snapDistance < 30);
  let length = 0;
  for (let i = 1; i < route.coordinates.length; i++)
    length += meters(route.coordinates[i - 1], route.coordinates[i]);
  assert.ok(Math.abs(length - route.distance) < 0.01);
});
