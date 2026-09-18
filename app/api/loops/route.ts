import { getCache } from "@vercel/functions";
import { createHandlers } from "../../../lib/http.ts";
import { cachedAreaLoader, memoryMapStore } from "../../../lib/map-cache.ts";
import { searchLoops } from "../../../lib/route-search.ts";

export const runtime = "nodejs";
export const maxDuration = 180;
const store =
  process.env.VERCEL === "1"
    ? getCache({ namespace: "bachfischer-running-routes-map-v1" })
    : memoryMapStore();
const load = cachedAreaLoader(store);
const handlers = createHandlers({
  search: (input) => searchLoops(input, load),
});
export const POST = handlers.loops;
