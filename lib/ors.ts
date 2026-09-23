import { ProviderError, ProviderTimeoutError, RouteError } from "./errors.ts";
import {
  compass,
  meters,
  type Coord,
  type Loop,
  type LoopResult,
} from "./routing.ts";
import type { RouteInput } from "./route-search.ts";
import { jsonFetch, type Fetcher } from "./providers.ts";

const endpoint =
  "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson";
// Separate seeds sample substantially different round trips in dense cities.
const seeds = [5, 17, 41, 101];
type Extra = { values?: unknown };
type Feature = {
  geometry?: { coordinates?: unknown };
  properties?: {
    summary?: { distance?: unknown };
    extras?: Record<string, Extra>;
  };
};

function bearing(start: Coord, point: Coord) {
  const x = (point[0] - start[0]) * Math.cos((start[1] * Math.PI) / 180);
  const y = point[1] - start[1];
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Share of measured polyline distance in qualifying ORS green/noise bands. */
export function quality(
  extra: Extra | undefined,
  coords: Coord[],
  good: (value: number) => boolean,
): number | null {
  if (!Array.isArray(extra?.values)) return null;
  let total = 0,
    selected = 0;
  for (const band of extra.values) {
    if (!Array.isArray(band) || band.length < 3) return null;
    const [from, to, value] = band;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to >= coords.length ||
      from >= to ||
      !Number.isFinite(value)
    )
      return null;
    for (let i = from + 1; i <= to; i++) {
      const length = meters(coords[i - 1], coords[i]);
      total += length;
      if (good(value)) selected += length;
    }
  }
  return total > 0 ? selected / total : null;
}

export function parseRoute(
  raw: unknown,
  start: Coord,
  target: number,
  requested: number | undefined,
) {
  const feature = (raw as { features?: Feature[] } | null)?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  const distance = feature?.properties?.summary?.distance;
  if (
    !Array.isArray(coords) ||
    coords.length < 3 ||
    coords.length > 20000 ||
    !Number.isFinite(distance) ||
    (distance as number) <= 0 ||
    !coords.every(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 85,
    )
  )
    throw new ProviderError("The routing service returned an invalid route.");
  const coordinates: Coord[] = coords.map((p) => [p[0], p[1]]);
  const end = coordinates.at(-1)!;
  if (meters(coordinates[0], start) > 250 || meters(end, coordinates[0]) > 150)
    throw new ProviderError(
      "The routing service did not return a closed loop.",
    );
  // Close the displayed/GPX geometry exactly; avoid a short artificial line.
  coordinates[coordinates.length - 1] = coordinates[0];
  const farthest = coordinates.reduce(
    (best, p) => (meters(start, p) > meters(start, best) ? p : best),
    start,
  );
  const heading = bearing(start, farthest);
  const angle =
    requested === undefined
      ? 0
      : Math.abs(((heading - requested + 540) % 360) - 180);
  const extras = feature?.properties?.extras;
  const green = quality(extras?.green, coordinates, (v) => v >= 7);
  const quiet = quality(extras?.noise, coordinates, (v) => v <= 3);
  const route: Loop = {
    coordinates,
    distance: distance as number,
    bearing: heading,
    // Detailed crossing and repeated-edge statistics require the original OSM graph.
    repeat: 0,
    paths: 0,
    parks: 0,
    trafficLights: 0,
    crossings: 0,
    barriers: 0,
    railwayCrossings: 0,
    steps: 0,
    sharpTurns: 0,
    score:
      (Math.abs((distance as number) - target) / target) * 3 +
      (angle / 180) * 2 -
      (green ?? 0) * 0.8 -
      (quiet ?? 0) * 0.3,
  };
  return { route, green, quiet };
}

/** Four alternatives and at most one length correction; no Overpass download. */
export async function searchOrs(
  input: RouteInput,
  key: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<LoopResult> {
  if (!key.trim())
    throw new ProviderError(
      "Routing service key is missing. Configure ORS_API_KEY on the server.",
    );
  const start: Coord = [input.lon, input.lat];
  const target = input.distance * 1000;
  const requested = compass[input.direction];
  // ORS green/quiet preferences often yield a longer actual route than the
  // round-trip length hint. The correction below handles other areas.
  const requestedLength = Math.round(target * 0.5);
  const found: (ReturnType<typeof parseRoute> & { seed: number })[] = [];
  let lastTimeout: ProviderTimeoutError | undefined;
  const request = async (seed: number, length: number) => {
    signal.throwIfAborted();
    const data = await jsonFetch(
      endpoint,
      {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(18000)]),
        headers: {
          Authorization: key,
          "Content-Type": "application/json",
          Accept: "application/geo+json",
        },
        body: JSON.stringify({
          coordinates: [start],
          instructions: false,
          extra_info: ["green", "noise"],
          options: {
            round_trip: { length, points: 3, seed },
            avoid_features: ["steps", "ferries"],
            profile_params: {
              weightings: { green: 1, quiet: 1 },
            },
          },
        }),
      },
      2_000_000,
      fetcher,
    );
    return { ...parseRoute(data, start, target, requested), seed };
  };
  for (const seed of seeds) {
    try {
      found.push(await request(seed, requestedLength));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ProviderError && error.status === 429)
        throw new ProviderError(
          "Routing service quota reached. Please try again later.",
          429,
        );
      if (error instanceof ProviderTimeoutError && !found.length) {
        lastTimeout = error;
        continue;
      }
      if (error instanceof ProviderError && found.length) break;
      throw error;
    }
    if (
      found.at(-1)!.route.score < -0.5 &&
      Math.abs(found.at(-1)!.route.distance - target) / target < 0.08
    )
      break;
  }
  if (!found.length && lastTimeout) throw lastTimeout;
  if (!found.length)
    throw new RouteError(
      "NO_LOOP",
      "No walking loop found here. Try a nearby start.",
    );
  found.sort((a, b) => a.route.score - b.route.score);
  const best = found[0];
  if (Math.abs(best.route.distance - target) / target > 0.12) {
    const correction = Math.round(
      Math.min(
        target * 1.25,
        Math.max(
          target * 0.25,
          (requestedLength * target) / best.route.distance,
        ),
      ),
    );
    try {
      found.push(await request(best.seed, correction));
      found.sort((a, b) => a.route.score - b.route.score);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ProviderError && error.status === 429) throw error;
      // A valid route is preferable to failing a search after an optional correction.
    }
  }
  return {
    routes: found.map((r) => r.route),
    quality: found.map((r) => ({ green: r.green, quiet: r.quiet })),
    source: "openrouteservice",
    snapDistance: meters(start, found[0].route.coordinates[0]),
    candidates: found.length,
  };
}
