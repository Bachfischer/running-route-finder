export type Coord = [number, number];
export type RouteInput = {
  lat: number;
  lon: number;
  distance: number;
};
export type Loop = {
  coordinates: Coord[];
  distance: number;
  bearing: number;
  score: number;
};
export type LoopResult = {
  routes: Loop[];
  quality: {
    green: number | null;
    quiet: number | null;
    paths?: number | null;
    /** Measured share of the route inside mapped parks and woods. */
    park?: number | null;
    /** Names of the parks the loop runs through, most time first. */
    parks?: string[];
    /** The offline Odeonsplatz corridor is approximate, not an OSM outline. */
    parkApproximate?: boolean;
  }[];
  snapDistance: number;
};
export function meters(a: Coord, b: Coord): number {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLon = (b[0] - a[0]) * radians;
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
