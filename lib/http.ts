import {
  jsonFetch,
  provider,
  readTextBounded,
  type Fetcher,
} from "./providers.ts";
import { searchLoops, type RouteInput } from "./route-search.ts";
import { ProviderError, RouteError, MapCapacityError } from "./errors.ts";
import type { LoopResult } from "./routing.ts";
const directions = ["Any", "N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function validRouteInput(value: unknown): value is RouteInput {
  if (!value || typeof value !== "object") return false;
  const v = value as RouteInput;
  return (
    typeof v.lat === "number" &&
    typeof v.lon === "number" &&
    typeof v.distance === "number" &&
    [v.lat, v.lon, v.distance].every(Number.isFinite) &&
    Math.abs(v.lat) <= 85 &&
    Math.abs(v.lon) <= 180 &&
    v.distance >= 2 &&
    v.distance <= 25 &&
    directions.includes(v.direction)
  );
}
export function apiError(message: string, status: number, retry?: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(retry ? { "Retry-After": String(retry) } : {}),
      },
    },
  );
}
export function failure(e: unknown) {
  if (e instanceof Error && e.name === "AbortError")
    return apiError("The request was cancelled.", 499);
  if (e instanceof Error && e.name === "TimeoutError")
    return apiError("The request timed out. Please try again.", 504);
  if (e instanceof RouteError) return apiError(e.message, 422);
  if (e instanceof ProviderError)
    return apiError(e.message, e.status, e.status === 429 ? 60 : undefined);
  if (e instanceof MapCapacityError)
    return apiError(
      "The map service returned too much data. Please try again.",
      503,
    );
  return apiError("Could not complete the request. Please try again.", 500);
}
type Dependencies = {
  fetcher?: Fetcher;
  search?: (input: RouteInput, signal: AbortSignal) => Promise<LoopResult>;
};
export function createHandlers(deps: Dependencies = {}) {
  const fetcher = deps.fetcher || fetch,
    search =
      deps.search ||
      ((input, signal) => searchLoops(input, undefined, undefined, signal));
  return {
    async loops(req: Request) {
      const origin = req.headers.get("origin");
      if (
        req.headers.get("sec-fetch-site") === "cross-site" ||
        (origin && origin !== new URL(req.url).origin)
      )
        return apiError("Route requests must come from this website.", 403);
      const type = req.headers.get("content-type")?.split(";")[0].trim();
      if (type !== "application/json")
        return apiError("Send route requests as JSON.", 415);
      let body: unknown;
      try {
        body = JSON.parse(
          await readTextBounded(
            new Response(req.body, { headers: req.headers }),
            1500,
            AbortSignal.any([req.signal, AbortSignal.timeout(5000)]),
          ),
        );
      } catch (e) {
        if (
          e instanceof Error &&
          ["AbortError", "TimeoutError"].includes(e.name)
        )
          return failure(e);
        return apiError("Invalid route request.", 400);
      }
      if (!validRouteInput(body))
        return apiError(
          "Choose valid coordinates, a distance from 2 to 25 km, and a compass direction.",
          400,
        );
      try {
        req.signal.throwIfAborted();
        return Response.json(await search(body, req.signal), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (e) {
        return failure(e);
      }
    },
    async location(req: Request) {
      const q = new URL(req.url).searchParams.get("q")?.trim() || "";
      if (q.length < 3 || q.length > 200)
        return apiError("Enter a location between 3 and 200 characters.", 400);
      const match = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (match) {
        const lat = Number(match[1]),
          lon = Number(match[2]);
        if (Math.abs(lat) > 85 || Math.abs(lon) > 180)
          return apiError(
            "Use latitude −85 to 85 and longitude −180 to 180.",
            400,
          );
        return Response.json(
          {
            places: [
              { lat, lon, name: `${lat.toFixed(5)}, ${lon.toFixed(5)}` },
            ],
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      try {
        const url = provider("PHOTON_URL", "https://photon.komoot.io/api/");
        url.searchParams.set("q", q);
        url.searchParams.set("limit", "5");
        const data = (await jsonFetch(
          url,
          { signal: req.signal },
          500000,
          fetcher,
        )) as {
          features?: {
            geometry?: { coordinates?: number[] };
            properties?: Record<string, string>;
          }[];
        };
        if (!data || !Array.isArray(data.features))
          throw new ProviderError(
            "The location service returned invalid data.",
          );
        const places = data.features
          .filter(
            (f) =>
              Array.isArray(f?.geometry?.coordinates) &&
              f.geometry.coordinates.length >= 2 &&
              f.geometry.coordinates.slice(0, 2).every(Number.isFinite) &&
              Math.abs(f.geometry.coordinates[1]) <= 85 &&
              Math.abs(f.geometry.coordinates[0]) <= 180,
          )
          .slice(0, 5)
          .map((f) => {
            const p = f.properties || {};
            return {
              lon: f.geometry!.coordinates![0],
              lat: f.geometry!.coordinates![1],
              name:
                [
                  ...new Set(
                    [
                      p.name,
                      [p.street, p.housenumber]
                        .filter((v) => typeof v === "string")
                        .join(" "),
                      p.city || p.town,
                      p.country,
                    ].filter((v) => typeof v === "string" && v.length > 0),
                  ),
                ]
                  .join(", ")
                  .slice(0, 300) || "Unnamed location",
            };
          });
        return Response.json(
          { places },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (e) {
        return failure(e);
      }
    },
  };
}
export const handlers = createHandlers();
