import {
  createCooldown,
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
  search?: (input: RouteInput) => Promise<LoopResult>;
  now?: () => number;
};
export function createHandlers(deps: Dependencies = {}) {
  const cooldown = createCooldown(deps.now),
    fetcher = deps.fetcher || fetch,
    search = deps.search || searchLoops;
  let computing = false;
  return {
    async loops(req: Request) {
      let body: unknown;
      try {
        body = JSON.parse(await readTextBounded(new Response(req.body), 1500));
      } catch {
        return apiError("Invalid route request.", 400);
      }
      if (!validRouteInput(body))
        return apiError(
          "Choose valid coordinates, a distance from 2 to 25 km, and a compass direction.",
          400,
        );
      if (computing)
        return apiError(
          "Another route is being calculated. Please try again shortly.",
          429,
          5,
        );
      if (cooldown(req, "loops", 15000))
        return apiError(
          "Please wait 15 seconds before requesting another loop.",
          429,
          15,
        );
      computing = true;
      try {
        return Response.json(await search(body), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (e) {
        return failure(e);
      } finally {
        computing = false;
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
      if (cooldown(req, "search", 1200))
        return apiError("Please wait a moment before searching again.", 429, 2);
      try {
        const url = provider("PHOTON_URL", "https://photon.komoot.io/api/");
        url.searchParams.set("q", q);
        url.searchParams.set("limit", "5");
        const data = (await jsonFetch(url, {}, 500000, fetcher)) as {
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
                      [p.street, p.housenumber].filter(Boolean).join(" "),
                      p.city || p.town,
                      p.country,
                    ].filter((v) => typeof v === "string" && v.length > 0),
                  ),
                ].join(", ") || "Unnamed location",
            };
          });
        return Response.json(
          { places },
          { headers: { "Cache-Control": "private, max-age=86400" } },
        );
      } catch (e) {
        return failure(e);
      }
    },
  };
}
export const handlers = createHandlers();
