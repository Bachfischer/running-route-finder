import type { Coord, OSMElement } from "./routing.ts";
type Ring = Coord[];
type GreenArea = { outer: Ring[]; inner: Ring[]; bounds: number[] };
export function inRing(point: Coord, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function rings(parts: Ring[]): Ring[] {
  const remaining = parts.map((p) => p.slice()),
    result: Ring[] = [];
  const same = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
  while (remaining.length) {
    const ring = remaining.pop()!;
    while (ring.length && !same(ring[0], ring[ring.length - 1])) {
      const i = remaining.findIndex(
        (p) =>
          same(p[0], ring[ring.length - 1]) ||
          same(p[p.length - 1], ring[ring.length - 1]),
      );
      if (i < 0) break;
      const part = remaining.splice(i, 1)[0];
      if (!same(part[0], ring[ring.length - 1])) part.reverse();
      ring.push(...part.slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1]))
      result.push(ring);
  }
  return result;
}
export function greenAreas(elements: OSMElement[]): GreenArea[] {
  const result: GreenArea[] = [];
  const coords = (geometry?: { lat: number; lon: number }[]): Ring =>
    (geometry || [])
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => [p.lon, p.lat]);
  for (const e of elements) {
    if (
      !["park", "garden", "nature_reserve"].includes(e.tags?.leisure || "") &&
      !["forest", "recreation_ground"].includes(e.tags?.landuse || "")
    )
      continue;
    const outer = rings(
      e.type === "way"
        ? [coords(e.geometry)]
        : (e.members || [])
            .filter((m) => m.role !== "inner")
            .map((m) => coords(m.geometry))
            .filter((p) => p.length > 0),
    );
    if (!outer.length) continue;
    const inner = rings(
      (e.members || [])
        .filter((m) => m.role === "inner")
        .map((m) => coords(m.geometry))
        .filter((p) => p.length > 0),
    );
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of outer)
      for (const p of ring) {
        bounds[0] = Math.min(bounds[0], p[0]);
        bounds[1] = Math.min(bounds[1], p[1]);
        bounds[2] = Math.max(bounds[2], p[0]);
        bounds[3] = Math.max(bounds[3], p[1]);
      }
    result.push({ outer, inner, bounds });
  }
  return result;
}
export function inGreenArea(point: Coord, areas: GreenArea[]) {
  return areas.some(
    (a) =>
      point[0] >= a.bounds[0] &&
      point[0] <= a.bounds[2] &&
      point[1] >= a.bounds[1] &&
      point[1] <= a.bounds[3] &&
      a.outer.some((r) => inRing(point, r)) &&
      !a.inner.some((r) => inRing(point, r)),
  );
}
export function isTrafficSignal(tags: Record<string, string>): boolean {
  return (
    tags.highway === "traffic_signals" ||
    tags.crossing === "traffic_signals" ||
    tags["crossing:signals"] === "yes"
  );
}
