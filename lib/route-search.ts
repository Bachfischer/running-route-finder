import {
  compass,
  destination,
  findLoops,
  type Coord,
  type LoopResult,
  type OSMElement,
} from "./routing.ts";
import {
  MapCapacityError,
  ProviderError,
  ProviderConnectionError,
  RouteError,
} from "./errors.ts";
import { jsonFetch, provider, type Fetcher } from "./providers.ts";
export type RouteInput = {
  lat: number;
  lon: number;
  distance: number;
  direction: string;
};
export type SearchArea = { center: Coord; radius: number };
export function searchAreas(input: RouteInput): SearchArea[] {
  const target = input.distance * 1000;
  const bearing = compass[input.direction];
  const directions =
    bearing === undefined
      ? [0, 90, 180, 270]
      : [bearing, bearing - 55, bearing + 55, bearing + 180];
  // Offset circles include the start and enough perimeter for a loop. Unlike a
  // 4.7 km all-direction query, a 10 km request begins with a 2.65 km circle.
  return directions.map((b) => ({
    center: destination([input.lon, input.lat], target * 0.11, b),
    radius: Math.min(6800, Math.max(950, target * 0.24 + 250)),
  }));
}
export function mapQuery(area: SearchArea): string {
  const [lon, lat] = area.center;
  return `[out:json][timeout:35][maxsize:67108864];way(around:${Math.round(area.radius)},${lat.toFixed(6)},${lon.toFixed(6)})[highway~"^(footway|path|pedestrian|living_street|residential|service|track|unclassified|tertiary|tertiary_link|secondary|secondary_link|steps|cycleway)$"][area!=yes]->.ways;
.ways out body qt;
node(w.ways)->.nodes;
(node.nodes[highway=traffic_signals];node.nodes[highway=crossing];node.nodes[crossing];node.nodes[railway];node.nodes[crossing=traffic_signals];node.nodes["crossing:signals"=yes];node.nodes[barrier];node.nodes[access];node.nodes[foot];node.nodes["access:conditional"];node.nodes["foot:conditional"];)->.restrictions;
.restrictions out body qt;
(.nodes; - .restrictions;);out skel qt;
(nwr(around:${Math.round(area.radius)},${lat.toFixed(6)},${lon.toFixed(6)})[leisure~"^(park|garden|nature_reserve)$"];nwr(around:${Math.round(area.radius)},${lat.toFixed(6)},${lon.toFixed(6)})[landuse~"^(forest|recreation_ground)$"];);out geom qt;`;
}
export function elementsFrom(data: unknown): OSMElement[] {
  if (!data || typeof data !== "object")
    throw new ProviderError("The map service returned invalid data.");
  const d = data as { remark?: unknown; elements?: unknown };
  if (d.remark)
    throw new ProviderError(
      "The map service could not finish this area. Please retry later.",
    );
  if (
    !Array.isArray(d.elements) ||
    !d.elements.every(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof e.type === "string" &&
        Number.isSafeInteger(e.id),
    )
  )
    throw new ProviderError("The map service returned invalid data.");
  return d.elements;
}
export async function loadArea(
  area: SearchArea,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
) {
  const primary = provider(
    "OVERPASS_URL",
    "https://overpass-api.de/api/interpreter",
  );
  const read = async (url: URL) =>
    elementsFrom(
      await jsonFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: mapQuery(area) }).toString(),
          signal,
        },
        18_000_000,
        fetcher,
      ),
    );
  try {
    return await read(primary);
  } catch (error) {
    signal.throwIfAborted();
    // One sequential fallback for an unreachable default host, within the same
    // area deadline. Never bypass throttling or send custom-provider data elsewhere.
    if (!(error instanceof ProviderConnectionError) || process.env.OVERPASS_URL)
      throw error;
    return read(new URL("https://overpass.private.coffee/api/interpreter"));
  }
}
export type AreaLoader = (
  area: SearchArea,
  signal: AbortSignal,
) => Promise<OSMElement[]>;
export async function searchLoops(
  input: RouteInput,
  load: AreaLoader = loadArea,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<LoopResult> {
  signal?.throwIfAborted();
  const start: Coord = [input.lon, input.lat],
    target = input.distance * 1000,
    deadline = now() + 110000;
  const areas = searchAreas(input);
  let best: LoopResult | undefined,
    lastRouteError: RouteError | undefined,
    reduced = 0,
    calls = 0;
  for (const original of areas) {
    let area = original;
    while (calls < 6) {
      signal?.throwIfAborted();
      const remaining = deadline - now();
      if (remaining < 1000) break;
      calls++;
      try {
        const elements = await load(
          area,
          AbortSignal.any([
            AbortSignal.timeout(Math.min(40000, remaining)),
            ...(signal ? [signal] : []),
          ]),
        );
        signal?.throwIfAborted();
        const result = findLoops(
          elements,
          start,
          target,
          input.direction,
          Date.now() + Math.max(0, deadline - now()),
        );
        if (!best || result.routes[0].score < best.routes[0].score)
          best = result;
        // Keep the requested target unchanged even when the search footprint shrinks.
        if (
          Math.abs(result.routes[0].distance - target) / target <= 0.12 &&
          result.routes[0].repeat <= 0.1 &&
          result.routes[0].trafficLights === 0 &&
          result.routes[0].crossings <= 2 &&
          result.routes[0].barriers === 0 &&
          result.routes[0].railwayCrossings === 0 &&
          result.routes[0].steps < 1
        )
          return result;
        break;
      } catch (e) {
        signal?.throwIfAborted();
        if (e instanceof MapCapacityError) {
          if (area.radius < 1000) break;
          const scale = 0.72;
          area = {
            center: [
              start[0] +
                (((area.center[0] - start[0] + 540) % 360) - 180) * scale,
              start[1] + (area.center[1] - start[1]) * scale,
            ],
            radius: Math.max(800, area.radius * scale),
          };
          reduced++;
          continue;
        }
        if (e instanceof RouteError) {
          lastRouteError = e;
          break;
        }
        // Keep an already-computed real route if a later improvement query fails.
        if (best && e instanceof ProviderError) return best;
        // Throttling/timeouts are not a reason to hammer another public endpoint.
        throw e;
      }
    }
    if (calls >= 6 || now() >= deadline) break;
  }
  if (best) return best;
  if (lastRouteError) throw lastRouteError;
  if (reduced)
    throw new RouteError(
      "NO_LOOP",
      "No suitable loop found within the available mapped area. Try another direction or a nearby starting point.",
    );
  throw new ProviderError("The route search timed out. Please try again.");
}
