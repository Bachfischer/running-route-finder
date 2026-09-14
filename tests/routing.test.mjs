import { test } from "node:test";
import assert from "node:assert/strict";
import { findLoops, canWalk, meters } from "../lib/routing.ts";
function grid() {
  const elements = [];
  for (let y = -12; y <= 12; y++)
    for (let x = -12; x <= 12; x++) {
      const id = (y + 12) * 25 + x + 13;
      elements.push({
        type: "node",
        id,
        lon: 11.58 + x * 0.002,
        lat: 48.14 + y * 0.0014,
      });
      if (x < 12)
        elements.push({
          type: "way",
          id: 10000 + id,
          nodes: [id, id + 1],
          tags: { highway: "footway" },
        });
      if (y < 12)
        elements.push({
          type: "way",
          id: 20000 + id,
          nodes: [id, id + 25],
          tags: { highway: "residential" },
        });
    }
  return elements;
}
test("loops close on graph edges, approximate distance, and respond to direction", () => {
  const data = grid();
  const start = [11.58, 48.14];
  const north = findLoops(data, start, 5000, "N"),
    south = findLoops(data, start, 5000, "S");
  for (const result of [north, south]) {
    const route = result.routes[0];
    assert.deepEqual(route.coordinates[0], route.coordinates.at(-1));
    assert.ok(Math.abs(route.distance - 5000) < 1200);
    assert.ok(route.repeat <= 0.3);
    let total = 0;
    for (let i = 1; i < route.coordinates.length; i++) {
      const a = route.coordinates[i - 1],
        b = route.coordinates[i];
      assert.ok(a[0] === b[0] || a[1] === b[1]);
      total += meters(a, b);
    }
    assert.ok(Math.abs(total - route.distance) < 0.01);
  }
  assert.ok(north.routes[0].bearing < 70 || north.routes[0].bearing > 290);
  assert.ok(south.routes[0].bearing > 110 && south.routes[0].bearing < 250);
});
test("excludes restricted and unsafe default access, respects foot overrides", () => {
  for (const t of [
    { highway: "motorway" },
    { highway: "footway", foot: "no" },
    { highway: "path", access: "private" },
    { highway: "path", "foot:conditional": "yes @ (sunrise-sunset)" },
    { highway: "cycleway" },
    { highway: "path", sac_scale: "alpine_hiking" },
    { highway: "secondary", sidewalk: "no" },
  ])
    assert.equal(canWalk(t), false);
  assert.equal(
    canWalk({ highway: "path", access: "private", foot: "yes" }),
    true,
  );
});
test("rejects disconnected start and out-and-back-only networks", () => {
  assert.throws(() => findLoops(grid(), [0, 0], 5000, "Any"), /300 m/);
  const elements = [];
  for (let i = 0; i < 40; i++) {
    elements.push({ type: "node", id: i, lon: 11.58 + i * 0.001, lat: 48.14 });
    if (i)
      elements.push({
        type: "way",
        id: 100 + i,
        nodes: [i - 1, i],
        tags: { highway: "footway" },
      });
  }
  assert.throws(
    () => findLoops(elements, [11.58, 48.14], 5000, "Any"),
    /No suitable loop/,
  );
});
