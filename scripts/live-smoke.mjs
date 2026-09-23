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
  direction: "N",
};
const result = await searchOrs(
  input,
  process.env.ORS_API_KEY,
  new AbortController().signal,
);
assert.ok(Math.abs(result.routes[0].distance - 10000) < 1500);
console.log(
  JSON.stringify({
    km: result.routes[0].distance / 1000,
    source: result.source,
    green: result.quality?.[0]?.green,
  }),
);
