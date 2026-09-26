import { test } from "node:test";
import assert from "node:assert/strict";
import { GreenMask, reach } from "../lib/green.ts";
import { odeonsplatzCorridor } from "../lib/known-parks.ts";
import {
  clearGreenCache,
  fetchGreenAreas,
  overpassQuery,
  parseOverpass,
  stitch,
} from "../lib/overpass.ts";
import { planGreenLoops } from "../lib/planner.ts";
import { mappedParks, parkSource } from "../lib/park-source.ts";
import { ProviderError } from "../lib/errors.ts";
import {
  munichParks,
  odeonsplatz,
  englischerGartenSouth,
  englischerGartenNorth,
  inside,
} from "./support/munich.mjs";

const areas = parseOverpass(munichParks);
const inEG = (p) =>
  inside(p, englischerGartenSouth) || inside(p, englischerGartenNorth);

test("park source prefers mapped parks and uses the corridor on outage", async () => {
  const signal = new AbortController().signal;
  const offline = () => {
    throw Error("Overpass unavailable");
  };
  const local = await parkSource(offline)(odeonsplatz, 10000, signal);
  assert.equal(local.approximate, true);
  assert.ok(local.componentName.includes("Englischer Garten"));
  const remote = await mappedParks(async () => Response.json(munichParks))(
    odeonsplatz,
    10000,
    signal,
  );
  assert.equal(remote.approximate, false);
  assert.ok(remote.componentName.includes("Englischer Garten"));
  const preferred = await parkSource(async () => Response.json(munichParks))(
    odeonsplatz,
    10000,
    signal,
  );
  assert.equal(preferred.approximate, false);
  const outside = await parkSource(async () => Response.json({ elements: [] }))(
    [11.7, 48.2],
    10000,
    signal,
  );
  assert.equal(outside, null);
});

test("stitches multipolygon members, including reversed ways", () => {
  const rings = stitch([
    [
      [0, 0],
      [1, 0],
    ],
    [
      [1, 1],
      [1, 0],
    ],
    [
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    [
      [5, 5],
      [6, 6],
    ],
  ]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
  assert.deepEqual(rings[0][0], rings[0].at(-1));
});

test("parses parks, relations and lakes; rejects invalid park data", () => {
  assert.equal(areas.length, 8);
  assert.ok(areas.some((a) => a.hole && a.name === "Kleinhesseloher See"));
  assert.throws(() => parseOverpass({}), ProviderError);
  assert.throws(() => parseOverpass(null), ProviderError);
  const skipped = parseOverpass({
    elements: [
      // Huge protected areas include farmland and villages.
      {
        type: "way",
        tags: { leisure: "nature_reserve" },
        geometry: [
          { lat: 48, lon: 11 },
          { lat: 48, lon: 11.2 },
          { lat: 48.2, lon: 11.2 },
          { lat: 48, lon: 11 },
        ],
      },
      { type: "way", tags: {}, geometry: [{ lat: 99, lon: 11 }] },
      {
        type: "way",
        tags: {},
        geometry: [
          { lat: 48, lon: 11 },
          { lat: "x", lon: 11 },
        ],
      },
      { type: "relation", tags: {}, members: [{ type: "node" }] },
    ],
  });
  assert.deepEqual(skipped, []);
});

test("mask measures park share, names parks and removes lakes", () => {
  const mask = new GreenMask(odeonsplatz, reach(10000), areas);
  assert.ok(mask.componentName.includes("Englischer Garten"));
  assert.ok(mask.valueAt([11.595, 48.16]) === 1);
  assert.equal(mask.valueAt([11.594, 48.157]), 0, "lake is not runnable");
  assert.equal(mask.valueAt([11.577, 48.139]), 0, "Altstadt is not a park");
  assert.equal(mask.valueAt([20, 60]), 0, "outside the mask");
  const throughPark = mask.measure([
    [11.586, 48.147],
    [11.5895, 48.158],
    [11.586, 48.147],
  ]);
  assert.ok(throughPark.park > 0.9);
  assert.deepEqual(throughPark.parks, ["Englischer Garten"]);
  const city = mask.measure([
    [11.57, 48.135],
    [11.575, 48.135],
    [11.57, 48.135],
  ]);
  assert.equal(city.park, 0);
  assert.deepEqual(city.parks, []);
  assert.deepEqual(mask.measure([odeonsplatz, odeonsplatz]).park, 0);
});

test("Odeonsplatz offline corridor keeps waypoints inside the garden", () => {
  const fallback = odeonsplatzCorridor(odeonsplatz);
  assert.ok(fallback);
  assert.equal(odeonsplatzCorridor([11.7, 48.142]), null);
  const mask = new GreenMask(odeonsplatz, reach(10000), fallback, 0, true);
  assert.equal(mask.approximate, true);
  const plans = planGreenLoops(mask, odeonsplatz, 10000);
  assert.ok(plans.length >= 2);
  assert.ok(plans[0].waypoints.every(inEG));
});

test("planner sends 5, 10 and 15 km Odeonsplatz loops into Englischer Garten", () => {
  for (const km of [5, 10, 15]) {
    const target = km * 1000;
    const mask = new GreenMask(odeonsplatz, reach(target), areas);
    const plans = planGreenLoops(mask, odeonsplatz, target);
    assert.ok(plans.length >= 2, `${km} km: ${plans.length} plans`);
    assert.ok(plans[0].waypoints.every(inEG), `${km} km best plan`);
    assert.ok(Math.abs(plans[0].estimate - target) / target < 0.1);
    assert.ok(plans[0].green > 0.6);
  }
});

test("planner returns nothing without reachable green space", () => {
  const mask = new GreenMask(odeonsplatz, 3000, [
    {
      rings: [
        [
          [11.6, 48.2],
          [11.601, 48.2],
          [11.601, 48.201],
          [11.6, 48.2],
        ],
      ],
    },
  ]);
  assert.deepEqual(planGreenLoops(mask, odeonsplatz, 5000), []);
});

test("overpass query covers parks, woods and water around the start", () => {
  const q = overpassQuery(odeonsplatz, 4567.4);
  for (const part of [
    "leisure",
    "park",
    "forest",
    "wood",
    'natural"="water',
    "private",
    "out geom",
  ])
    assert.ok(q.includes(part), part);
  assert.match(q, /\(48\.\d{6},11\.\d{6},48\.\d{6},11\.\d{6}\)/);
  assert.ok(!q.includes("length()"));
  assert.equal(reach(10000), 10000 / 2.4 + 400);
  assert.equal(reach(100000), 8000);
});

test("park lookup tries a second mirror and caches the result", async () => {
  clearGreenCache();
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(String(url));
    assert.equal(init.method, "POST");
    assert.ok(String(init.body).startsWith("data="));
    return calls.length === 1
      ? new Response("busy", { status: 429 })
      : Response.json(munichParks);
  };
  const signal = new AbortController().signal;
  const first = await fetchGreenAreas(odeonsplatz, 4000, signal, fetcher, [
    "https://a.test/api/interpreter",
    "https://b.test/api/interpreter",
  ]);
  assert.equal(first.length, 8);
  const again = await fetchGreenAreas(odeonsplatz, 4000, signal, fetcher);
  assert.equal(again, first);
  assert.equal(calls.length, 2);
  // Each request's search radius and start must match the cached outline.
  const distinct = async () => {
    calls.push("distinct");
    return Response.json(munichParks);
  };
  await fetchGreenAreas(
    [odeonsplatz[0] + 0.0002, odeonsplatz[1]],
    4000,
    signal,
    distinct,
  );
  await fetchGreenAreas(odeonsplatz, 4001, signal, distinct);
  assert.equal(calls.length, 4);
  clearGreenCache();
  await assert.rejects(
    fetchGreenAreas(odeonsplatz, 4000, signal, async () =>
      Response.json({ nope: true }),
    ),
    ProviderError,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchGreenAreas(odeonsplatz, 4000, controller.signal, fetcher),
    { name: "AbortError" },
  );
});
