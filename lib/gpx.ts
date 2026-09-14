import type { Coord } from "./routing.ts";
export function toGpx(coordinates: Coord[]): string {
  if (
    coordinates.length < 2 ||
    coordinates.some(
      (c) =>
        c.length !== 2 ||
        !c.every(Number.isFinite) ||
        Math.abs(c[0]) > 180 ||
        Math.abs(c[1]) > 90,
    )
  )
    throw new Error("Invalid route coordinates.");
  return (
    '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Loop" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Running route</name><trkseg>' +
    coordinates
      .map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`)
      .join("") +
    "</trkseg></trk></gpx>"
  );
}
