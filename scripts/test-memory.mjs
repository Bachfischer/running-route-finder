// A constrained Node heap regression, not a claim about exact workerd memory use.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { findLoops } from "../lib/routing.ts";
const data = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("../tests/fixtures/munich-10km.json.gz", import.meta.url),
    ),
  ).toString(),
);
const result = findLoops(data.elements, [11.577, 48.142], 10000, "N");
assert.ok(Math.abs(result.routes[0].distance - 10000) < 500);
console.log(
  "10 km real-map regression passed under the 96 MB V8 heap ceiling.",
);
