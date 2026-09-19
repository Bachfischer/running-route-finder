import { interruptions, type Interruptions } from "./interruptions.ts";
import { greenAreas, inGreenArea, isTrafficSignal } from "./scenery.ts";
import { MapCapacityError, RouteError, ProviderError } from "./errors.ts";
export type Coord = [number, number];
export type OSMElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { role?: string; geometry?: { lat: number; lon: number }[] }[];
};
export type Loop = {
  coordinates: Coord[];
  distance: number;
  repeat: number;
  paths: number;
  parks: number;
  trafficLights: number;
  crossings: number;
  barriers: number;
  railwayCrossings: number;
  steps: number;
  sharpTurns: number;
  score: number;
  bearing: number;
};
export type LoopResult = {
  routes: Loop[];
  snapDistance: number;
  candidates: number;
};
type Edge = {
  to: number;
  length: number;
  factor: number;
  path: boolean;
  startAllowed?: boolean;
  park?: boolean;
  signalCost?: number;
  interruptionCost?: number;
  wayCost?: number;
  features?: Interruptions;
  key: string;
};
type Vertex = {
  coord: Coord;
  edges: Edge[];
  signal?: boolean;
  features?: Interruptions;
};
export type Graph = Map<number, Vertex>;
const rad = Math.PI / 180;
export function meters(a: Coord, b: Coord) {
  const dlat = (a[1] - b[1]) * rad,
    dlon = (a[0] - b[0]) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
const permitted = new Set(["yes", "designated", "permissive", "official"]);
const allowed = new Set([
  "footway",
  "path",
  "pedestrian",
  "living_street",
  "residential",
  "service",
  "track",
  "unclassified",
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "steps",
  "cycleway",
]);
export function canWalk(t: Record<string, string>) {
  if (
    !allowed.has(t.highway) ||
    t.area === "yes" ||
    t.construction ||
    t.proposed
  )
    return false;
  if (t.foot && !permitted.has(t.foot)) return false;
  if (t.access && !permitted.has(t.access) && !permitted.has(t.foot))
    return false;
  if (t["access:conditional"] || t["foot:conditional"]) return false;
  if (t.highway === "cycleway" && !permitted.has(t.foot)) return false;
  if (t.highway === "path" && t.sac_scale && t.sac_scale !== "hiking")
    return false;
  if (
    ["secondary", "secondary_link"].includes(t.highway) &&
    !permitted.has(t.foot) &&
    !["yes", "both", "left", "right"].includes(t.sidewalk)
  )
    return false;
  return true;
}
export function graphFrom(elements: OSMElement[]): Graph {
  const graph: Graph = new Map();
  const blocked = new Set<number>();
  const parks = greenAreas(elements);
  for (const n of elements) {
    if (
      n.type === "node" &&
      Number.isFinite(n.lat) &&
      Number.isFinite(n.lon) &&
      Math.abs(n.lat!) <= 90 &&
      Math.abs(n.lon!) <= 180
    ) {
      graph.set(n.id, {
        coord: [n.lon!, n.lat!],
        edges: [],
        signal: isTrafficSignal(n.tags || {}),
        features: interruptions(n.tags || {}),
      });
      const t = n.tags || {};
      if (
        (t.foot && !permitted.has(t.foot)) ||
        (t.access && !permitted.has(t.access) && !permitted.has(t.foot)) ||
        t["access:conditional"] ||
        t["foot:conditional"] ||
        (["wall", "fence", "retaining_wall", "hedge"].includes(t.barrier) &&
          !permitted.has(t.foot))
      )
        blocked.add(n.id);
    }
  }
  for (const way of elements) {
    const t = way.tags || {};
    if (way.type !== "way" || !Array.isArray(way.nodes) || !canWalk(t))
      continue;
    const path = ["footway", "path", "pedestrian", "track"].includes(t.highway);
    const factor = path
      ? 1
      : ["living_street", "residential"].includes(t.highway)
        ? 1.12
        : t.highway === "steps"
          ? 6
          : 1.4;
    const features = interruptions(t);
    let wayLength = 0;
    for (let i = 1; i < way.nodes.length; i++) {
      const a = graph.get(way.nodes[i - 1]),
        b = graph.get(way.nodes[i]);
      if (a && b) wayLength += meters(a.coord, b.coord);
    }
    const hasSignalNode = way.nodes.some(
      (id) => graph.get(id)?.features?.signal,
    );
    const hasCrossingNode = way.nodes.some(
      (id) => graph.get(id)?.features?.crossing,
    );
    // Way-only markings receive one length-distributed cost, independent of
    // how many geometry nodes the mapper inserted. Node markings take priority.
    const wayCost =
      (features.signal && !hasSignalNode ? 600 : 0) +
      (features.crossing && !hasCrossingNode && !features.signal ? 120 : 0);
    const nodeCost = (v: Vertex) =>
      (v.features?.crossing && !v.signal ? 120 : 0) +
      (v.features?.barrier ? 180 : 0) +
      (v.features?.railway ? 900 : 0);
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1],
        b = way.nodes[i],
        na = graph.get(a),
        nb = graph.get(b);
      if (!na || !nb || blocked.has(a) || blocked.has(b) || a === b) continue;
      const length = meters(na.coord, nb.coord);
      if (length === 0) continue;
      const park = inGreenArea(
        [(na.coord[0] + nb.coord[0]) / 2, (na.coord[1] + nb.coord[1]) / 2],
        parks,
      );
      const runningFactor = factor * (park ? 1 : 1.8);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (t["oneway:foot"] !== "-1" && !na.edges.some((e) => e.to === b))
        na.edges.push({
          to: b,
          length,
          factor: runningFactor,
          path,
          startAllowed:
            !features.steps &&
            t.tunnel !== "yes" &&
            t.indoor !== "yes" &&
            !(Number(t.layer) < 0) &&
            !(Number(t.level) < 0),
          park,
          signalCost: nb.signal ? 600 : 0,
          interruptionCost: nodeCost(nb) + (wayCost * length) / wayLength,
          features,
          wayCost: (wayCost * length) / wayLength,
          key,
        });
      if (
        t["oneway:foot"] !== "yes" &&
        t["oneway:foot"] !== "1" &&
        !nb.edges.some((e) => e.to === a)
      )
        nb.edges.push({
          to: a,
          length,
          factor: runningFactor,
          path,
          startAllowed:
            !features.steps &&
            t.tunnel !== "yes" &&
            t.indoor !== "yes" &&
            !(Number(t.layer) < 0) &&
            !(Number(t.level) < 0),
          park,
          signalCost: na.signal ? 600 : 0,
          interruptionCost: nodeCost(na) + (wayCost * length) / wayLength,
          features,
          wayCost: (wayCost * length) / wayLength,
          key,
        });
    }
  }
  for (const [id, n] of graph) if (!n.edges.length) graph.delete(id);
  for (const n of graph.values())
    n.edges = n.edges.filter((e) => graph.has(e.to));
  return graph;
}
export class Heap {
  a: { id: number; cost: number }[] = [];
  push(v: { id: number; cost: number }) {
    let i = this.a.length;
    this.a.push(v);
    while (i) {
      const p = (i - 1) >> 1;
      if (this.a[p].cost <= v.cost) break;
      this.a[i] = this.a[p];
      i = p;
    }
    this.a[i] = v;
  }
  pop() {
    const root = this.a[0],
      last = this.a.pop()!;
    if (this.a.length) {
      let i = 0;
      while (i * 2 + 1 < this.a.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.a.length && this.a[c + 1].cost < this.a[c].cost) c++;
        if (this.a[c].cost >= last.cost) break;
        this.a[i] = this.a[c];
        i = c;
      }
      this.a[i] = last;
    }
    return root;
  }
}
export function shortest(
  g: Graph,
  start: number,
  end: number,
  used: Set<string>,
  max: number,
  uninterrupted = false,
): number[] | null {
  if (start === end) return [start];
  const target = g.get(end)!.coord,
    heap = new Heap(),
    cost = new Map<number, number>([[start, 0]]),
    prev = new Map<number, number>();
  heap.push({ id: start, cost: meters(g.get(start)!.coord, target) });
  let visited = 0;
  while (heap.a.length && visited++ < 70000) {
    const item = heap.pop(),
      v = g.get(item.id)!;
    if (
      item.cost >
      (cost.get(item.id) ?? Infinity) + meters(v.coord, target) + 0.01
    )
      continue;
    if (item.id === end) {
      const ids = [end];
      while (ids[ids.length - 1] !== start)
        ids.push(prev.get(ids[ids.length - 1])!);
      return ids.reverse();
    }
    const current = cost.get(item.id)!;
    for (const edge of v.edges) {
      const destinationFeatures = g.get(edge.to)!.features;
      if (
        uninterrupted &&
        (edge.features?.steps ||
          edge.features?.signal ||
          g.get(edge.to)!.signal ||
          destinationFeatures?.barrier ||
          destinationFeatures?.railway)
      )
        continue;
      const next =
        current +
        edge.length * edge.factor * (used.has(edge.key) ? 4 : 1) +
        (edge.signalCost || 0) +
        (edge.interruptionCost || 0);
      if (next > max || next >= (cost.get(edge.to) ?? Infinity)) continue;
      cost.set(edge.to, next);
      prev.set(edge.to, item.id);
      heap.push({
        id: edge.to,
        cost: next + meters(g.get(edge.to)!.coord, target),
      });
    }
  }
  return null;
}
function nearest(g: Graph, point: Coord, surfaceOnly = false) {
  let id = -1,
    best = Infinity;
  for (const [k, v] of g) {
    if (
      !v.edges.length ||
      (surfaceOnly && !v.edges.some((e) => e.startAllowed !== false))
    )
      continue;
    const d = meters(point, v.coord);
    if (d < best) {
      best = d;
      id = k;
    }
  }
  return { id, distance: best };
}
// Project onto an existing walkable segment; never connect unrelated ways.
export function snapToPath(
  g: Graph,
  point: Coord,
  surfaceOnly = true,
): { id: number; distance: number } {
  const snap = nearest(g, point, surfaceOnly);
  let selected: { a: number; b: number; coord: Coord } | undefined;
  const cos = Math.cos(point[1] * rad);
  const longitudeDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180;
  for (const [a, vertex] of g) {
    for (const edge of vertex.edges) {
      if (surfaceOnly && edge.startAllowed === false) continue;
      const end = g.get(edge.to)!.coord;
      const dx = longitudeDelta(end[0], vertex.coord[0]);
      const dy = end[1] - vertex.coord[1];
      const length2 = (dx * cos) ** 2 + dy ** 2;
      if (!length2) continue;
      const t = Math.max(
        0,
        Math.min(
          1,
          (longitudeDelta(point[0], vertex.coord[0]) * dx * cos ** 2 +
            (point[1] - vertex.coord[1]) * dy) /
            length2,
        ),
      );
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const coord: Coord = [vertex.coord[0] + t * dx, vertex.coord[1] + t * dy];
      if (coord[0] > 180) coord[0] -= 360;
      if (coord[0] < -180) coord[0] += 360;
      const distance = meters(point, coord);
      if (distance < snap.distance) {
        snap.distance = distance;
        selected = { a, b: edge.to, coord };
      }
    }
  }
  if (snap.distance > 300 && surfaceOnly) return snapToPath(g, point, false);
  if (!selected || snap.distance > 300) return snap;
  let id = -2;
  while (g.has(id)) id--;
  const { a, b, coord } = selected;
  const vertex: Vertex = { coord, edges: [] };
  g.set(id, vertex);
  // Split only the directed edges that already exist. The signal penalty
  // stays at the original endpoint, and both halves retain their scenery.
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    const origin = g.get(from)!;
    const index = origin.edges.findIndex((edge) => edge.to === to);
    if (index === -1) continue;
    const edge = origin.edges[index];
    const key = (u: number, v: number) => `${Math.min(u, v)}:${Math.max(u, v)}`;
    origin.edges[index] = {
      ...edge,
      to: id,
      length: meters(origin.coord, coord),
      signalCost: 0,
      interruptionCost:
        ((edge.wayCost || 0) * meters(origin.coord, coord)) / edge.length,
      wayCost:
        ((edge.wayCost || 0) * meters(origin.coord, coord)) / edge.length,
      key: key(from, id),
    };
    vertex.edges.push({
      ...edge,
      interruptionCost:
        (edge.interruptionCost || 0) -
        ((edge.wayCost || 0) * meters(origin.coord, coord)) / edge.length,
      wayCost:
        ((edge.wayCost || 0) * meters(coord, g.get(to)!.coord)) / edge.length,
      length: meters(coord, g.get(to)!.coord),
      key: key(id, to),
    });
  }
  return { id, distance: snap.distance };
}
export function destination(start: Coord, d: number, bearing: number): Coord {
  const a = d / 6371000,
    b = bearing * rad,
    p = start[1] * rad,
    l = start[0] * rad;
  const p2 = Math.asin(
    Math.sin(p) * Math.cos(a) + Math.cos(p) * Math.sin(a) * Math.cos(b),
  );
  const l2 =
    l +
    Math.atan2(
      Math.sin(b) * Math.sin(a) * Math.cos(p),
      Math.cos(a) - Math.sin(p) * Math.sin(p2),
    );
  return [((l2 / rad + 540) % 360) - 180, p2 / rad];
}
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
export function routeInfo(
  g: Graph,
  ids: number[],
  target: number,
  preferred: number | undefined,
) {
  let distance = 0,
    repeated = 0,
    path = 0,
    park = 0,
    trafficLights = 0,
    crossings = 0,
    barriers = 0,
    railwayCrossings = 0,
    steps = 0,
    sharpTurns = 0,
    x = 0,
    y = 0;
  const seen = new Set<string>(),
    origin = g.get(ids[0])!.coord;
  let previousFeatures = interruptions({});
  for (let i = 1; i < ids.length; i++) {
    const a = g.get(ids[i - 1])!,
      b = g.get(ids[i])!,
      e = a.edges.find((e) => e.to === ids[i])!;
    distance += e.length;
    if (seen.has(e.key)) repeated += e.length;
    seen.add(e.key);
    if (e.path) path += e.length;
    if (e.park) park += e.length;
    const features = {
      signal: !!(e.features?.signal || b.features?.signal || b.signal),
      crossing: !!(e.features?.crossing || b.features?.crossing),
      barrier: !!b.features?.barrier,
      railway: !!b.features?.railway,
      steps: !!e.features?.steps,
    };
    if (features.signal && !previousFeatures.signal) trafficLights++;
    if (features.crossing && !previousFeatures.crossing) crossings++;
    if (features.barrier && !previousFeatures.barrier) barriers++;
    if (features.railway && !previousFeatures.railway) railwayCrossings++;
    if (features.steps) steps += e.length;
    previousFeatures = features;
    if (i > 1 && a.edges.length >= 3) {
      const before = g.get(ids[i - 2])!.coord;
      const dx1 = (a.coord[0] - before[0]) * Math.cos(a.coord[1] * rad);
      const dy1 = a.coord[1] - before[1];
      const dx2 = (b.coord[0] - a.coord[0]) * Math.cos(a.coord[1] * rad);
      const dy2 = b.coord[1] - a.coord[1];
      const dot =
        (dx1 * dx2 + dy1 * dy2) / (Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2));
      if (
        meters(before, a.coord) >= 5 &&
        e.length >= 5 &&
        dot < Math.cos(110 * rad)
      )
        sharpTurns++;
    }
    x +=
      (((b.coord[0] - origin[0] + 540) % 360) - 180) *
      Math.cos(origin[1] * rad) *
      e.length;
    y += (b.coord[1] - origin[1]) * e.length;
  }
  const bearing = (Math.atan2(x, y) / rad + 360) % 360;
  const alignment =
    preferred === undefined
      ? 0
      : (1 - Math.cos((bearing - preferred) * rad)) / 2;
  const repeat = repeated / distance,
    paths = path / distance;
  const score =
    (Math.abs(distance - target) / target) * 6 +
    repeat * 4 +
    alignment * 0.4 +
    (1 - paths) * 0.12 +
    (1 - park / distance) * 3 +
    trafficLights * 0.65 +
    crossings * 0.2 +
    barriers * 0.35 +
    railwayCrossings * 0.9 +
    steps * 0.015 +
    sharpTurns * 0.04;
  return {
    coordinates: ids.map((id) => g.get(id)!.coord),
    distance,
    repeat,
    paths,
    parks: park / distance,
    trafficLights,
    crossings,
    barriers,
    railwayCrossings,
    steps,
    sharpTurns,
    score,
    bearing,
  };
}
export function findLoops(
  elements: OSMElement[],
  start: Coord,
  target: number,
  direction: string,
  deadline = Infinity,
): LoopResult {
  if (Date.now() >= deadline)
    throw new ProviderError("The route search timed out. Please try again.");
  if (
    !Array.isArray(start) ||
    start.length !== 2 ||
    !start.every(Number.isFinite) ||
    Math.abs(start[0]) > 180 ||
    Math.abs(start[1]) > 85
  )
    throw Error("Invalid starting coordinates.");
  if (
    !Number.isFinite(target) ||
    target < 2000 ||
    target > 25000 ||
    (!Object.hasOwn(compass, direction) && direction !== "Any")
  )
    throw Error("Choose a distance between 2 and 25 km and a valid direction.");
  if (elements.length > 130000) throw new MapCapacityError();
  const g = graphFrom(elements),
    snap = snapToPath(g, start);
  if (snap.id === -1 || snap.distance > 300)
    throw new RouteError(
      "NO_START",
      "No accessible mapped path within 300 m. Move your starting point closer to a street or trail.",
    );
  // Restrict waypoint snapping to the component reachable from the start.
  const reachable = new Set([snap.id]),
    queue = [snap.id];
  for (let i = 0; i < queue.length; i++) {
    for (const e of g.get(queue[i])!.edges)
      if (!reachable.has(e.to)) {
        reachable.add(e.to);
        queue.push(e.to);
      }
  }
  for (const id of g.keys()) if (!reachable.has(id)) g.delete(id);
  const origin = g.get(snap.id)!.coord,
    preferred = compass[direction],
    routes: Loop[] = [];
  let attempts = 0;
  const bearings =
    preferred === undefined
      ? [0, 45, 90, 135, 180, 225, 270, 315]
      : [
          preferred,
          preferred - 12,
          preferred + 12,
          preferred - 25,
          preferred + 25,
          preferred - 50,
          preferred + 50,
          preferred + 180,
        ];
  candidates: for (const scale of [0.65, 0.75, 0.85, 0.95, 1.05, 1.15])
    for (const bearing of bearings)
      for (const spread of [15, 35]) {
        // Timers cannot interrupt synchronous graph work; check wall-clock time
        // between candidates and retain any valid loops already discovered.
        if (Date.now() >= deadline) {
          if (routes.length) break candidates;
          throw new ProviderError(
            "The route search timed out. Please try again.",
          );
        }
        const radius = (target / 3.9) * scale;
        const a = nearest(g, destination(origin, radius, bearing - spread)),
          b = nearest(g, destination(origin, radius, bearing + spread));
        if (
          a.id === snap.id ||
          b.id === snap.id ||
          a.id === b.id ||
          a.distance > radius * 0.65 ||
          b.distance > radius * 0.65
        )
          continue;
        attempts++;
        const used = new Set<string>(),
          ids = [snap.id];
        let ok = true;
        for (const goal of [a.id, b.id, snap.id]) {
          const leg =
            shortest(g, ids[ids.length - 1], goal, used, target * 6, true) ??
            shortest(g, ids[ids.length - 1], goal, used, target * 6);
          if (!leg) {
            ok = false;
            break;
          }
          for (let i = 1; i < leg.length; i++) {
            const u = leg[i - 1],
              v = leg[i];
            used.add(u < v ? `${u}:${v}` : `${v}:${u}`);
          }
          ids.push(...leg.slice(1));
        }
        if (!ok) continue;
        const info = routeInfo(g, ids, target, preferred);
        if (
          info.distance < target * 0.45 ||
          info.distance > target * 1.65 ||
          info.repeat > 0.3
        )
          continue;
        routes.push(info);
      }
  routes.sort((a, b) => a.score - b.score);
  if (!routes.length)
    throw new RouteError(
      "NO_LOOP",
      "No suitable loop found on the available paths. Try another direction or a nearby starting point.",
    );
  const distinct: Loop[] = [];
  for (const route of routes) {
    if (distinct.every((other) => routeOverlap(route, other) < 0.85))
      distinct.push(route);
    if (distinct.length === 3) break;
  }
  return {
    routes: distinct,
    snapDistance: snap.distance,
    candidates: attempts,
  };
}

// Compare undirected path segments, so reversing the same loop is not an alternative.
export function routeOverlap(a: Loop, b: Loop) {
  const segments = (r: Loop) => {
    const result = new Map<string, number>();
    for (let i = 1; i < r.coordinates.length; i++) {
      const u = r.coordinates[i - 1],
        v = r.coordinates[i];
      const key = [u.join(","), v.join(",")].sort().join(":");
      result.set(key, meters(u, v));
    }
    return result;
  };
  const first = segments(a),
    second = segments(b);
  let shared = 0;
  for (const [key, length] of first) if (second.has(key)) shared += length;
  const length = (m: Map<string, number>) =>
    [...m.values()].reduce((s, n) => s + n, 0);
  return shared / Math.max(1, Math.min(length(first), length(second)));
}
