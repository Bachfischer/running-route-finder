import assert from "node:assert/strict";
const base = new URL(process.argv[2]);
if (base.protocol !== "https:") throw Error("Use the deployed HTTPS app URL.");
const home = await fetch(base, { signal: AbortSignal.timeout(20000) });
assert.equal(home.status, 200);
assert.match(await home.text(), /Running route finder/i);
const search = await fetch(new URL("/api/search?q=48.142,11.577", base), {
  signal: AbortSignal.timeout(20000),
});
assert.equal(search.status, 200);
assert.equal((await search.json()).places[0].lat, 48.142);
const invalid = await fetch(new URL("/api/loops", base), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(20000),
});
assert.equal(invalid.status, 400);
console.log(
  "Deployed page and API smoke checks passed without external map requests.",
);
