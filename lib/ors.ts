import { ProviderError, ProviderTimeoutError } from "./errors.ts";
import {
  compass,
  meters,
  type Coord,
  type Loop,
  type LoopResult,
  type RouteInput,
} from "./route.ts";
import { jsonFetch, type Fetcher } from "./providers.ts";

const endpoint =
  "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson";
const parksEndpoint = "https://api.heigit.org/openpoiservice/v0/pois";
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
type ParkFeature = {
  geometry?: { type?: unknown; coordinates?: unknown };
  properties?: { osm_tags?: { name?: string } };
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
  // ORS calls this response field `waytypes` even though the request is `waytype`.
  const paths = quality(extras?.waytypes ?? extras?.waytype, coordinates, (v) =>
    [4, 5, 7].includes(v),
  );
  const relativeError = Math.abs((distance as number) - target) / target;
  const route: Loop = {
    coordinates,
    distance: distance as number,
    bearing: heading,
    // Prefer green routes with actual running paths. Allow modest length and
    // direction deviations rather than ranking a street loop first.
    score:
      relativeError * 0.5 +
      Math.max(0, relativeError - 0.15) * 8 +
      (angle / 180) * 0.25 -
      (green ?? 0) * 3 -
      (paths ?? 0) * 1.5 -
      (quiet ?? 0) * 0.7,
  };
  return { route, green, quiet, paths };
}

/** Find a park far enough away to spend the run there, rather than circling a tiny square. */
export async function findParks(
  start: Coord,
  target: number,
  requested: number | undefined,
  key: string,
  signal: AbortSignal,
  fetcher: Fetcher,
): Promise<Coord[]> {
  const radius = Math.min(1900, Math.max(700, target * 0.2));
  const heading = ((requested ?? 0) * Math.PI) / 180;
  const lookAhead = requested === undefined ? 0 : Math.min(1700, target * 0.17);
  const center: Coord = [
    start[0] +
      (Math.sin(heading) * lookAhead) /
        (111_200 * Math.cos((start[1] * Math.PI) / 180)),
    start[1] + (Math.cos(heading) * lookAhead) / 111_200,
  ];
  const data = await jsonFetch(
    parksEndpoint,
    {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request: "pois",
        geometry: {
          geojson: { type: "Point", coordinates: center },
          buffer: radius,
        },
        filters: { category_ids: [280] },
        limit: 50,
        sortby: "distance",
      }),
    },
    500_000,
    async (url, init) => {
      const response = await fetcher(url, init);
      console.info("park lookup HTTP", response.status);
      if (!response.ok)
        console.warn(
          "park lookup response",
          (await response.clone().text()).slice(0, 500),
        );
      return response;
    },
  );
  const features = (data as { features?: ParkFeature[] } | null)?.features;
  console.info(
    "park lookup result",
    Array.isArray(features) ? features.length : "invalid",
  );
  console.info(
    "park lookup sample",
    Array.isArray(features)
      ? features.slice(0, 5).map((f) => f.geometry)
      : null,
  );
  console.info(
    "park lookup names",
    Array.isArray(features)
      ? features.map((f) => [
          f.properties?.osm_tags?.name,
          f.geometry?.coordinates,
        ])
      : null,
  );
  if (!Array.isArray(features)) return [];
  const ranked = features
    .map((feature) => feature.geometry)
    .filter((geometry): geometry is { type: "Point"; coordinates: Coord } => {
      const p = geometry?.coordinates;
      return (
        geometry?.type === "Point" &&
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((v) => typeof v === "number" && Number.isFinite(v)) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 85
      );
    })
    .map((geometry) => geometry.coordinates)
    .filter(
      (p) =>
        meters(start, p) >= target * 0.12 && meters(start, p) <= target * 0.4,
    )
    .sort((a, b) => {
      const preference = (p: Coord) =>
        Math.abs(meters(start, p) - target * 0.3) +
        (requested === undefined
          ? 0
          : (Math.abs(((bearing(start, p) - requested + 540) % 360) - 180) /
              180) *
            target *
            0.06);
      return preference(a) - preference(b);
    });
  const distinct: Coord[] = [];
  for (const park of ranked) {
    if (distinct.every((other) => meters(park, other) > 650))
      distinct.push(park);
    if (distinct.length === 4) break;
  }
  return distinct;
}

function parkWaypoints(start: Coord, park: Coord, target: number): Coord[] {
  const angle = Math.atan2(
    (park[0] - start[0]) * Math.cos((start[1] * Math.PI) / 180),
    park[1] - start[1],
  );
  const reach = Math.min(
    1600,
    Math.max(650, (target - 2 * meters(start, park)) / 2),
  );
  const offset = (north: number, east: number): Coord => [
    park[0] + east / (111_200 * Math.cos((park[1] * Math.PI) / 180)),
    park[1] + north / 111_200,
  ];
  return [
    start,
    park,
    offset(Math.cos(angle) * reach, Math.sin(angle) * reach),
    start,
  ];
}

/** Four alternatives and at most one length correction. */
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
  const request = async (seed: number, length: number, park?: Coord) => {
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
          coordinates: park ? parkWaypoints(start, park, target) : [start],
          instructions: false,
          extra_info: ["green", "noise", "waytype"],
          options: {
            ...(park ? {} : { round_trip: { length, points: 3, seed } }),
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
  // Park waypoints actively take the route inside mapped green space. ORS's
  // green rating alone can label tree-lined city streets as highly green.
  let parks: Coord[] = [];
  try {
    parks = await findParks(start, target, requested, key, signal, fetcher);
  } catch (error) {
    signal.throwIfAborted();
    console.warn(
      "park lookup error",
      error instanceof ProviderError ? error.status : String(error),
    );
    if (error instanceof ProviderError && error.status === 429)
      throw new ProviderError(
        "Routing service quota reached. Please try again later.",
        429,
      );
  }
  for (const park of parks) {
    console.info("park waypoint selected", park);
    try {
      const candidate = await request(-1, 0, park);
      console.info("park route length", candidate.route.distance);
      if (Math.abs(candidate.route.distance - target) / target < 0.25)
        found.push({
          ...candidate,
          route: { ...candidate.route, score: candidate.route.score - 4 },
        });
      if (
        found.length &&
        Math.abs(candidate.route.distance - target) / target < 0.15
      )
        break;
    } catch (error) {
      signal.throwIfAborted();
      console.warn(
        "park route error",
        error instanceof ProviderError ? error.status : String(error),
      );
      if (error instanceof ProviderError && error.status === 429) throw error;
    }
  }
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
  }
  if (!found.length && lastTimeout) throw lastTimeout;
  if (!found.length)
    throw new ProviderError(
      "No walking loop found here. Try a nearby start.",
      422,
    );
  found.sort((a, b) => a.route.score - b.route.score);
  const best = found[0];
  if (
    best.seed !== -1 &&
    Math.abs(best.route.distance - target) / target > 0.12
  ) {
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
    snapDistance: meters(start, found[0].route.coordinates[0]),
  };
}
