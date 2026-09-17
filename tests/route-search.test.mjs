import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchAreas,
  mapQuery,
  searchLoops,
  loadArea,
} from "../lib/route-search.ts";
import { MapCapacityError, ProviderError, RouteError } from "../lib/errors.ts";
import { meters } from "../lib/routing.ts";
import { grid } from "./helpers.mjs";
const input = { lat: 48.14, lon: 11.58, distance: 10, direction: "Any" };
const data = grid();
test("10 km areas are substantially smaller than the old 4.7 km radius and include start", () => {
  const areas = searchAreas(input);
  assert.equal(areas.length, 4);
  for (const a of areas) {
    assert.equal(a.radius, 2650);
    assert.ok(meters(a.center, [input.lon, input.lat]) < a.radius);
    assert.ok((a.radius * a.radius) / (4700 * 4700) < 0.33);
  }
});
for (const km of [2, 5, 10, 21.1, 25])
  test(`${km} km footprints contain start and stay bounded`, () => {
    for (const a of searchAreas({ ...input, distance: km })) {
      assert.ok(a.radius <= 6800);
      assert.ok(meters(a.center, [input.lon, input.lat]) < a.radius);
    }
  });
for (const direction of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"])
  test(`${direction} first footprint points in preferred direction`, () => {
    const a = searchAreas({ ...input, direction })[0];
    const x = a.center[0] - input.lon,
      y = a.center[1] - input.lat;
    if (direction.includes("N")) assert.ok(y > 0);
    if (direction.includes("S")) assert.ok(y < 0);
    if (direction.includes("E")) assert.ok(x > 0);
    if (direction.includes("W")) assert.ok(x < 0);
  });
test("query retains all access/barrier node tags and avoids duplicate ordinary nodes", () => {
  const q = mapQuery(searchAreas(input)[0]);
  for (const k of [
    "[barrier]",
    "[highway=traffic_signals]",
    "[crossing=traffic_signals]",
    '["crossing:signals"=yes]',
    "out geom",
    "park|garden|nature_reserve",
    "[access]",
    "[foot]",
    '["access:conditional"]',
    '["foot:conditional"]',
    ".restrictions out body",
    "(.nodes; - .restrictions;);out skel",
  ])
    assert.ok(q.includes(k));
  assert.ok(q.includes(".ways out body"));
});
test("regression: overlarge 10 km payload retries smaller area without shortening target", async () => {
  const calls = [];
  const found = await searchLoops(input, async (a) => {
    calls.push(a);
    if (calls.length === 1) throw new MapCapacityError();
    return data;
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].radius < calls[0].radius);
  assert.ok(Math.abs(found.routes[0].distance - 10000) < 1200);
  assert.deepEqual(
    found.routes[0].coordinates[0],
    found.routes[0].coordinates.at(-1),
  );
});
test("regression: graph element limit also triggers adaptive retry", async () => {
  let n = 0;
  const found = await searchLoops(input, async () =>
    ++n === 1 ? Array(130001).fill({ type: "node", id: 1 }) : data,
  );
  assert.equal(n, 2);
  assert.ok(found.routes[0].distance > 8800);
});
test("no loop in one area tries a different bearing", async () => {
  const seen = [];
  await searchLoops(input, async (a) => {
    seen.push(a);
    return seen.length === 1 ? [] : data;
  });
  assert.equal(seen.length, 2);
  assert.notDeepEqual(seen[0].center, seen[1].center);
});
test("total query count is bounded when every region exceeds limits", async () => {
  let n = 0;
  await assert.rejects(
    searchLoops(input, async () => {
      n++;
      throw new MapCapacityError();
    }),
    RouteError,
  );
  assert.ok(n <= 6);
});
test("provider throttling is not retried", async () => {
  let n = 0;
  await assert.rejects(
    searchLoops(input, async () => {
      n++;
      throw new ProviderError("busy", 429);
    }),
    ProviderError,
  );
  assert.equal(n, 1);
});
test("no-start error survives exhausted regions", async () => {
  await assert.rejects(
    searchLoops(input, async () => []),
    (e) => e.code === "NO_START",
  );
});
test("deadline stops further requests", async () => {
  let n = 0;
  await assert.rejects(
    searchLoops(
      input,
      async () => {
        n++;
        return [];
      },
      () => (n ? 200000 : 0),
    ),
    RouteError,
  );
  assert.equal(n, 1);
});
test("already-expired deadline makes no provider calls", async () => {
  let clock = 0;
  await assert.rejects(
    searchLoops(
      input,
      async () => {
        throw Error("must not call");
      },
      () => (clock++ ? 200000 : 0),
    ),
    ProviderError,
  );
});
test("loadArea sends bounded query and parses real element structure", async () => {
  let seen;
  const a = searchAreas(input)[0];
  const loaded = await loadArea(
    a,
    AbortSignal.timeout(1000),
    async (url, init) => {
      seen = { url, init };
      return Response.json({ elements: data });
    },
  );
  assert.equal(loaded.length, data.length);
  assert.equal(seen.init.method, "POST");
  assert.match(seen.init.body, /data=/);
  assert.equal(seen.url.protocol, "https:");
});
for (const payload of [
  null,
  {},
  { elements: "bad" },
  { elements: [null] },
  { elements: [{ type: "node", id: 1.5 }] },
  { elements: [], remark: "timeout" },
])
  test(`rejects malformed Overpass ${JSON.stringify(payload)}`, async () => {
    await assert.rejects(
      loadArea(searchAreas(input)[0], AbortSignal.timeout(1000), async () =>
        Response.json(payload),
      ),
      ProviderError,
    );
  });

test("later provider failure preserves a real route already found", async () => {
  const data = grid();
  for (const element of data)
    if (element.type === "node") element.tags = { barrier: "gate" };
  let calls = 0;
  const result = await searchLoops(
    { lat: 48.14, lon: 11.58, distance: 5, direction: "Any" },
    async () => {
      if (++calls === 1) return data;
      throw new ProviderError("busy", 429);
    },
  );
  assert.equal(calls, 2);
  assert.ok(result.routes.length > 0);
  assert.ok(result.routes[0].barriers > 0);
});
test("map query preserves unsignalled and railway crossing nodes", () => {
  const query = mapQuery({ center: [11.577, 48.142], radius: 2650 });
  assert.ok(query.includes("node.nodes[highway=crossing]"));
  assert.ok(query.includes("node.nodes[crossing]"));
  assert.ok(query.includes("node.nodes[railway]"));
});
