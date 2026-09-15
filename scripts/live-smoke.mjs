// Explicitly opt-in: one personal-use request, never run by ordinary unit CI.
import assert from "node:assert/strict";
import { searchLoops } from "../lib/route-search.ts";
const result = await searchLoops({
  lat: 48.142,
  lon: 11.577,
  distance: 10,
  direction: "N",
});
assert.ok(Math.abs(result.routes[0].distance - 10000) < 1500);
console.log(
  JSON.stringify({
    km: result.routes[0].distance / 1000,
    repeat: result.routes[0].repeat,
  }),
);
