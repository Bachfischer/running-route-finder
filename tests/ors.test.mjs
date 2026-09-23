import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, quality, searchOrs } from "../lib/ors.ts";
import { ProviderError } from "../lib/errors.ts";
import { createHandlers } from "../lib/http.ts";

const input = { lat: 48.142, lon: 11.577, distance: 10, direction: "N" };
const origin = [input.lon, input.lat];
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
    fetcher,
  );
  assert.ok(calls.length >= 1 && calls.length <= 4);
  assert.ok(
    calls[0].url.startsWith("https://api.heigit.org/openrouteservice/"),
  );
  assert.ok(!calls[0].url.includes("example-secret"));
  assert.equal(calls[0].init.headers.get("Authorization"), "example-secret");
  assert.deepEqual(calls[0].body.coordinates, [origin]);
  assert.equal(calls[0].body.options.round_trip.length, 10000);
  assert.deepEqual(calls[0].body.options.avoid_features, ["steps", "ferries"]);
  assert.deepEqual(calls[0].body.extra_info, ["green", "noise"]);
  assert.equal(result.source, "openrouteservice");
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
    async () =>
      ++calls === 1
        ? Response.json(sample(false, 15000))
        : new Response("busy", { status: 503 }),
  );
  assert.equal(calls, 2);
  assert.equal(found.routes.length, 1);
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
  assert.equal(result.source, "openrouteservice");
  assert.ok(Math.abs(result.routes[0].distance - 10000) < 1500);
  assert.deepEqual(
    result.routes[0].coordinates[0],
    result.routes[0].coordinates.at(-1),
  );
});
