// Compiled-server test: intercept only the ORS endpoint; never load production fixtures.
if (process.env.ROUTE_TEST_FIXTURES !== "1")
  throw Error("Test preload requires explicit opt-in");
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (["127.0.0.1", "localhost"].includes(url.hostname))
    return original(input, init);
  if (url.hostname === "api.heigit.org") {
    if (init.headers.get("Authorization") !== "test-only-key")
      throw Error("Missing test key");
    console.log("TEST_PROVIDER_ORS");
    const [lon, lat] = JSON.parse(init.body).coordinates[0];
    return Response.json({
      features: [
        {
          geometry: {
            coordinates: [
              [lon, lat],
              [lon + 0.03, lat + 0.03],
              [lon, lat],
            ],
          },
          properties: {
            summary: { distance: 10100 },
            extras: {
              green: { values: [[0, 2, 8]] },
              noise: { values: [[0, 2, 2]] },
            },
          },
        },
      ],
    });
  }
  throw Error(`Unexpected outbound test request: ${url.hostname}`);
};
