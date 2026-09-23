import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandlers, validRouteInput, failure } from "../lib/http.ts";
import { ProviderError, RouteError, MapCapacityError } from "../lib/errors.ts";
import { result, routeRequest } from "./helpers.mjs";
const valid = { lat: 48.14, lon: 11.58, distance: 10, direction: "N" };
const invalid = [
  null,
  [],
  {},
  { ...valid, lat: NaN },
  { ...valid, lon: Infinity },
  { ...valid, lat: 86 },
  { ...valid, lon: 181 },
  { ...valid, lat: "48" },
  { ...valid, distance: "10" },
  { ...valid, distance: 1.9 },
  { ...valid, distance: 25.1 },
  { ...valid, direction: "north" },
  { ...valid, direction: "__proto__" },
];
for (const [i, input] of invalid.entries())
  test(`rejects invalid input ${i}`, async () => {
    assert.equal(validRouteInput(input), false);
    const h = createHandlers({
      search: async () => {
        throw Error("must not run");
      },
    });
    assert.equal((await h.loops(routeRequest(input))).status, 400);
  });
for (const input of [
  { ...valid, lat: -85, lon: -180, distance: 2 },
  { ...valid, lat: 85, lon: 180, distance: 25 },
])
  test(`accepts inclusive bounds ${JSON.stringify(input)}`, () =>
    assert.ok(validRouteInput(input)));
test("success returns JSON with unmodified 10 km input and no-store", async () => {
  let seen;
  const h = createHandlers({
    search: async (input) => {
      seen = input;
      return result;
    },
  });
  const res = await h.loops(routeRequest(valid));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(seen, valid);
  assert.deepEqual(await res.json(), result);
});
for (const body of ["{", "x".repeat(1501), "null"])
  test(`rejects malformed/oversized body length ${body.length}`, async () => {
    const h = createHandlers();
    assert.equal(
      (
        await h.loops(
          new Request("https://test/api/loops", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          }),
        )
      ).status,
      400,
    );
  });
test("a visitor can immediately request another route", async () => {
  let calls = 0;
  const h = createHandlers({
    search: async () => {
      calls++;
      return result;
    },
  });
  assert.equal((await h.loops(routeRequest(valid, "one"))).status, 200);
  assert.equal((await h.loops(routeRequest(valid, "one"))).status, 200);
  assert.equal(calls, 2);
});
test("multiple devices can calculate independently while another route is running", async () => {
  const finish = [];
  const h = createHandlers({
    search: () =>
      new Promise((resolve, reject) => {
        finish.push({ resolve, reject });
      }),
  });
  const first = h.loops(routeRequest(valid, "device-one"));
  await new Promise((r) => setImmediate(r));
  const second = h.loops(routeRequest(valid, "device-two"));
  await new Promise((r) => setImmediate(r));
  const sameDevice = h.loops(routeRequest(valid, "device-one"));
  await new Promise((r) => setImmediate(r));
  assert.equal(finish.length, 3);
  finish[1].resolve(result);
  assert.equal((await second).status, 200);
  finish[2].resolve(result);
  assert.equal((await sameDevice).status, 200);
  finish[0].reject(new ProviderError("busy"));
  assert.equal((await first).status, 503);
  const third = h.loops(routeRequest(valid, "device-one"));
  await new Promise((r) => setImmediate(r));
  finish[3].reject(new RouteError("NO_LOOP", "No route"));
  assert.equal((await third).status, 422);
});
for (const [e, status] of [
  [new ProviderError("busy", 429), 429],
  [new RouteError("NO_LOOP", "No route"), 422],
  [new MapCapacityError(), 503],
  [new Error("private secret"), 500],
])
  test(`error mapping ${e.name}/${status}`, async () => {
    const h = createHandlers({
      search: async () => {
        throw e;
      },
    });
    const res = await h.loops(routeRequest());
    assert.equal(res.status, status);
    assert.ok(!(await res.text()).includes("private secret"));
  });
test("unexpected thrown value is sanitized", async () =>
  assert.equal(failure("secret").status, 500));
for (const query of ["", "ab", "x".repeat(201), "86,0", "0,181"])
  test(`location rejects invalid query ${query.slice(0, 10)}`, async () => {
    const h = createHandlers();
    const res = await h.location(
      new Request("https://test/api/search?q=" + encodeURIComponent(query)),
    );
    assert.equal(res.status, 400);
  });
test("coordinate search requires no external call", async () => {
  const h = createHandlers({
    fetcher: async () => {
      throw Error("must not fetch");
    },
  });
  const res = await h.location(
    new Request("https://test/api/search?q=48.14,11.58"),
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).places[0], {
    lat: 48.14,
    lon: 11.58,
    name: "48.14000, 11.58000",
  });
});
test("Photon results have validated coordinates, deduplicated labels and no-store", async () => {
  let seen;
  const h = createHandlers({
    fetcher: async (u) => {
      seen = u;
      return Response.json({
        features: [
          {
            geometry: { coordinates: [11.58, 48.14] },
            properties: { name: "Munich", city: "Munich", country: "Germany" },
          },
          { geometry: { coordinates: [200, 0] }, properties: {} },
          { geometry: { coordinates: [1, 2] }, properties: {} },
        ],
      });
    },
  });
  const res = await h.location(
    new Request("https://test/api/search?q=Munich%20%26%20park"),
  );
  assert.equal(seen.searchParams.get("q"), "Munich & park");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((await res.json()).places, [
    { lat: 48.14, lon: 11.58, name: "Munich, Germany" },
    { lat: 2, lon: 1, name: "Unnamed location" },
  ]);
});
test("Photon failure and invalid shape become explicit errors", async () => {
  for (const data of [null, {}, { features: null }]) {
    const h = createHandlers({ fetcher: async () => Response.json(data) });
    assert.equal(
      (await h.location(new Request("https://test/api/search?q=Munich")))
        .status,
      503,
    );
  }
});
test("no location matches is successful empty list", async () => {
  const h = createHandlers({
    fetcher: async () => Response.json({ features: [] }),
  });
  assert.deepEqual(
    await (
      await h.location(new Request("https://test/api/search?q=Nowhere"))
    ).json(),
    { places: [] },
  );
});
test("concurrent location searches do not block other devices", async () => {
  let calls = 0;
  const h = createHandlers({
    fetcher: async () => {
      calls++;
      return Response.json({ features: [] });
    },
  });
  const req = new Request("https://test/api/search?q=Munich");
  const [first, second] = await Promise.all([h.location(req), h.location(req)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls, 2);
});
