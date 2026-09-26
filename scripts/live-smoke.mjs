// Explicitly opt-in: one personal-use request, never run by ordinary unit CI.
import assert from "node:assert/strict";
import { searchOrs } from "../lib/ors.ts";
if (!process.env.ORS_API_KEY)
  throw new Error(
    "Set ORS_API_KEY in an uncommitted .env.local before the live provider test.",
  );
const input = {
  lat: 48.142,
  lon: 11.577,
  distance: 10,
};
const result = await searchOrs(
  input,
  process.env.ORS_API_KEY,
  new AbortController().signal,
);
const best = result.quality[0];
console.log(
  JSON.stringify({
    km: result.routes[0].distance / 1000,
    park: best.park,
    parks: best.parks,
    green: best.green,
    alternatives: result.routes.length,
  }),
);
assert.ok(Math.abs(result.routes[0].distance - 10000) < 1000);
// Acceptance: 10 km from Odeonsplatz goes through Englischer Garten.
assert.ok(
  best.parks?.includes("Englischer Garten"),
  "not via Englischer Garten",
);
assert.ok((best.park ?? 0) > 0.5, "less than half the loop in parks");
