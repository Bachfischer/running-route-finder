import { test } from "node:test";
import assert from "node:assert/strict";
import {
  provider,
  jsonFetch,
  readTextBounded,
  createCooldown,
} from "../lib/providers.ts";
import { MapCapacityError, ProviderError } from "../lib/errors.ts";
import { streamResponse, routeRequest } from "./helpers.mjs";
test("configurable HTTPS providers", () => {
  process.env.TEST_PROVIDER = "https://example.com/api/";
  assert.equal(
    provider("TEST_PROVIDER", "https://fallback.test").hostname,
    "example.com",
  );
  delete process.env.TEST_PROVIDER;
  assert.equal(
    provider("TEST_PROVIDER", "https://fallback.test").hostname,
    "fallback.test",
  );
});
for (const url of ["http://example.com", "https://user:pass@example.com"])
  test(`rejects invalid provider ${url}`, () => {
    process.env.TEST_PROVIDER = url;
    try {
      assert.throws(
        () => provider("TEST_PROVIDER", "https://fallback.test"),
        ProviderError,
      );
    } finally {
      delete process.env.TEST_PROVIDER;
    }
  });
test("decodes multi-byte UTF-8 split between chunks", async () => {
  const bytes = new TextEncoder().encode("München 🏃");
  const { response } = streamResponse([...bytes].map((b) => Uint8Array.of(b)));
  assert.equal(await readTextBounded(response, 100), "München 🏃");
});
test("allows exactly the byte budget", async () => {
  assert.equal(await readTextBounded(new Response("12345"), 5), "12345");
});
test("rejects oversized declared Content-Length before consuming", async () => {
  await assert.rejects(
    readTextBounded(
      new Response("small", { headers: { "Content-Length": "999" } }),
      10,
    ),
    MapCapacityError,
  );
});
test("rejects streaming payload without Content-Length", async () => {
  await assert.rejects(
    readTextBounded(streamResponse(["123", "456"]).response, 5),
    MapCapacityError,
  );
});
test("cancels an oversized open stream", async () => {
  let cancelled = false;
  const r = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(12));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readTextBounded(r, 10), MapCapacityError);
  assert.ok(cancelled);
});
test("empty body reports provider error", async () => {
  await assert.rejects(readTextBounded(new Response(null), 10), ProviderError);
});
test("json fetch preserves supplied headers and identifies application", async () => {
  let init;
  const value = await jsonFetch(
    "https://example.com",
    { headers: { "X-Test": "yes" } },
    100,
    async (_, i) => {
      init = i;
      return Response.json({ ok: true });
    },
  );
  assert.deepEqual(value, { ok: true });
  assert.equal(init.headers.get("X-Test"), "yes");
  assert.match(init.headers.get("User-Agent"), /Loop/);
  assert.ok(init.signal);
});
for (const status of [429, 500, 503, 404])
  test(`HTTP ${status} maps to safe provider error`, async () => {
    await assert.rejects(
      jsonFetch(
        "https://example.com",
        {},
        100,
        async () => new Response("secret upstream body", { status }),
      ),
      (e) =>
        e instanceof ProviderError &&
        !e.message.includes("secret") &&
        e.status === (status === 429 ? 429 : 503),
    );
  });
for (const name of ["AbortError", "TimeoutError", "TypeError"])
  test(`${name} fetch errors become readable failures`, async () => {
    await assert.rejects(
      jsonFetch("https://example.com", {}, 100, async () => {
        const e = new Error("internal detail");
        e.name = name;
        throw e;
      }),
      (e) => e instanceof ProviderError && !e.message.includes("internal"),
    );
  });
test("malformed JSON rejected", async () => {
  await assert.rejects(
    jsonFetch("https://example.com", {}, 100, async () => new Response("{")),
    ProviderError,
  );
});
test("a rejected routing key gives an actionable error without exposing the key", async () => {
  await assert.rejects(
    jsonFetch(
      "https://example.com",
      { headers: { Authorization: "private-token" } },
      100,
      async () => new Response("unauthorized", { status: 401 }),
    ),
    (error) =>
      error instanceof ProviderError &&
      error.message.includes("ORS_API_KEY") &&
      !error.message.includes("private-token"),
  );
});
test("JSON size limit remains typed for adaptive retry", async () => {
  await assert.rejects(
    jsonFetch("https://example.com", {}, 5, async () => new Response("123456")),
    MapCapacityError,
  );
});
test("cooldown expires and is isolated by client and operation", () => {
  let t = 100;
  const limited = createCooldown(() => t),
    r = routeRequest();
  assert.equal(limited(r, "loop", 10), false);
  assert.equal(limited(r, "loop", 10), true);
  assert.equal(limited(r, "search", 10), false);
  assert.equal(limited(routeRequest(undefined, "other"), "loop", 10), false);
  t += 10;
  assert.equal(limited(r, "loop", 10), false);
});
test("cooldown map is bounded and expired entries are removed", () => {
  let t = 100;
  const limited = createCooldown(() => t);
  for (let i = 0; i < 1000; i++)
    assert.equal(limited(routeRequest(undefined, String(i)), "x", 10), false);
  assert.equal(limited(routeRequest(undefined, "new"), "x", 10), true);
  t = 111;
  assert.equal(limited(routeRequest(undefined, "new"), "x", 10), false);
});
