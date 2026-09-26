import { ProviderError } from "./errors.ts";
import { jsonFetch, type Fetcher } from "./providers.ts";
import { meters, type Coord } from "./route.ts";

/**
 * Green space around a start point, rasterised from OpenStreetMap polygons.
 *
 * ORS's `green` rating scores street segments by nearby vegetation, so a
 * tree-lined avenue can outrank a park path. Real park polygons let the
 * planner aim waypoints *inside* parks and measure how much of a route is
 * actually in them.
 */
export type GreenArea = {
  name?: string;
  /** Closed lon/lat rings; filled with the even-odd rule (outer + inner). */
  rings: Coord[][];
  /** Water or other holes that must not count as runnable green. */
  hole?: boolean;
};

const EARTH = 6_371_000;
const RAD = Math.PI / 180;
/** Components at least this large are "destination" parks worth running through. */
const LARGE_PARK_M2 = 150_000;
/** Components below this size are pocket parks: nice, but not a destination. */
const SMALL_PARK_M2 = 30_000;

export class GreenMask {
  readonly approximate: boolean;
  readonly center: Coord;
  readonly cell: number;
  readonly size: number;
  readonly radius: number;
  /** Per cell: 0 = not green, otherwise a 0–1 value weighted by park size. */
  readonly value: Float32Array;
  /** Per cell: distance to the nearest non-green cell in cells (0 outside). */
  readonly depth: Uint16Array;
  /** Per cell: connected green component id, -1 outside. */
  readonly component: Int32Array;
  readonly componentArea: number[] = [];
  readonly componentName: (string | undefined)[] = [];
  private readonly kx: number;
  private readonly ky: number;

  constructor(
    center: Coord,
    radius: number,
    areas: GreenArea[],
    cell = 0,
    approximate = false,
  ) {
    this.approximate = approximate;
    this.center = center;
    this.radius = radius;
    this.cell = cell > 0 ? cell : Math.max(30, Math.ceil(radius / 160));
    this.size = Math.ceil((2 * radius) / this.cell) + 1;
    this.ky = EARTH * RAD;
    this.kx = EARTH * RAD * Math.cos(center[1] * RAD);
    const n = this.size * this.size;
    const owner = new Int32Array(n).fill(-1);
    const filled = new Uint8Array(n);
    // Green first, holes (water) afterwards so lakes inside parks are removed.
    const order = areas
      .map((area, index) => ({ area, index }))
      .sort((a, b) => Number(!!a.area.hole) - Number(!!b.area.hole));
    for (const { area, index } of order)
      this.fill(area.rings, (i) => {
        filled[i] = area.hole ? 0 : 1;
        owner[i] = area.hole ? -1 : index;
      });
    this.component = new Int32Array(n).fill(-1);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!filled[i] || this.component[i] !== -1) continue;
      const id = this.componentArea.length;
      const counts = new Map<number, number>();
      let cells = 0;
      this.component[i] = id;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        cells++;
        if (owner[j] >= 0)
          counts.set(owner[j], (counts.get(owner[j]) ?? 0) + 1);
        const x = j % this.size,
          y = (j - x) / this.size;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
          const k = ny * this.size + nx;
          if (filled[k] && this.component[k] === -1) {
            this.component[k] = id;
            stack.push(k);
          }
        }
      }
      this.componentArea.push(cells * this.cell * this.cell);
      // Name the component after its largest named polygon.
      let name: string | undefined,
        best = 0;
      for (const [areaIndex, count] of counts)
        if (areas[areaIndex].name && count > best) {
          best = count;
          name = areas[areaIndex].name;
        }
      this.componentName.push(name);
    }
    this.value = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.component[i];
      if (c < 0) continue;
      const area = this.componentArea[c];
      this.value[i] =
        area >= LARGE_PARK_M2 ? 1 : area >= SMALL_PARK_M2 ? 0.7 : 0.35;
    }
    this.depth = chamfer(filled, this.size);
  }

  /** Local metres east/north of the centre. */
  toXY(c: Coord): [number, number] {
    return [
      (c[0] - this.center[0]) * this.kx,
      (c[1] - this.center[1]) * this.ky,
    ];
  }
  toCoord(x: number, y: number): Coord {
    return [this.center[0] + x / this.kx, this.center[1] + y / this.ky];
  }
  /** Grid index of a local point, or -1 outside the mask. */
  index(x: number, y: number): number {
    const gx = Math.round((x + this.radius) / this.cell),
      gy = Math.round((y + this.radius) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.size || gy >= this.size) return -1;
    return gy * this.size + gx;
  }
  cellXY(i: number): [number, number] {
    const gx = i % this.size,
      gy = (i - gx) / this.size;
    return [gx * this.cell - this.radius, gy * this.cell - this.radius];
  }
  valueAt(c: Coord): number {
    const [x, y] = this.toXY(c);
    const i = this.index(x, y);
    return i < 0 ? 0 : this.value[i];
  }
  /** Length-weighted green value (0–1) along a straight local segment. */
  segment(ax: number, ay: number, bx: number, by: number): number {
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length / this.cell));
    let sum = 0;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const i = this.index(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (i >= 0) sum += this.value[i];
    }
    return sum / steps;
  }

  /**
   * Share of a route's length inside mapped parks/woods, and the names of
   * parks it spends at least 300 m (or a fifth of the route) in.
   */
  measure(coords: Coord[]): { park: number; parks: string[] } {
    let total = 0,
      inside = 0;
    const byComponent = new Map<number, number>();
    for (let k = 1; k < coords.length; k++) {
      const length = meters(coords[k - 1], coords[k]);
      if (!length) continue;
      const [ax, ay] = this.toXY(coords[k - 1]),
        [bx, by] = this.toXY(coords[k]);
      const steps = Math.max(1, Math.ceil(length / 15));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const i = this.index(ax + (bx - ax) * t, ay + (by - ay) * t);
        const part = length / steps;
        total += part;
        if (i >= 0 && this.component[i] >= 0) {
          inside += part;
          const c = this.component[i];
          byComponent.set(c, (byComponent.get(c) ?? 0) + part);
        }
      }
    }
    const parks = [...byComponent]
      .filter(
        ([c, length]) =>
          this.componentName[c] && length >= Math.min(300, total / 5),
      )
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => this.componentName[c]!)
      .filter((name, i, all) => all.indexOf(name) === i)
      .slice(0, 3);
    return { park: total ? inside / total : 0, parks };
  }

  /** Even-odd scanline fill of lon/lat rings. */
  private fill(rings: Coord[][], set: (index: number) => void) {
    const local = rings
      .filter((r) => r.length >= 4)
      .map((r) => r.map((c) => this.toXY(c)));
    if (!local.length) return;
    let minY = Infinity,
      maxY = -Infinity;
    for (const ring of local)
      for (const [, y] of ring) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    const g0 = Math.max(0, Math.ceil((minY + this.radius) / this.cell));
    const g1 = Math.min(
      this.size - 1,
      Math.floor((maxY + this.radius) / this.cell),
    );
    for (let gy = g0; gy <= g1; gy++) {
      const y = gy * this.cell - this.radius;
      const xs: number[] = [];
      for (const ring of local)
        for (let k = 1; k < ring.length; k++) {
          const [x1, y1] = ring[k - 1],
            [x2, y2] = ring[k];
          if (y1 <= y !== y2 <= y)
            xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k] + this.radius) / this.cell));
        const to = Math.min(
          this.size - 1,
          Math.floor((xs[k + 1] + this.radius) / this.cell),
        );
        for (let gx = from; gx <= to; gx++) set(gy * this.size + gx);
      }
    }
  }
}

/** Two-pass chamfer distance (in cells) from each green cell to the nearest edge. */
function chamfer(filled: Uint8Array, size: number): Uint16Array {
  const d = new Uint16Array(size * size);
  const big = 65535;
  for (let i = 0; i < d.length; i++) d[i] = filled[i] ? big : 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!d[i]) continue;
      const up = y > 0 ? d[i - size] : 0,
        left = x > 0 ? d[i - 1] : 0;
      d[i] = Math.min(d[i], up + 1, left + 1);
    }
  for (let y = size - 1; y >= 0; y--)
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (!d[i]) continue;
      const down = y < size - 1 ? d[i + size] : 0,
        right = x < size - 1 ? d[i + 1] : 0;
      d[i] = Math.min(d[i], down + 1, right + 1);
    }
  return d;
}

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
  const key = `${center[0].toFixed(3)},${center[1].toFixed(3)},${Math.ceil(radius / 500)}`;
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
          signal: AbortSignal.any([signal, AbortSignal.timeout(14000)]),
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

/** Metres a loop of `target` metres can reach from its start. */
export function reach(target: number) {
  return Math.min(8000, target / 2.4 + 400);
}

/**
 * A coarse, bundled corridor for the Odeonsplatz example when public OSM
 * outline servers are unavailable. It is only used close to this known start;
 * it must not be presented as precise mapped park coverage.
 */
export function odeonsplatzFallback(start: Coord): GreenArea[] | null {
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
