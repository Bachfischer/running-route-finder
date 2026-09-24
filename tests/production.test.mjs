import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandlers, failure } from "../lib/http.ts";
import { readTextBounded, jsonFetch } from "../lib/providers.ts";
import { routeRequest, result } from "./helpers.mjs";

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
