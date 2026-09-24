import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, quality, searchOrs } from "../lib/ors.ts";
import { ProviderError, ProviderTimeoutError } from "../lib/errors.ts";
import { createHandlers } from "../lib/http.ts";

const input = { lat: 48.142, lon: 11.577, distance: 10, direction: "N" };
const origin = [input.lon, input.lat];
const noParks = (fetcher) => (url, init) =>
  String(url).includes("openpoiservice")
    ? Response.json({ type: "FeatureCollection", features: [] })
    : fetcher(url, init);
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
  assert.equal(calls.length, 4);
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
test("direction ranks a northern loop ahead of an equally distant southern loop", () => {
  const north = parseRoute(sample(true), origin, 10000, 0);
  const south = parseRoute(sample(false), origin, 10000, 0);
  assert.ok(north.route.score < south.route.score);
});
test("Odeonsplatz favors park paths over a shorter street loop", async () => {
  const street = sample(false, 10000);
  street.features[0].properties.extras.green.values = [[0, 3, 2]];
  street.features[0].properties.extras.noise.values = [[0, 3, 8]];
  street.features[0].properties.extras.waytypes = { values: [[0, 3, 3]] };
  const park = sample(true, 11200);
  park.features[0].properties.extras.green.values = [[0, 3, 9]];
  park.features[0].properties.extras.noise.values = [[0, 3, 1]];
  park.features[0].properties.extras.waytypes = { values: [[0, 3, 4]] };
  let calls = 0;
  const result = await searchOrs(
    { ...input, direction: "S" },
    "test-key",
    new AbortController().signal,
    noParks(async () => Response.json(++calls === 2 ? park : street)),
  );
  assert.equal(calls, 4);
  assert.equal(result.routes[0].distance, 11200);
  assert.equal(result.quality[0].green, 1);
  assert.equal(result.quality[0].quiet, 1);
});
test("Odeonsplatz generates a route through a nearby mapped park", async () => {
  const park = [11.586, 48.16];
  const calls = [];
  const route = sample(true, 10500);
  const result = await searchOrs(
    input,
    "test-key",
    new AbortController().signal,
    async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), body });
      return Response.json(
        String(url).includes("openpoiservice")
          ? { features: [{ geometry: { type: "Point", coordinates: park } }] }
          : route,
      );
    },
  );
  assert.equal(calls[0].body.filters.category_ids[0], 280);
  assert.ok(calls[0].body.geometry.buffer <= 1900);
  assert.ok(calls[0].body.geometry.geojson.coordinates[1] > origin[1]);
  assert.equal(calls[1].body.options.round_trip, undefined);
  assert.equal(calls[1].body.options.profile_params, undefined);
  assert.equal(calls[1].body.coordinates.length, 4);
  assert.deepEqual(calls[1].body.coordinates[0], origin);
  assert.deepEqual(calls[1].body.coordinates.at(-1), origin);
  assert.ok(calls[1].body.coordinates[2][1] > park[1]);
  assert.equal(result.routes[0].distance, 10500);
});
test("park paths remain useful when green and noise data are unavailable", () => {
  const street = sample(true);
  const path = sample(true, 10900);
  delete street.features[0].properties.extras.green;
  delete street.features[0].properties.extras.noise;
  delete path.features[0].properties.extras.green;
  delete path.features[0].properties.extras.noise;
  street.features[0].properties.extras.waytypes = { values: [[0, 3, 3]] };
  path.features[0].properties.extras.waytypes = { values: [[0, 3, 7]] };
  assert.ok(
    parseRoute(path, origin, 10000, undefined).route.score <
      parseRoute(street, origin, 10000, undefined).route.score,
  );
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
  const result = parseRoute(raw, origin, 10000, 0);
  assert.equal(result.green, null);
  assert.equal(result.quiet, null);
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
    assert.throws(
      () => parseRoute(malformed, origin, 10000, 0),
      ProviderError,
    ));
test("rejects an open route", () => {
  const raw = sample();
  raw.features[0].geometry.coordinates[3] = [11.6, 48.15];
  assert.throws(() => parseRoute(raw, origin, 10000, 0), /closed loop/);
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
    searchOrs(input, "token", new AbortController().signal, async () => {
      calls++;
      return new Response("quota", { status: 429 });
    }),
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
      searchOrs(route, "test-key", signal, async () =>
        Response.json(sample(true)),
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
