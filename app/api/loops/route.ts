import { createHandlers } from "../../../lib/http.ts";
import { searchOrs } from "../../../lib/ors.ts";
import { observed } from "../../../lib/observability.ts";

export const runtime = "nodejs";
export const maxDuration = 180;
const handlers = createHandlers({
  search: (input, signal) =>
    searchOrs(input, process.env.ORS_API_KEY || "", signal),
});
export const POST = observed("loops", handlers.loops);
