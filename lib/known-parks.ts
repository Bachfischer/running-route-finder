import { type GreenArea } from "./green.ts";
import { meters, type Coord } from "./route.ts";

/**
 * A coarse, bundled corridor for the Odeonsplatz example when public OSM
 * outline servers are unavailable. It is only used close to this known start;
 * it must not be presented as precise mapped park coverage.
 */
export function odeonsplatzCorridor(start: Coord): GreenArea[] | null {
  if (meters(start, [11.577, 48.142]) > 1200) return null;
  const close = (ring: Coord[]): Coord[] => [...ring, ring[0]];
  return [
    {
      name: "Englischer Garten",
      rings: [
        close([
          [11.5845, 48.144],
          [11.5885, 48.1432],
          [11.593, 48.147],
          [11.5985, 48.153],
          [11.602, 48.16],
          [11.601, 48.1645],
          [11.5905, 48.165],
          [11.587, 48.156],
          [11.583, 48.15],
          [11.5835, 48.146],
        ]),
        close([
          [11.5905, 48.1662],
          [11.601, 48.1662],
          [11.608, 48.175],
          [11.612, 48.185],
          [11.606, 48.188],
          [11.6, 48.18],
          [11.593, 48.172],
        ]),
      ],
    },
    {
      name: "Kleinhesseloher See",
      hole: true,
      rings: [
        close([
          [11.5915, 48.1555],
          [11.5965, 48.1555],
          [11.5965, 48.159],
          [11.5915, 48.159],
        ]),
      ],
    },
  ];
}
