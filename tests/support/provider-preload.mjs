// Loaded only by test-server.mjs in its child process, never by the application.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
if (process.env.ROUTE_TEST_FIXTURES !== "1")
  throw Error("Test preload requires explicit opt-in");
const fixture = gunzipSync(
  readFileSync(new URL("../fixtures/munich-10km.json.gz", import.meta.url)),
);
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    return original(input, init);
  if (url.hostname === "overpass-api.de") {
    console.log("TEST_PROVIDER_OVERPASS");
    return new Response(fixture, {
      headers: { "Content-Type": "application/json" },
    });
  }
  throw Error(`Unexpected outbound test request: ${url.hostname}`);
};
