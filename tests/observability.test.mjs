import { test } from "node:test";
import assert from "node:assert/strict";
import { observed } from "../lib/observability.ts";
test("request correlation records only safe operational metadata", async () => {
  let event,
    time = 100;
  const handler = observed(
    "location",
    async () => {
      time = 125;
      return Response.json({});
    },
    (v) => {
      event = v;
    },
    () => time,
  );
  const response = await handler(
    new Request("https://app.test/api/search?q=private-address", {
      headers: { "x-real-ip": "192.0.2.1" },
    }),
  );
  assert.deepEqual(Object.keys(event).sort(), [
    "durationMs",
    "operation",
    "requestId",
    "status",
  ]);
  assert.equal(event.durationMs, 25);
  assert.equal(event.operation, "location");
  assert.equal(event.status, 200);
  assert.equal(response.headers.get("x-request-id"), event.requestId);
  assert.ok(!JSON.stringify(event).includes("private-address"));
});
test("unexpected exceptions are sanitized and correlated", async () => {
  const response = await observed(
    "loops",
    async () => {
      throw Error("private secret");
    },
    () => {},
  )(new Request("https://app.test"));
  assert.equal(response.status, 500);
  assert.ok(response.headers.has("x-request-id"));
  assert.ok(!(await response.text()).includes("private secret"));
});
test("broken telemetry does not fail a successful response", async () => {
  assert.equal(
    (
      await observed(
        "loops",
        async () => Response.json({}),
        () => {
          throw Error("offline");
        },
      )(new Request("https://app.test"))
    ).status,
    200,
  );
});
