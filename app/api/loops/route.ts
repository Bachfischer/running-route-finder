import { getCache } from "@vercel/functions";
import { createHandlers } from "../../../lib/http.ts";
import { cachedAreaLoader, memoryMapStore } from "../../../lib/map-cache.ts";
import { searchLoops } from "../../../lib/route-search.ts";
import { searchOrs } from "../../../lib/ors.ts";
import { observed } from "../../../lib/observability.ts";

export const runtime = "nodejs";
export const maxDuration = 180;
const store =
  process.env.VERCEL === "1"
    ? getCache({
        namespace: "bachfischer-running-routes-map-v1",
        // Preserve the SHA-256 key instead of the SDK's default 32-bit hash.
        keyHashFunction: (key) => key,
      })
    : memoryMapStore();
const load = cachedAreaLoader(store);
const handlers = createHandlers({
  search: (input, signal) =>
    process.env.ORS_API_KEY
      ? searchOrs(input, process.env.ORS_API_KEY, signal)
      : searchLoops(input, load, Date.now, signal),
});
export const POST = observed("loops", handlers.loops);
