import { GreenMask, reach } from "./green.ts";
import { odeonsplatzCorridor } from "./known-parks.ts";
import { fetchGreenAreas } from "./overpass.ts";
import { type Fetcher } from "./providers.ts";
import { type Coord } from "./route.ts";

export type ParkSource = (
  start: Coord,
  target: number,
  signal: AbortSignal,
) => Promise<GreenMask | null>;

/** Public OSM outlines for the general case. */
export function mappedParks(fetcher: Fetcher = fetch): ParkSource {
  return async (start, target, signal) => {
    const radius = reach(target);
    const areas = await fetchGreenAreas(start, radius, signal, fetcher);
    return areas.some((area) => !area.hole)
      ? new GreenMask(start, radius, areas)
      : null;
  };
}

/** The Odeonsplatz corridor is an explicit, approximate exception. */
export function parkSource(fetcher: Fetcher = fetch): ParkSource {
  const remote = mappedParks(fetcher);
  return (start, target, signal) => {
    const local = odeonsplatzCorridor(start);
    return local
      ? Promise.resolve(new GreenMask(start, reach(target), local, 0, true))
      : remote(start, target, signal);
  };
}
