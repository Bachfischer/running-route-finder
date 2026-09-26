import type { GreenMask } from "./green.ts";
import type { Coord } from "./route.ts";

export type Plan = {
  /** Intermediate waypoints between start and finish (2 or 3 points). */
  waypoints: Coord[];
  /** Straight-line length of start → waypoints → start in metres. */
  straight: number;
  /** Expected routed length (straight × detour). */
  estimate: number;
  /** Length-weighted green value of the straight legs, 0–1. */
  green: number;
  cost: number;
};

/** Typical ratio of routed walking distance to straight-line legs in parks. */
export const DEFAULT_DETOUR = 1.3;
const MAX_CANDIDATES = 72;

/**
 * Choose waypoints deep inside large parks so that a start → A → B (→ C) →
 * start loop stays green and matches the target length. Legs are scored on
 * a raster of real park polygons, so "go through Englischer Garten" wins over
 * "circle the Altstadt", even if the city streets have trees.
 */
export function planGreenLoops(
  mask: GreenMask,
  start: Coord,
  target: number,
  options: { detour?: number; count?: number; avoid?: Coord[][] } = {},
): Plan[] {
  const detour = options.detour ?? DEFAULT_DETOUR;
  const count = options.count ?? 3;
  const [sx, sy] = mask.toXY(start);
  const maxReach = target / (2 * detour);
  const spacing = Math.min(600, Math.max(180, target / 30));
  // One candidate per coarse block: its deepest, most valuable green cell.
  const blocks = new Map<string, { i: number; rank: number }>();
  for (let i = 0; i < mask.value.length; i++) {
    const value = mask.value[i];
    if (!value) continue;
    const [x, y] = mask.cellXY(i);
    const away = Math.hypot(x - sx, y - sy);
    if (away > maxReach || away < spacing * 0.5) continue;
    const depth = Math.min(mask.depth[i], 4);
    const rank = value * 2 + depth * 0.5;
    const key = `${Math.floor(x / spacing)},${Math.floor(y / spacing)}`;
    const current = blocks.get(key);
    if (!current || rank > current.rank) blocks.set(key, { i, rank });
  }
  const picks = [...blocks.values()]
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .slice(0, MAX_CANDIDATES);
  if (picks.length < 2) return [];
  const nodes: [number, number][] = [
    [sx, sy],
    ...picks.map((p) => mask.cellXY(p.i)),
  ];
  const n = nodes.length;
  const length = new Float64Array(n * n);
  const green = new Float64Array(n * n);
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const [ax, ay] = nodes[a],
        [bx, by] = nodes[b];
      const d = Math.hypot(bx - ax, by - ay);
      const g = mask.segment(ax, ay, bx, by);
      length[a * n + b] = length[b * n + a] = d;
      green[a * n + b] = green[b * n + a] = g;
    }
  const L = (a: number, b: number) => length[a * n + b];
  const G = (a: number, b: number) => green[a * n + b] * length[a * n + b];
  // Penalise sharp reversals at a waypoint: they create out-and-back spurs.
  const spur = (a: number, b: number, c: number) => {
    const [ax, ay] = nodes[a],
      [bx, by] = nodes[b],
      [cx, cy] = nodes[c];
    const ux = ax - bx,
      uy = ay - by,
      vx = cx - bx,
      vy = cy - by;
    const cos =
      (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    return cos > 0.9 ? 0.35 : cos > 0.75 ? 0.12 : 0;
  };
  const scored: {
    cost: number;
    path: number[];
    straight: number;
    g: number;
  }[] = [];
  const consider = (path: number[]) => {
    let straight = 0,
      g = 0,
      penalty = 0;
    for (let k = 1; k < path.length; k++) {
      straight += L(path[k - 1], path[k]);
      g += G(path[k - 1], path[k]);
    }
    const error = Math.abs(straight * detour - target) / target;
    if (error > 0.3) return;
    for (let k = 1; k + 1 < path.length; k++)
      penalty += spur(path[k - 1], path[k], path[k + 1]);
    const share = g / straight;
    scored.push({
      cost: error * 2.5 + Math.max(0, error - 0.1) * 8 - share * 2.2 + penalty,
      path,
      straight,
      g: share,
    });
  };
  for (let a = 1; a < n; a++)
    for (let b = 1; b < n; b++) {
      if (b === a) continue;
      if (a < b) consider([0, a, b, 0]);
      for (let c = a + 1; c < n; c++) if (c !== b) consider([0, a, b, c, 0]);
    }
  scored.sort((x, y) => x.cost - y.cost);
  const chosen: Plan[] = [];
  const avoid = options.avoid ?? [];
  const similar = (wps: Coord[], other: Coord[]) =>
    wps.every((p) =>
      other.some((q) => {
        const [px, py] = mask.toXY(p),
          [qx, qy] = mask.toXY(q);
        return Math.hypot(px - qx, py - qy) < Math.max(450, spacing * 1.5);
      }),
    );
  for (const s of scored) {
    if (chosen.length >= count) break;
    const waypoints = s.path
      .slice(1, -1)
      .map((k) => mask.toCoord(nodes[k][0], nodes[k][1]));
    if (
      chosen.some((c) => similar(waypoints, c.waypoints)) ||
      avoid.some((a) => similar(waypoints, a))
    )
      continue;
    chosen.push({
      waypoints,
      straight: s.straight,
      estimate: s.straight * detour,
      green: s.g,
      cost: s.cost,
    });
  }
  // Without meaningful green nearby, the caller falls back to ORS round trips.
  return chosen.filter((p) => p.green >= 0.25);
}
