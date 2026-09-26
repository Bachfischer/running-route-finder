import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, quality, searchOrs as runSearch } from "../lib/ors.ts";
import { mappedParks } from "../lib/park-source.ts";
import { ProviderError, ProviderTimeoutError } from "../lib/errors.ts";
import { createHandlers } from "../lib/http.ts";

// Routing tests inject the mapped source; the production-specific corridor has
// its own focused test and a compiled-server integration check.
const searchOrs = (input, key, signal, fetcher = fetch) =>
  runSearch(input, key, signal, fetcher, mappedParks(fetcher));
import { clearGreenCache } from "../lib/overpass.ts";

const input = { lat: 48.142, lon: 11.577, distance: 10 };
const origin = [input.lon, input.lat];
const isOverpass = (url) => String(url).includes("/interpreter");
// Round-trip fallback tests: the park service answers with no green space.
const noParks = (fetcher) => (url, init) => {
  if (isOverpass(url)) return Response.json({ elements: [] });
  return fetcher(url, init);
};
function sample(north = true, distance = 10100) {
  return {
    features: [
      {
        geometry: {
          coordinates: [
            origin,
            [11.577, 48.142 + (north ? 0.04 : -0.04)],
            [11.58, 48.143],
            origin,
          ],
        },
        properties: {
          summary: { distance },
          extras: {
            green: {
              values: [
                [0, 2, 9],
                [2, 3, 0],
              ],
            },
            noise: { values: [[0, 3, 1]] },
          },
        },
      },
    ],
  };
}
test("rejects missing secret without sending coordinates", async () => {
  await assert.rejects(
    searchOrs(input, " ", new AbortController().signal, () => {
      throw Error("network");
    }),
    /key is missing/,
  );
});
test("requests bounded green quiet foot loops and preserves secret in authorization only", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return Response.json(
      sample(calls.length === 1, calls.length > 1 ? 12000 : 10100),
    );
  };
  const result = await searchOrs(
    input,
    "example-secret",
    new AbortController().signal,
    noParks(fetcher),
  );
  assert.ok(calls.length >= 1 && calls.length <= 5);
  assert.ok(
    calls[0].url.startsWith("https://api.heigit.org/openrouteservice/"),
  );
  assert.ok(!calls[0].url.includes("example-secret"));
  assert.equal(calls[0].init.headers.get("Authorization"), "example-secret");
  assert.equal(calls[0].init.headers.get("Accept"), "application/geo+json");
  assert.deepEqual(calls[0].body.coordinates, [origin]);
  assert.equal(calls[0].body.options.round_trip.length, 5000);
  assert.equal(calls[0].body.options.round_trip.seed, 5);
  assert.deepEqual(calls[0].body.options.profile_params.weightings, {
    green: 1,
    quiet: 1,
  });
  assert.deepEqual(calls[0].body.options.avoid_features, ["steps", "ferries"]);
  assert.deepEqual(calls[0].body.extra_info, ["green", "noise", "waytype"]);
  assert.equal(result.routes[0].distance, 10100);
  assert.deepEqual(
    result.routes[0].coordinates[0],
    result.routes[0].coordinates.at(-1),
  );
  assert.ok(result.quality[0].green > 0 && result.quality[0].green < 1);
  assert.equal(result.quality[0].quiet, 1);
});
test("widely spaced seeds and one bounded correction improve an overshot loop", async () => {
  const calls = [];
  const result = await searchOrs(
    input,
    "test-key",
    new AbortController().signal,
    noParks(async (_url, init) => {
      const roundTrip = JSON.parse(init.body).options.round_trip;
      calls.push(roundTrip);
      return Response.json(sample(true, calls.length === 5 ? 10200 : 15000));
    }),
  );
  assert.deepEqual(
    calls.slice(0, 4).map((c) => c.seed),
    [5, 17, 41, 101],
  );
  assert.ok(calls[4].length < 5000);
  assert.equal(calls[4].seed, 5);
  assert.equal(result.routes[0].distance, 10200);
});
test("unknown provider statistics do not invent green coverage", () => {
  const raw = sample();
  delete raw.features[0].properties.extras;
  const result = parseRoute(raw, origin, 10000);
  assert.equal(result.quality.green, null);
  assert.equal(result.quality.quiet, null);
  assert.equal(result.quality.paths, null);
  assert.equal(result.quality.park, null);
});
for (const malformed of [
  null,
  {},
  { features: [] },
  {
    features: [
      {
        geometry: {
          coordinates: [
            [181, 0],
            [0, 0],
            [181, 0],
          ],
        },
        properties: { summary: { distance: 10000 } },
      },
    ],
  },
  sample(true, -1),
])
  test("rejects invalid routing geometry and distance", () =>
    assert.throws(() => parseRoute(malformed, origin, 10000), ProviderError));
test("rejects an open route", () => {
  const raw = sample();
  raw.features[0].geometry.coordinates[3] = [11.6, 48.15];
  assert.throws(() => parseRoute(raw, origin, 10000), /closed loop/);
});
test("validates extra segment bounds", () => {
  assert.equal(
    quality({ values: [[0, 99, 8]] }, [origin, origin], () => true),
    null,
  );
});
test("quota stops alternatives immediately", async () => {
  let calls = 0;
  await assert.rejects(
    searchOrs(
      input,
      "token",
      new AbortController().signal,
      noParks(async () => {
        calls++;
        return new Response("quota", { status: 429 });
      }),
    ),
    /quota reached/,
  );
  assert.equal(calls, 1);
});
test("a caller cancellation stops before the first request", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    searchOrs(input, "token", controller.signal, () => {
      throw Error("network");
    }),
    { name: "AbortError" },
  );
});
test("a later provider outage preserves an already valid candidate", async () => {
  let calls = 0;
  const found = await searchOrs(
    input,
    "token",
    new AbortController().signal,
    noParks(async () =>
      ++calls === 1
        ? Response.json(sample(false, 15000))
        : new Response("busy", { status: 503 }),
    ),
  );
  assert.equal(calls, 3);
  assert.equal(found.routes.length, 1);
});
test("a timed-out first seed tries another without extending past four attempts", async () => {
  let calls = 0;
  const result = await searchOrs(
    input,
    "test-key",
    new AbortController().signal,
    noParks(async () => {
      if (++calls === 1) throw new DOMException("slow", "TimeoutError");
      return Response.json(sample(true, 10100));
    }),
  );
  assert.equal(result.routes[0].distance, 10100);
  assert.ok(calls <= 4);
  assert.ok(calls >= 2);
});
test("four timed-out seeds fail with a useful timeout", async () => {
  let calls = 0;
  await assert.rejects(
    searchOrs(
      input,
      "test-key",
      new AbortController().signal,
      noParks(async () => {
        calls++;
        throw new DOMException("slow", "TimeoutError");
      }),
    ),
    ProviderTimeoutError,
  );
  assert.equal(calls, 4);
});
test("same-origin API returns a 10 km Munich GPX-ready loop via managed provider", async () => {
  const handlers = createHandlers({
    search: (route, signal) =>
      searchOrs(
        route,
        "test-key",
        signal,
        noParks(async () => Response.json(sample(true))),
      ),
  });
  const response = await handlers.loops(
    new Request("https://run.bachfischer.me/api/loops", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://run.bachfischer.me",
      },
      body: JSON.stringify(input),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(Math.abs(result.routes[0].distance - 10000) < 1500);
  assert.deepEqual(
    result.routes[0].coordinates[0],
    result.routes[0].coordinates.at(-1),
  );
});

// --- Park-first planning -------------------------------------------------
import {
  munichParks,
  odeonsplatz,
  englischerGartenSouth,
  englischerGartenNorth,
  inside,
  fakeDirections,
} from "./support/munich.mjs";

const inEnglischerGarten = (p) =>
  inside(p, englischerGartenSouth) || inside(p, englischerGartenNorth);
function munich(detour = 1.3, log = []) {
  return async (url, init) => {
    if (isOverpass(url)) {
      log.push({ overpass: String(url), body: String(init.body) });
      return Response.json(munichParks);
    }
    const body = JSON.parse(init.body);
    log.push(body);
    if (body.options.round_trip) return Response.json(sample(true, 10100));
    return Response.json(fakeDirections(body.coordinates, detour));
  };
}

test("10 km from Odeonsplatz runs through Englischer Garten, not the Altstadt", async () => {
  clearGreenCache();
  const log = [];
  const result = await searchOrs(
    input,
    "test-key",
    new AbortController().signal,
    munich(1.3, log),
  );
  const routed = log.filter((c) => c.coordinates);
  assert.equal(log.filter((c) => c.overpass).length, 1);
  assert.ok(routed.length >= 2 && routed.length <= 5);
  const best = routed[0];
  assert.deepEqual(best.coordinates[0], odeonsplatz);
  assert.deepEqual(best.coordinates.at(-1), odeonsplatz);
  assert.ok(best.coordinates.slice(1, -1).every(inEnglischerGarten));
  assert.deepEqual(best.options.avoid_features, ["steps", "ferries"]);
  assert.equal(best.radiuses.length, best.coordinates.length);
  assert.ok(result.quality[0].park > 0.6, JSON.stringify(result.quality[0]));
  assert.deepEqual(result.quality[0].parks.slice(0, 1), ["Englischer Garten"]);
  assert.ok(Math.abs(result.routes[0].distance - 10000) / 10000 < 0.1);
  assert.ok(result.quality[0].paths > 0.9);
  // No city round trip is needed when parks produce enough good loops.
  assert.ok(!routed.some((c) => c.options.round_trip));
});

test("park loops are length-calibrated with the observed detour", async () => {
  clearGreenCache();
  const log = [];
  const result = await searchOrs(
    input,
    "test-key",
    new AbortController().signal,
    munich(1.6, log),
  );
  const routed = log.filter((c) => c.coordinates);
  assert.ok(routed.length >= 4, `only ${routed.length} requests`);
  assert.ok(
    Math.abs(result.routes[0].distance - 10000) / 10000 < 0.1,
    String(result.routes[0].distance),
  );
  assert.ok(result.quality[0].park > 0.5);
});

test("park data outage falls back to ORS round trips", async () => {
  clearGreenCache();
  const log = [];
  const result = await searchOrs(
    { ...input, lat: 48.1421 },
    "test-key",
    new AbortController().signal,
    async (url, init) => {
      if (isOverpass(url)) {
        log.push("overpass");
        return new Response("busy", { status: 504 });
      }
      log.push(JSON.parse(init.body));
      return Response.json(sample(true, 10100));
    },
  );
  assert.equal(log.filter((c) => c === "overpass").length, 2);
  assert.ok(log.filter((c) => c !== "overpass")[0].options.round_trip);
  assert.equal(result.quality[0].park, null);
});

test("failed park routes fall back to round trips but surface quota errors", async () => {
  clearGreenCache();
  let trips = 0;
  const result = await searchOrs(
    input,
    "test-key",
    new AbortController().signal,
    async (url, init) => {
      if (isOverpass(url)) return Response.json(munichParks);
      const body = JSON.parse(init.body);
      if (!body.options.round_trip)
        return new Response("no point", { status: 404 });
      trips++;
      return Response.json(sample(true, 10100));
    },
  );
  assert.ok(trips >= 1);
  assert.ok(result.routes.length >= 1);
  clearGreenCache();
  await assert.rejects(
    searchOrs(input, "test-key", new AbortController().signal, async (url) =>
      isOverpass(url)
        ? Response.json(munichParks)
        : new Response("quota", { status: 429 }),
    ),
    /quota reached/,
  );
});

test("route score prefers park time over tree-lined streets", async () => {
  const { routeScore } = await import("../lib/ors.ts");
  const street = routeScore(10000, 10000, { green: 1, quiet: 0.5, park: 0.05 });
  const park = routeScore(10400, 10000, { green: 0.7, quiet: 0.8, park: 0.8 });
  assert.ok(park < street);
  const tooLong = routeScore(13500, 10000, { green: 1, quiet: 1, park: 1 });
  assert.ok(park < tooLong);
});
