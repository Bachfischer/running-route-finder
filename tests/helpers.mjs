export function grid({
  size = 18,
  spacing = 0.002,
  center = [11.58, 48.14],
} = {}) {
  const elements = [],
    width = size * 2 + 1;
  for (let y = -size; y <= size; y++)
    for (let x = -size; x <= size; x++) {
      const id = (y + size) * width + x + size + 1;
      elements.push({
        type: "node",
        id,
        lon: center[0] + x * spacing,
        lat: center[1] + y * spacing * 0.7,
      });
      if (x < size)
        elements.push({
          type: "way",
          id: 100000 + id,
          nodes: [id, id + 1],
          tags: { highway: "footway" },
        });
      if (y < size)
        elements.push({
          type: "way",
          id: 200000 + id,
          nodes: [id, id + width],
          tags: { highway: "residential" },
        });
    }
  return elements;
}
export function routeRequest(
  body = { lat: 48.14, lon: 11.58, distance: 10, direction: "Any" },
  ip = "test",
) {
  return new Request("https://loop.test/api/loops", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}
export const result = {
  routes: [
    {
      coordinates: [
        [11, 48],
        [11.001, 48],
        [11, 48],
      ],
      distance: 10000,
      repeat: 0,
      paths: 1,
      score: 0,
      bearing: 0,
    },
  ],
  snapDistance: 0,
  candidates: 18,
};
export function streamResponse(chunks, headers = {}) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks)
          c.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        c.close();
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers },
  );
  return { response, cancelled: () => cancelled };
}
