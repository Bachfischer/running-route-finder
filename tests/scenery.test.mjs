import { test } from "node:test";
import assert from "node:assert/strict";
import {
  greenAreas,
  inGreenArea,
  inRing,
  isTrafficSignal,
} from "../lib/scenery.ts";
import { graphFrom, shortest } from "../lib/routing.ts";
const geometry = (points) => points.map(([lon, lat]) => ({ lat, lon }));
const square = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
  [0, 0],
];
const park = {
  type: "way",
  id: 100,
  tags: { leisure: "park" },
  geometry: geometry(square),
};
for (const point of [
  [1, 1],
  [0.5, 1.5],
])
  test(`point ${point} inside green area`, () =>
    assert.ok(inGreenArea(point, greenAreas([park]))));
for (const point of [
  [-1, 1],
  [3, 1],
  [1, 3],
  [1, -1],
])
  test(`point ${point} outside green area`, () =>
    assert.equal(inGreenArea(point, greenAreas([park])), false));
test("open outlines and empty geometries are not park polygons", () =>
  assert.deepEqual(
    greenAreas([
      { ...park, geometry: geometry(square.slice(0, 4)) },
      { ...park, geometry: undefined },
      { type: "node", id: 2, tags: { leisure: "park" } },
      { type: "way", id: 3 },
    ]),
    [],
  ));
test("multipolygon joins reversed outer pieces and excludes inner holes", () => {
  const area = {
    type: "relation",
    id: 1,
    tags: { leisure: "park" },
    members: [
      {
        role: "outer",
        geometry: geometry([
          [0, 0],
          [2, 0],
          [2, 2],
        ]),
      },
      {
        role: "outer",
        geometry: geometry([
          [0, 0],
          [0, 2],
          [2, 2],
        ]),
      },
      {
        role: "inner",
        geometry: geometry([
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
          [0.5, 0.5],
        ]),
      },
      { role: "outer" },
    ],
  };
  const areas = greenAreas([area]);
  assert.equal(areas.length, 1);
  assert.equal(inGreenArea([1, 1], areas), false);
  assert.equal(inGreenArea([0.25, 1], areas), true);
});
for (const tags of [
  { leisure: "garden" },
  { leisure: "nature_reserve" },
  { landuse: "forest" },
  { landuse: "recreation_ground" },
])
  test(`green classification ${JSON.stringify(tags)}`, () =>
    assert.equal(greenAreas([{ ...park, tags }]).length, 1));
test("invalid polygon coordinates are ignored", () =>
  assert.deepEqual(
    greenAreas([{ ...park, geometry: [{ lat: NaN, lon: 2 }] }]),
    [],
  ));
test("point in empty ring is false", () =>
  assert.equal(inRing([0, 0], []), false));
for (const tags of [
  { highway: "traffic_signals" },
  { crossing: "traffic_signals" },
  { "crossing:signals": "yes" },
])
  test(`recognizes signals ${JSON.stringify(tags)}`, () =>
    assert.ok(isTrafficSignal(tags)));
test("ordinary zebra crossing is not a signal", () =>
  assert.equal(isTrafficSignal({ crossing: "uncontrolled" }), false));
const network = [
  { type: "node", id: 1, lon: 0, lat: 0 },
  { type: "node", id: 2, lon: 0.001, lat: 0 },
  { type: "node", id: 3, lon: 0.002, lat: 0 },
  { type: "node", id: 4, lon: 0.001, lat: 0.0005 },
  { type: "way", id: 10, nodes: [1, 2, 3], tags: { highway: "footway" } },
  { type: "way", id: 11, nodes: [1, 4, 3], tags: { highway: "footway" } },
];
test("traffic signal cost selects a slightly longer unsignalled path", () => {
  const graph = graphFrom(
    network.map((e) =>
      e.id === 2 ? { ...e, tags: { highway: "traffic_signals" } } : e,
    ),
  );
  assert.deepEqual(shortest(graph, 1, 3, new Set(), 10000), [1, 4, 3]);
  assert.equal(graph.get(1).edges.find((e) => e.to === 2).signalCost, 180);
  assert.equal(graph.get(2).edges.find((e) => e.to === 1).signalCost, 0);
});
test("park route wins over a shorter street route", () => {
  const parkRoute = {
    ...park,
    geometry: geometry([
      [-0.001, 0.0001],
      [0.003, 0.0001],
      [0.003, 0.001],
      [-0.001, 0.001],
      [-0.001, 0.0001],
    ]),
  };
  const graph = graphFrom([...network, parkRoute]);
  assert.deepEqual(shortest(graph, 1, 3, new Set(), 10000), [1, 4, 3]);
  assert.equal(graph.get(1).edges.find((e) => e.to === 4).park, true);
  assert.equal(graph.get(1).edges.find((e) => e.to === 2).park, false);
});
