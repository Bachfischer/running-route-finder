import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandlers, failure } from "../lib/http.ts";
import { readTextBounded, jsonFetch } from "../lib/providers.ts";
import { searchLoops } from "../lib/route-search.ts";
import { routeRequest, result, grid } from "./helpers.mjs";
import { findLoops } from "../lib/routing.ts";

test("cross-origin requests cannot consume routing work", async () => {
  const handlers = createHandlers({
    search: async () => {
      throw Error("must not run");
    },
  });
  for (const headers of [
    { origin: "https://elsewhere.test" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    const req = routeRequest();
    for (const [k, v] of Object.entries(headers)) req.headers.set(k, v);
    assert.equal((await handlers.loops(req)).status, 403);
  }
});
test("same-origin JSON requests remain accepted", async () => {
  const req = routeRequest();
  req.headers.set("origin", "https://loop.test");
  assert.equal(
    (await createHandlers({ search: async () => result }).loops(req)).status,
    200,
  );
});
test("form submissions cannot start a route search", async () => {
  const req = routeRequest();
  req.headers.set("content-type", "text/plain");
  assert.equal((await createHandlers().loops(req)).status, 415);
});
test("aborted slow body stops reading and cancels the stream", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const pending = readTextBounded(response, 1500, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
});
test("pre-aborted body is rejected before reading", async () => {
  await assert.rejects(
    readTextBounded(new Response("{}"), 1500, AbortSignal.abort()),
    { name: "AbortError" },
  );
});
test("request cancellation reaches search dependencies", async () => {
  const controller = new AbortController();
  const original = routeRequest();
  const req = new Request(original, { signal: controller.signal });
  const handler = createHandlers({
    search: async (_, signal) => {
      controller.abort();
      signal.throwIfAborted();
      return result;
    },
  });
  assert.equal((await handler.loops(req)).status, 499);
});
test("cancelled route search makes no provider request", async () => {
  await assert.rejects(
    searchLoops(
      { lat: 48, lon: 11, distance: 10, direction: "N" },
      async () => {
        throw Error("must not load");
      },
      Date.now,
      AbortSignal.abort(),
    ),
    { name: "AbortError" },
  );
});
test("cancellation while loading prevents graph construction", async () => {
  const c = new AbortController();
  await assert.rejects(
    searchLoops(
      { lat: 48, lon: 11, distance: 10, direction: "N" },
      async (_, signal) => {
        c.abort();
        assert.ok(signal.aborted);
        return [];
      },
      Date.now,
      c.signal,
    ),
    { name: "AbortError" },
  );
});
test("timeout responses are safe and not cacheable", () => {
  const response = failure(
    new DOMException("internal timeout", "TimeoutError"),
  );
  assert.equal(response.status, 504);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("providers prohibit redirects and bypass implicit framework caching", async () => {
  await jsonFetch("https://provider.test", {}, 100, async (_, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    return Response.json({});
  });
});

test("expired CPU budget prevents graph work", () => {
  assert.throws(
    () => findLoops([], [11.58, 48.14], 10000, "N", 0),
    /timed out/,
  );
});
test("CPU budget is checked after graph construction", (t) => {
  let reads = 0;
  t.mock.method(Date, "now", () => (++reads === 1 ? 0 : 100));
  assert.throws(
    () => findLoops(grid(), [11.58, 48.14], 10000, "N", 50),
    /timed out/,
  );
});
test("CPU budget preserves a complete loop already discovered", (t) => {
  let reads = 0;
  t.mock.method(Date, "now", () => (++reads < 50 ? 0 : 100));
  const found = findLoops(grid(), [11.58, 48.14], 5000, "Any", 50);
  assert.ok(found.routes.length > 0);
  assert.ok(found.candidates < 96);
  assert.deepEqual(
    found.routes[0].coordinates[0],
    found.routes[0].coordinates.at(-1),
  );
});
