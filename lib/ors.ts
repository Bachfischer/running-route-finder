import { ProviderError, ProviderTimeoutError } from "./errors.ts";
import { type GreenMask } from "./green.ts";
import { parkSource, type ParkSource } from "./park-source.ts";
import { planGreenLoops, type Plan } from "./planner.ts";
import {
  meters,
  type Coord,
  type Loop,
  type LoopResult,
  type RouteInput,
} from "./route.ts";
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
export type Quality = {
  green: number | null;
  quiet: number | null;
  paths?: number | null;
  park?: number | null;
  parks?: string[];
  parkApproximate?: boolean;
};
type Found = { route: Loop; quality: Quality; plan?: Plan; seed?: number };

function bearing(start: Coord, point: Coord) {
  const x = (point[0] - start[0]) * Math.cos((start[1] * Math.PI) / 180);
  const y = point[1] - start[1];
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Share of measured polyline distance in qualifying ORS extra-info bands. */
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

/**
 * Rank a route. Time inside real parks dominates; ORS's street-level green,
 * path and quiet ratings break ties; length must stay close to the target.
 */
export function routeScore(distance: number, target: number, q: Quality) {
  const error = Math.abs(distance - target) / target;
  return (
    error * 2 +
    Math.max(0, error - 0.1) * 8 -
    (q.park ?? 0) * 3 -
    (q.green ?? 0) * 0.8 -
    (q.paths ?? 0) * 0.5 -
    (q.quiet ?? 0) * 0.3
  );
}

export function parseRoute(
  raw: unknown,
  start: Coord,
  target: number,
  mask?: GreenMask | null,
): { route: Loop; quality: Quality } {
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
  const extras = feature?.properties?.extras;
  const measured = mask?.measure(coordinates);
  const q: Quality = {
    green: quality(extras?.green, coordinates, (v) => v >= 7),
    quiet: quality(extras?.noise, coordinates, (v) => v <= 3),
    // ORS names this response field `waytypes`; the request uses `waytype`.
    paths: quality(extras?.waytypes ?? extras?.waytype, coordinates, (v) =>
      [4, 5, 7].includes(v),
    ),
    park: measured ? measured.park : null,
    parks: measured?.parks ?? [],
    parkApproximate: mask?.approximate ?? false,
  };
  return {
    route: {
      coordinates,
      distance: distance as number,
      bearing: bearing(start, farthest),
      score: routeScore(distance as number, target, q),
    },
    quality: q,
  };
}

function quotaError() {
  return new ProviderError(
    "Routing service quota reached. Please try again later.",
    429,
  );
}

/**
 * Park-first loop search.
 *
 * 1. Load mapped parks, woods and lakes around the start (OpenStreetMap).
 * 2. Pick 2–3 waypoints deep inside the largest reachable parks so the loop
 *    matches the target length (see planner.ts) and route them with ORS.
 * 3. Calibrate the length once with the observed detour factor.
 * 4. Where no park data or plan exists, fall back to seeded ORS round trips.
 * Routes are ranked by measured share inside parks, then ORS ratings.
 */
export async function searchOrs(
  input: RouteInput,
  key: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  loadParks: ParkSource = parkSource(fetcher),
): Promise<LoopResult> {
  if (!key.trim())
    throw new ProviderError(
      "Routing service key is missing. Configure ORS_API_KEY on the server.",
    );
  const start: Coord = [input.lon, input.lat];
  const target = input.distance * 1000;
  signal.throwIfAborted();
  let mask: GreenMask | null = null;
  try {
    mask = await loadParks(start, target, signal);
  } catch (error) {
    // ORS can still find a loop if public park data is unavailable.
    signal.throwIfAborted();
    console.warn(
      "park data unavailable",
      error instanceof ProviderError
        ? error.status
        : error instanceof Error
          ? error.name
          : "unknown",
    );
  }

  const post = (body: object) =>
    jsonFetch(
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
          instructions: false,
          extra_info: ["green", "noise", "waytype"],
          ...body,
        }),
      },
      2_000_000,
      fetcher,
    );
  const routePlan = async (plan: Plan): Promise<Found> => {
    signal.throwIfAborted();
    const coordinates = [start, ...plan.waypoints, start];
    const data = await post({
      coordinates,
      // Waypoints sit inside parks; allow snapping to the nearest park path.
      radiuses: coordinates.map((_, i) =>
        i === 0 || i === coordinates.length - 1 ? 350 : 600,
      ),
      options: {
        avoid_features: ["steps", "ferries"],
        profile_params: { weightings: { green: 0.5, quiet: 0.5 } },
      },
    });
    return { ...parseRoute(data, start, target, mask), plan };
  };
  const roundTrip = async (seed: number, length: number): Promise<Found> => {
    signal.throwIfAborted();
    const data = await post({
      coordinates: [start],
      options: {
        round_trip: { length, points: 3, seed },
        avoid_features: ["steps", "ferries"],
        profile_params: { weightings: { green: 1, quiet: 1 } },
      },
    });
    return { ...parseRoute(data, start, target, mask), seed };
  };

  const found: Found[] = [];
  const requested: Coord[][] = [];
  const tryPlans = async (plans: Plan[]) => {
    requested.push(...plans.map((p) => p.waypoints));
    const settled = await Promise.allSettled(plans.map(routePlan));
    signal.throwIfAborted();
    for (const s of settled) {
      if (s.status === "fulfilled") found.push(s.value);
      else if (s.reason instanceof ProviderError && s.reason.status === 429)
        throw quotaError();
      else
        console.warn(
          "park route unavailable",
          s.reason instanceof ProviderError
            ? s.reason.status
            : s.reason instanceof Error
              ? s.reason.name
              : "unknown",
        );
    }
  };
  const accurate = (f: Found) =>
    Math.abs(f.route.distance - target) / target <= 0.07;
  const best = () =>
    [...found].sort((a, b) => a.route.score - b.route.score)[0] as
      Found | undefined;

  if (mask) {
    await tryPlans(planGreenLoops(mask, start, target, { count: 3 }));
    // Up to two calibration passes using the detour factor ORS actually took.
    for (let pass = 0; pass < 2; pass++) {
      const top = best();
      if (!top?.plan || accurate(top)) break;
      const detour = Math.min(
        2.2,
        Math.max(1.05, top.route.distance / top.plan.straight),
      );
      const next = planGreenLoops(mask, start, target, {
        detour,
        count: 4,
      }).find(
        (p) =>
          !requested.some(
            (r) =>
              r.length === p.waypoints.length &&
              r.every((c, i) => meters(c, p.waypoints[i]) < 60),
          ),
      );
      if (!next) break;
      await tryPlans([next]);
    }
  }

  // Fallback / extra variety: seeded ORS round trips.
  const parkRoutes = found.filter((f) => f.plan).length;
  if (parkRoutes < 2) {
    // ORS green/quiet preferences often yield a longer actual route than the
    // round-trip length hint. The correction below handles other areas.
    const requestedLength = Math.round(target * 0.5);
    const maxSeeds = parkRoutes ? 1 : seeds.length;
    let lastTimeout: ProviderTimeoutError | undefined;
    let trips = 0;
    for (const seed of seeds.slice(0, maxSeeds)) {
      try {
        found.push(await roundTrip(seed, requestedLength));
        trips++;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ProviderError && error.status === 429)
          throw quotaError();
        if (error instanceof ProviderTimeoutError && !found.length) {
          lastTimeout = error;
          continue;
        }
        if (error instanceof ProviderError && found.length) break;
        throw error;
      }
      const last = found.at(-1)!;
      if (!parkRoutes && last.route.score < -0.5 && accurate(last)) break;
    }
    if (!found.length && lastTimeout) throw lastTimeout;
    const top = best();
    if (
      trips &&
      top?.seed !== undefined &&
      Math.abs(top.route.distance - target) / target > 0.12
    ) {
      const correction = Math.round(
        Math.min(
          target * 1.25,
          Math.max(
            target * 0.25,
            (requestedLength * target) / top.route.distance,
          ),
        ),
      );
      try {
        found.push(await roundTrip(top.seed, correction));
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ProviderError && error.status === 429) throw error;
        // A valid route is preferable to failing after an optional correction.
      }
    }
  }
  if (!found.length)
    throw new ProviderError(
      "No walking loop found here. Try a nearby start.",
      422,
    );
  found.sort((a, b) => a.route.score - b.route.score);
  const routes = found.slice(0, 5);
  return {
    routes: routes.map((r) => r.route),
    quality: routes.map((r) => r.quality),
    snapDistance: meters(start, routes[0].route.coordinates[0]),
  };
}
