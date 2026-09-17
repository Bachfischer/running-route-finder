import { isTrafficSignal } from "./scenery.ts";
export function interruptions(tags: Record<string, string>) {
  return {
    signal: isTrafficSignal(tags),
    crossing:
      tags.highway === "crossing" ||
      [tags.footway, tags.cycleway, tags.path, tags.pedestrian].includes(
        "crossing",
      ) ||
      (!!tags.crossing && tags.crossing !== "no") ||
      isTrafficSignal(tags),
    barrier: [
      "gate",
      "lift_gate",
      "swing_gate",
      "kissing_gate",
      "cycle_barrier",
      "stile",
      "turnstile",
    ].includes(tags.barrier),
    railway: [
      "crossing",
      "level_crossing",
      "tram_crossing",
      "tram_level_crossing",
    ].includes(tags.railway),
    steps: tags.highway === "steps",
  };
}
export type Interruptions = ReturnType<typeof interruptions>;
