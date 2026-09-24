export type Coord = [number, number];
export type RouteInput = {
  lat: number;
  lon: number;
  distance: number;
  direction: string;
};
export type Loop = {
  coordinates: Coord[];
  distance: number;
  bearing: number;
  score: number;
};
export type LoopResult = {
  routes: Loop[];
  quality: { green: number | null; quiet: number | null }[];
  snapDistance: number;
};
export const compass: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
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
