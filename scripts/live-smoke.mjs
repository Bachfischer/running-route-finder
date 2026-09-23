// Explicitly opt-in: one personal-use request, never run by ordinary unit CI.
import assert from "node:assert/strict";
import { searchLoops } from "../lib/route-search.ts";
import { searchOrs } from "../lib/ors.ts";
const input = {
  lat: 48.142,
  lon: 11.577,
  distance: 10,
  direction: "N",
};
const result = process.env.ORS_API_KEY
  ? await searchOrs(
      input,
      process.env.ORS_API_KEY,
      new AbortController().signal,
    )
  : await searchLoops(input);
assert.ok(Math.abs(result.routes[0].distance - 10000) < 1500);
console.log(
  JSON.stringify({
    km: result.routes[0].distance / 1000,
    repeat: result.routes[0].repeat,
  }),
);
