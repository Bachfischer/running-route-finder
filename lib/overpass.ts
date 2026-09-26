import { ProviderError } from "./errors.ts";
import { jsonFetch, type Fetcher } from "./providers.ts";
import { type GreenArea } from "./green.ts";
import { type Coord } from "./route.ts";

const EARTH = 6_371_000;
const RAD = Math.PI / 180;

/** Join OSM multipolygon member ways into closed rings by shared end nodes. */
export function stitch(lines: Coord[][]): Coord[][] {
  const same = (a: Coord, b: Coord) =>
    Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const open = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  const rings: Coord[][] = [];
  while (open.length) {
    let ring = open.pop()!;
    let grown = true;
    while (!same(ring[0], ring.at(-1)!) && grown) {
      grown = false;
      for (let k = 0; k < open.length; k++) {
        const line = open[k];
        const end = ring.at(-1)!;
        if (same(line[0], end)) ring = ring.concat(line.slice(1));
        else if (same(line.at(-1)!, end))
          ring = ring.concat([...line].reverse().slice(1));
        else continue;
        open.splice(k, 1);
        grown = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1)!)) rings.push(ring);
  }
  return rings;
}

type OsmPoint = { lat?: unknown; lon?: unknown };
type OsmElement = {
  type?: unknown;
  tags?: Record<string, unknown>;
  geometry?: OsmPoint[];
  members?: { type?: unknown; role?: unknown; geometry?: OsmPoint[] }[];
};

function line(points: OsmPoint[] | undefined): Coord[] | null {
  if (!Array.isArray(points) || points.length < 2 || points.length > 20000)
    return null;
  const out: Coord[] = [];
  for (const p of points) {
    if (
      typeof p?.lat !== "number" ||
      typeof p?.lon !== "number" ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lat) > 85 ||
      Math.abs(p.lon) > 180
    )
      return null;
    out.push([p.lon, p.lat]);
  }
  return out;
}

function ringArea(ring: Coord[]): number {
  const k = Math.cos(ring[0][1] * RAD) * EARTH * RAD;
  let sum = 0;
  for (let i = 1; i < ring.length; i++)
    sum +=
      (ring[i - 1][0] * k * ring[i][1] - ring[i][0] * k * ring[i - 1][1]) *
      EARTH *
      RAD;
  return Math.abs(sum / 2);
}

/** Convert an Overpass `out geom` response into green areas and water holes. */
export function parseOverpass(raw: unknown): GreenArea[] {
  const elements = (raw as { elements?: OsmElement[] } | null)?.elements;
  if (!Array.isArray(elements))
    throw new ProviderError("The park data service returned invalid data.");
  const areas: GreenArea[] = [];
  for (const element of elements.slice(0, 5000)) {
    const tags = element?.tags ?? {};
    const hole = tags.natural === "water";
    const name = typeof tags.name === "string" ? tags.name.slice(0, 80) : "";
    let rings: Coord[][] = [];
    if (element?.type === "way") {
      const ring = line(element.geometry);
      if (ring) rings = stitch([ring]);
    } else if (element?.type === "relation" && Array.isArray(element.members)) {
      const members = element.members.filter((m) => m?.type === "way");
      const outer = stitch(
        members
          .filter((m) => m.role !== "inner")
          .map((m) => line(m.geometry))
          .filter((l): l is Coord[] => !!l),
      );
      const inner = stitch(
        members
          .filter((m) => m.role === "inner")
          .map((m) => line(m.geometry))
          .filter((l): l is Coord[] => !!l),
      );
      rings = outer.length ? [...outer, ...inner] : [];
    }
    if (!rings.length) continue;
    const area = rings.reduce((sum, r) => sum + ringArea(r), 0);
    // Huge protected areas often include farmland and villages; skip them.
    if (!hole && tags.leisure === "nature_reserve" && area > 10_000_000)
      continue;
    areas.push({ ...(name ? { name } : {}), rings, ...(hole ? { hole } : {}) });
  }
  return areas;
}

export function overpassQuery(center: Coord, radius: number): string {
  // Bounding-box selection is much cheaper for public Overpass instances than
  // applying a geometry-length and around() predicate to every candidate.
  const lat = radius / 111_200;
  const lon = lat / Math.cos(center[1] * RAD);
  const bbox = `(${(center[1] - lat).toFixed(6)},${(center[0] - lon).toFixed(6)},${(center[1] + lat).toFixed(6)},${(center[0] + lon).toFixed(6)})`;
  const open = `["access"!~"^(private|no|customers)$"]`;
  return `[out:json][timeout:15][maxsize:33554432];
(
way["leisure"~"^(park|nature_reserve|common|recreation_ground)$"]${open}${bbox};
relation["leisure"~"^(park|nature_reserve)$"]${open}${bbox};
way["landuse"~"^(forest|recreation_ground|village_green)$"]${open}${bbox};
relation["landuse"="forest"]${open}${bbox};
way["natural"="wood"]${open}${bbox};
relation["natural"="wood"]${open}${bbox};
way["natural"="water"]${bbox};
);
out geom qt;`;
}

const mirrors = [
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const cache = new Map<string, { at: number; areas: GreenArea[] }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

/** Fetch mapped parks, woods and lakes around a start (cached per instance). */
export async function fetchGreenAreas(
  center: Coord,
  radius: number,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  endpoints: string[] = mirrors,
): Promise<GreenArea[]> {
  // A nearby but different start must not reuse a mask centred on the wrong
  // coordinates, nor may a larger search reuse a smaller search's polygons.
  const key = `${center[0].toFixed(6)},${center[1].toFixed(6)},${Math.ceil(radius)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.areas;
  let last: unknown;
  for (const url of endpoints) {
    signal.throwIfAborted();
    try {
      const data = await jsonFetch(
        url,
        {
          method: "POST",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(overpassQuery(center, radius)),
        },
        24_000_000,
        fetcher,
      );
      const areas = parseOverpass(data);
      if (cache.size > 64) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), areas });
      return areas;
    } catch (error) {
      signal.throwIfAborted();
      console.warn(
        "park data source unavailable",
        new URL(url).hostname,
        error instanceof ProviderError
          ? error.status
          : error instanceof Error
            ? error.name
            : "unknown",
      );
      last = error;
    }
  }
  throw last;
}

export function clearGreenCache() {
  cache.clear();
}
