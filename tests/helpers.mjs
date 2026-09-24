export function routeRequest(
  body = { lat: 48.14, lon: 11.58, distance: 10, direction: "Any" },
  ip = "test",
) {
  return new Request("https://loop.test/api/loops", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}
export const result = {
  routes: [
    {
      coordinates: [
        [11.577, 48.142],
        [11.58, 48.18],
        [11.577, 48.142],
      ],
      distance: 10100,
      bearing: 0,
      score: -0.4,
    },
  ],
  quality: [{ green: 0.76, quiet: 0.84 }],
  snapDistance: 0,
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
