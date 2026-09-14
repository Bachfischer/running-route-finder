import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canWalk,
  graphFrom,
  shortest,
  Heap,
  meters,
  destination,
  findLoops,
} from "../lib/routing.ts";
import { MapCapacityError } from "../lib/errors.ts";
import { toGpx } from "../lib/gpx.ts";
import { grid } from "./helpers.mjs";
for (const highway of [
  "motorway",
  "trunk",
  "primary",
  "construction",
  "proposed",
  "cycleway",
])
  test(`excludes ${highway} by default`, () =>
    assert.equal(canWalk({ highway }), false));
for (const tags of [
  { foot: "no" },
  { foot: "private" },
  { access: "private" },
  { access: "no" },
  { area: "yes" },
  { construction: "yes" },
  { proposed: "yes" },
  { "foot:conditional": "yes @ (daylight)" },
  { "access:conditional": "no @ (night)" },
  { sac_scale: "alpine_hiking" },
])
  test(`excludes restricted path ${JSON.stringify(tags)}`, () =>
    assert.equal(canWalk({ highway: "path", ...tags }), false));
for (const foot of ["yes", "designated", "permissive", "official"])
  test(`explicit foot ${foot} overrides vehicle/general access`, () =>
    assert.ok(canWalk({ highway: "cycleway", access: "private", foot })));
for (const highway of [
  "footway",
  "path",
  "pedestrian",
  "living_street",
  "residential",
  "service",
  "track",
  "unclassified",
  "tertiary",
  "steps",
])
  test(`allows mapped ${highway}`, () => assert.ok(canWalk({ highway })));
test("secondary roads require pedestrian evidence", () => {
  assert.equal(canWalk({ highway: "secondary" }), false);
  assert.ok(canWalk({ highway: "secondary", sidewalk: "both" }));
  assert.ok(canWalk({ highway: "secondary", foot: "yes" }));
});
const nodes = [
  { type: "node", id: 1, lon: 11, lat: 48 },
  { type: "node", id: 2, lon: 11.01, lat: 48 },
  { type: "node", id: 3, lon: 11.02, lat: 48 },
];
function line(tags = {}, extra = []) {
  return [
    ...nodes.map((n) => ({ ...n })),
    ...extra,
    {
      type: "way",
      id: 10,
      nodes: [1, 2, 3],
      tags: { highway: "footway", ...tags },
    },
  ];
}
test("vehicle one-way does not restrict foot traffic", () => {
  const g = graphFrom(line({ oneway: "yes" }));
  assert.ok(g.get(2).edges.some((e) => e.to === 1));
});
for (const oneway of ["yes", "1", "-1"])
  test(`foot one-way ${oneway} excludes prohibited reverse edges`, () => {
    const g = graphFrom(line({ "oneway:foot": oneway }));
    const edges = [...g.values()].flatMap((n) => n.edges);
    assert.ok(edges.length > 0);
    if (oneway === "-1") assert.ok(g.get(2).edges.every((e) => e.to < 2));
    else assert.ok(g.get(1).edges.every((e) => e.to > 1));
  });
for (const tags of [
  { barrier: "wall" },
  { foot: "no" },
  { access: "private" },
  { "foot:conditional": "yes @ daylight" },
])
  test(`blocked node cannot be crossed ${JSON.stringify(tags)}`, () => {
    const data = line();
    data[1].tags = tags;
    const g = graphFrom(data);
    assert.ok(!g.has(2));
    assert.ok([...g.values()].every((n) => !n.edges.some((e) => e.to === 2)));
  });
test("foot permission permits a mapped gate", () => {
  const data = line();
  data[1].tags = { barrier: "gate", access: "private", foot: "yes" };
  const g = graphFrom(data);
  assert.ok(g.has(2));
});
test("missing nodes never produce an invented connecting edge", () => {
  const data = line().filter((n) => n.id !== 2);
  assert.equal(graphFrom(data).size, 0);
});
test("zero-length and duplicate way segments do not duplicate edges", () => {
  const data = line();
  data.push({ ...data.at(-1), id: 20 });
  const g = graphFrom(data);
  assert.equal(g.get(1).edges.length, 1);
  data[1].lon = 11;
  const zero = graphFrom(data);
  assert.ok(!zero.has(1));
});
test("invalid node coordinates and malformed node lists are ignored", () => {
  assert.equal(
    graphFrom([
      { type: "node", id: 1, lon: NaN, lat: 48 },
      { type: "way", id: 2, nodes: "bad", tags: { highway: "path" } },
    ]).size,
    0,
  );
});
test("priority queue agrees with sorted order on deterministic shuffled values", () => {
  const h = new Heap(),
    values = Array.from({ length: 1000 }, (_, i) => (i * 137) % 997);
  values.forEach((v, i) => h.push({ id: i, cost: v }));
  assert.deepEqual(
    values.map(() => h.pop().cost),
    [...values].sort((a, b) => a - b),
  );
});
test("A* finds connected path, respects cost bound and handles identical endpoints", () => {
  const g = graphFrom(line());
  assert.deepEqual(shortest(g, 1, 3, new Set(), 5000), [1, 2, 3]);
  assert.equal(shortest(g, 1, 3, new Set(), 10), null);
  assert.deepEqual(shortest(g, 1, 1, new Set(), 0), [1]);
});
test("used-edge penalty can prefer a longer unused path", () => {
  const g = graphFrom(grid({ size: 2 }));
  const start = 1,
    end = 3;
  const first = shortest(g, start, end, new Set(), 10000);
  const used = new Set(
    first
      .slice(1)
      .map((b, i) => `${Math.min(first[i], b)}:${Math.max(first[i], b)}`),
  );
  const alternate = shortest(g, start, end, used, 10000);
  assert.notDeepEqual(alternate, first);
});
for (const km of [2, 5, 10, 21.1, 25])
  test(`closed ${km} km loops retain coherent distance and score ordering`, () => {
    const result = findLoops(
      grid({ size: 22, spacing: km / 2500 }),
      [11.58, 48.14],
      km * 1000,
      "Any",
    );
    assert.ok(result.routes.length >= 1 && result.routes.length <= 3);
    for (const [i, r] of result.routes.entries()) {
      assert.deepEqual(r.coordinates[0], r.coordinates.at(-1));
      assert.ok(r.repeat <= 0.3);
      assert.ok(r.paths >= 0 && r.paths <= 1);
      assert.ok(Math.abs(r.distance - km * 1000) / (km * 1000) < 0.2);
      if (i) assert.ok(r.score >= result.routes[i - 1].score);
    }
  });
for (const start of [[181, 0], [0, 86], [NaN, 0], []])
  test(`invalid start ${JSON.stringify(start)}`, () =>
    assert.throws(
      () => findLoops([], start, 10000, "Any"),
      /Invalid starting/,
    ));
for (const target of [NaN, 1999, 25001])
  test(`invalid distance ${target}`, () =>
    assert.throws(() => findLoops([], [0, 0], target, "N"), /distance/));
test("invalid direction rejected and capacity guard is typed", () => {
  assert.throws(() => findLoops([], [0, 0], 10000, "__proto__"));
  assert.throws(
    () => findLoops(Array(130001).fill({}), [0, 0], 10000, "Any"),
    MapCapacityError,
  );
});
test("spherical distances handle symmetry, zero and dateline", () => {
  assert.equal(meters([1, 2], [1, 2]), 0);
  assert.equal(meters([1, 2], [3, 4]), meters([3, 4], [1, 2]));
  assert.ok(meters([179.99, 0], [-179.99, 0]) < 2300);
});
for (const bearing of [0, 45, 90, 180, 270])
  test(`destination ${bearing} preserves distance`, () =>
    assert.ok(
      Math.abs(
        meters([11, 48], destination([11, 48], 10000, bearing)) - 10000,
      ) < 0.001,
    ));
test("GPX preserves lon/lat order and exact displayed geometry", () => {
  const coords = [
    [11.5, 48.1],
    [11.6, 48.2],
    [11.5, 48.1],
  ];
  const gpx = toGpx(coords);
  assert.ok(gpx.includes('xmlns="http://www.topografix.com/GPX/1/1"'));
  assert.equal((gpx.match(/<trkpt /g) || []).length, 3);
  assert.ok(gpx.includes('lat="48.1" lon="11.5"'));
});
for (const coords of [
  [],
  [[0, 0]],
  [
    [181, 0],
    [0, 0],
  ],
  [
    [0, NaN],
    [0, 0],
  ],
])
  test(`GPX rejects invalid coordinates ${JSON.stringify(coords)}`, () =>
    assert.throws(() => toGpx(coords)));
