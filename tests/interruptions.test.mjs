import { test } from "node:test";
import assert from "node:assert/strict";
import { interruptions } from "../lib/interruptions.ts";
import {
  graphFrom,
  shortest,
  routeInfo,
  routeOverlap,
  snapToPath,
  meters,
} from "../lib/routing.ts";
for (const [tags, feature] of [
  [{ highway: "crossing" }, "crossing"],
  [{ footway: "crossing" }, "crossing"],
  [{ path: "crossing" }, "crossing"],
  [{ pedestrian: "crossing" }, "crossing"],
  [{ "crossing:signals": "yes" }, "signal"],
  [{ crossing: "traffic_signals" }, "signal"],
  [{ barrier: "gate" }, "barrier"],
  [{ barrier: "kissing_gate" }, "barrier"],
  [{ barrier: "cycle_barrier" }, "barrier"],
  [{ barrier: "stile" }, "barrier"],
  [{ barrier: "turnstile" }, "barrier"],
  [{ barrier: "lift_gate" }, "barrier"],
  [{ railway: "crossing" }, "railway"],
  [{ railway: "level_crossing" }, "railway"],
  [{ railway: "tram_crossing" }, "railway"],
  [{ highway: "steps" }, "steps"],
])
  test(`recognizes running interruption ${JSON.stringify(tags)}`, () =>
    assert.equal(interruptions(tags)[feature], true));
test("bollards, ordinary paths and non-crossings do not imply stops", () => {
  for (const tags of [
    { barrier: "bollard" },
    { highway: "path" },
    { crossing: "no" },
  ])
    assert.ok(Object.values(interruptions(tags)).every((v) => !v));
});
function network(tags = {}, nodeTags = {}) {
  return [
    { type: "node", id: 1, lon: 11, lat: 48 },
    { type: "node", id: 2, lon: 11.001, lat: 48, tags: nodeTags },
    { type: "node", id: 3, lon: 11.002, lat: 48 },
    { type: "node", id: 4, lon: 11.001, lat: 48.0005 },
    {
      type: "way",
      id: 10,
      nodes: [1, 2, 3],
      tags: { highway: "footway", ...tags },
    },
    { type: "way", id: 11, nodes: [1, 4, 3], tags: { highway: "footway" } },
  ];
}
for (const [tags, nodeTags] of [
  [{}, { highway: "traffic_signals" }],
  [{}, { highway: "crossing" }],
  [{}, { barrier: "gate" }],
  [{}, { railway: "level_crossing" }],
  [{ highway: "steps" }, {}],
  [{ footway: "crossing", "crossing:signals": "yes" }, {}],
])
  test(`prefers continuous detour over ${JSON.stringify([tags, nodeTags])}`, () => {
    const g = graphFrom(network(tags, nodeTags));
    assert.deepEqual(shortest(g, 1, 3, new Set(), 10000), [1, 4, 3]);
  });
test("strict pass avoids interruptions but relaxed pass retains the only legal connection", () => {
  const g = graphFrom(
    network({}, { barrier: "gate" }).filter((e) => e.id !== 11),
  );
  assert.equal(shortest(g, 1, 3, new Set(), 10000, true), null);
  assert.deepEqual(shortest(g, 1, 3, new Set(), 10000), [1, 2, 3]);
});
test("crossing way cost is independent of geometry node subdivision", () => {
  const tags = { footway: "crossing", "crossing:signals": "yes" };
  const data = network(tags).filter((e) => e.id !== 11);
  const g = graphFrom(data);
  const original =
    g.get(1).edges[0].interruptionCost +
    g.get(2).edges.find((e) => e.to === 3).interruptionCost;
  assert.ok(Math.abs(original - 600) < 0.001);
  const snap = snapToPath(g, [11.0005, 48]);
  const path = shortest(g, 1, 3, new Set(), 10000);
  assert.ok(path.includes(snap.id));
  const cost = path
    .slice(1)
    .reduce(
      (sum, to, i) =>
        sum +
        (g.get(path[i]).edges.find((e) => e.to === to).interruptionCost || 0),
      0,
    );
  assert.ok(Math.abs(cost - original) < 0.001);
});
test("node and way markings do not charge the same signal twice", () => {
  const g = graphFrom(
    network(
      { footway: "crossing", "crossing:signals": "yes" },
      { highway: "traffic_signals" },
    ),
  );
  const first = g.get(1).edges.find((e) => e.to === 2),
    second = g.get(2).edges.find((e) => e.to === 3);
  assert.equal(first.signalCost + second.signalCost, 600);
  assert.equal(first.interruptionCost + second.interruptionCost, 0);
  const r = routeInfo(g, [1, 2, 3, 4, 1], 400, undefined);
  assert.equal(r.trafficLights, 1);
  assert.equal(r.crossings, 1);
});
test("splitting an approach retains gate penalty only at the gate", () => {
  const g = graphFrom(network({}, { barrier: "gate" }));
  const snap = snapToPath(g, [11.0005, 48]);
  assert.equal(
    g.get(1).edges.find((e) => e.to === snap.id).interruptionCost,
    0,
  );
  assert.equal(
    g.get(snap.id).edges.find((e) => e.to === 2).interruptionCost,
    180,
  );
});
test("start favors surface path over closer underground steps", () => {
  const data = network({ highway: "steps", layer: "-1" });
  const g = graphFrom(data);
  const snap = snapToPath(g, [11.001, 48]);
  assert.ok(snap.distance > 10 && snap.distance < 100);
  assert.ok(g.get(snap.id).edges.every((e) => e.startAllowed));
});
test("start still works when stairs are the only mapped access", () => {
  const g = graphFrom(network({ highway: "steps" }).filter((e) => e.id !== 11));
  const snap = snapToPath(g, [11.0005, 48]);
  assert.ok(snap.distance < 0.01);
});
test("reversing a loop is not a distinct alternative; different paths are", () => {
  const a = {
    coordinates: [
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
      [0, 0],
    ],
  };
  const b = { coordinates: [...a.coordinates].reverse() };
  const c = {
    coordinates: [
      [0, 0],
      [0, -0.01],
      [-0.01, -0.01],
      [0, 0],
    ],
  };
  assert.equal(routeOverlap(a, b), 1);
  assert.equal(routeOverlap(a, c), 0);
});
test("stairs are measured in meters and turns only at sharp junctions", () => {
  const g = graphFrom(network({ highway: "steps" }));
  assert.equal(g.get(1).edges.find((e) => e.to === 2).factor, 6 * 1.8);
  const r = routeInfo(g, [1, 2, 3, 4, 1], 400, undefined);
  assert.ok(Math.abs(r.steps - meters([11, 48], [11.002, 48])) < 0.01);
  assert.equal(r.sharpTurns, 0); // ordinary geometry bends are not decisions
});
