import { handlers } from "../../../lib/http.ts";
import { observed } from "../../../lib/observability.ts";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = observed("location", handlers.location);
