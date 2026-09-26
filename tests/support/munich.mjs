// Simplified outlines of central Munich green spaces (approximate, for tests).
// Shape is what matters: a long park north-east of Odeonsplatz and smaller
// green patches in other directions that a good planner must not prefer.
const ring = (points) =>
  [...points, points[0]].map(([lon, lat]) => ({ lat, lon }));
const way = (name, tags, points) => ({
  type: "way",
  tags: { ...tags, ...(name ? { name } : {}) },
  geometry: ring(points),
});
export const odeonsplatz = [11.577, 48.142];
export const englischerGartenSouth = [
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
];
export const englischerGartenNorth = [
  [11.5905, 48.1662],
  [11.601, 48.1662],
  [11.608, 48.175],
  [11.612, 48.185],
  [11.606, 48.188],
  [11.6, 48.18],
  [11.593, 48.172],
];
export const munichParks = {
  elements: [
    way("Englischer Garten", { leisure: "park" }, englischerGartenSouth),
    // Split by the Isarring, like the real park; members of one relation.
    {
      type: "relation",
      tags: { leisure: "park", name: "Englischer Garten" },
      members: [
        {
          type: "way",
          role: "outer",
          geometry: ring(englischerGartenNorth).slice(0, 4),
        },
        {
          type: "way",
          role: "outer",
          geometry: ring(englischerGartenNorth).slice(3),
        },
      ],
    },
    way("Kleinhesseloher See", { natural: "water" }, [
      [11.5915, 48.1555],
      [11.5965, 48.1555],
      [11.5965, 48.159],
      [11.5915, 48.159],
    ]),
    way("Hofgarten", { leisure: "park" }, [
      [11.578, 48.1422],
      [11.5825, 48.1422],
      [11.5825, 48.144],
      [11.578, 48.144],
    ]),
    way("Alter Botanischer Garten", { leisure: "park" }, [
      [11.5625, 48.1418],
      [11.5665, 48.1418],
      [11.5665, 48.1435],
      [11.5625, 48.1435],
    ]),
    way("Maximiliansanlagen", { leisure: "park" }, [
      [11.5905, 48.132],
      [11.594, 48.1325],
      [11.598, 48.145],
      [11.5945, 48.1455],
    ]),
    way("Luitpoldpark", { leisure: "park" }, [
      [11.567, 48.168],
      [11.574, 48.168],
      [11.574, 48.173],
      [11.567, 48.173],
    ]),
    // Tiny unnamed square in the Altstadt.
    way(null, { leisure: "park" }, [
      [11.571, 48.1375],
      [11.5725, 48.1375],
      [11.5725, 48.1383],
      [11.571, 48.1383],
    ]),
    { type: "node", tags: { leisure: "park" } },
  ],
};
/** Point-in-polygon on lon/lat rings. */
export function inside([x, y], polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}
/** Fake ORS directions: straight legs through the waypoints, densified. */
export function fakeDirections(coordinates, detour = 1.3) {
  const out = [];
  let straight = 0;
  for (let k = 1; k < coordinates.length; k++) {
    const [a, b] = [coordinates[k - 1], coordinates[k]];
    const kx = 111320 * Math.cos((a[1] * Math.PI) / 180);
    straight += Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540);
    for (let s = 0; s < 20; s++)
      out.push([
        a[0] + ((b[0] - a[0]) * s) / 20,
        a[1] + ((b[1] - a[1]) * s) / 20,
      ]);
  }
  out.push(coordinates.at(-1));
  return {
    features: [
      {
        geometry: { coordinates: out },
        properties: {
          summary: { distance: Math.round(straight * detour) },
          extras: {
            green: { values: [[0, out.length - 1, 8]] },
            noise: { values: [[0, out.length - 1, 2]] },
            waytypes: { values: [[0, out.length - 1, 4]] },
          },
        },
      },
    ],
  };
}
