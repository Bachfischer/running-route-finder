import { MapCapacityError, ProviderError } from "./errors.ts";
export type Fetcher = typeof fetch;
export function provider(name: string, fallback: string) {
  const u = new URL(process.env[name] || fallback);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new ProviderError("Map provider configuration is invalid.");
  return u;
}
export async function readTextBounded(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("The map service returned empty data.");
  try {
    if (Number(response.headers.get("content-length") || 0) > maxBytes)
      throw new MapCapacityError();
    const decoder = new TextDecoder();
    let text = "",
      bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new MapCapacityError();
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function jsonFetch(
  url: URL | string,
  init: RequestInit = {},
  maxBytes = 18_000_000,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  let res: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "LoopRunningRouteFinder/1.1");
    headers.set("Accept", "application/json");
    res = await fetcher(url, {
      ...init,
      signal: init.signal || AbortSignal.timeout(40000),
      headers,
    });
  } catch (e) {
    if (e instanceof Error && ["AbortError", "TimeoutError"].includes(e.name))
      throw new ProviderError("The map service timed out. Please try again.");
    throw new ProviderError(
      "Could not reach the map service. Please try again.",
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ProviderError(
      "The map data service is busy. Please try again in a minute.",
      res.status === 429 ? 429 : 503,
    );
  }
  try {
    return JSON.parse(await readTextBounded(res, maxBytes));
  } catch (e) {
    if (e instanceof MapCapacityError || e instanceof ProviderError) throw e;
    if (e instanceof Error && ["AbortError", "TimeoutError"].includes(e.name))
      throw new ProviderError("The map service timed out. Please try again.");
    throw new ProviderError(
      "The map service returned incomplete data. Please try again.",
    );
  }
}
export function createCooldown(now: () => number = Date.now) {
  const recent = new Map<string, number>();
  return (req: Request, kind: string, ms: number) => {
    const key = kind + ":" + (req.headers.get("x-real-ip") || "local");
    const time = now();
    if ((recent.get(key) || 0) > time) return true;
    if (recent.size >= 1000) {
      for (const [k, v] of recent) if (v <= time) recent.delete(k);
      if (recent.size >= 1000) return true;
    }
    recent.set(key, time + ms);
    return false;
  };
}
