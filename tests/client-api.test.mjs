import { test } from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../lib/client-api.ts";

test("JSON transport forwards body and abort signal", async () => {
  const data = await requestJson(
    "/api/loops",
    { method: "POST", body: "{}" },
    100,
    async (_, init) => {
      assert.equal(init.method, "POST");
      assert.equal(init.body, "{}");
      assert.ok(init.signal);
      return Response.json({ routes: [] });
    },
  );
  assert.deepEqual(data, { routes: [] });
});
for (const body of [null, [], "bad"])
  test(`rejects invalid success envelope ${JSON.stringify(body)}`, async () => {
    await assert.rejects(
      requestJson("/api", {}, 100, async () => Response.json(body)),
      /invalid data/,
    );
  });
test("proxy HTML yields readable retry message", async () => {
  await assert.rejects(
    requestJson(
      "/api",
      {},
      100,
      async () => new Response("<h1>Gateway timeout</h1>", { status: 504 }),
    ),
    /incomplete response/,
  );
});
test("rate limiting exposes bounded Retry-After", async () => {
  await assert.rejects(
    requestJson("/api", {}, 100, async () =>
      Response.json(
        { error: "Busy." },
        { status: 429, headers: { "retry-after": "15" } },
      ),
    ),
    /Try again in 15 seconds/,
  );
});
for (const [body, status, message] of [
  [{}, 503, /unavailable/],
  [{ error: "Please retry" }, 422, /Please retry/],
])
  test(`API error ${status} stays readable`, async () => {
    await assert.rejects(
      requestJson("/api", {}, 100, async () => Response.json(body, { status })),
      message,
    );
  });
test("connection failure becomes actionable message", async () => {
  await assert.rejects(
    requestJson("/api", {}, 100, async () => {
      throw new TypeError("Failed to fetch");
    }),
    /Check your connection/,
  );
});
test("timeout releases transport even with a pending fetch", async () => {
  // Keep the test alive because AbortSignal.timeout intentionally unrefs its timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      requestJson(
        "/api",
        {},
        5,
        (_, { signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          ),
      ),
      /took too long/,
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
test("explicit cancellation is distinguishable from network errors", async () => {
  const controller = new AbortController();
  await assert.rejects(
    requestJson("/api", { signal: controller.signal }, 100, async () => {
      controller.abort();
      throw controller.signal.reason;
    }),
    { name: "AbortError" },
  );
});
