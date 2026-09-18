import { createHash } from "node:crypto";
import { setTimeout, clearTimeout } from "node:timers";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  elementsFrom,
  loadArea,
  mapQuery,
  type AreaLoader,
} from "./route-search.ts";
import { provider } from "./providers.ts";

export type MapStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { ttl: number }): Promise<unknown>;
};

// Bounded fallback for local development. Store compressed strings, never graphs.
export function memoryMapStore(limit = 4): MapStore {
  const entries = new Map<string, string>();
  return {
    async get(key) {
      return entries.get(key);
    },
    async set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
  };
}

// A cache outage must not become a route-search outage or consume its deadline.
async function optional<T>(
  operation: () => Promise<T>,
  timeout: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeout);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export function cachedAreaLoader(
  store: MapStore,
  {
    load = loadArea,
    now = Date.now,
    ttl = 900,
    maxBytes = 1_950_000,
    timeout = 250,
  }: {
    load?: AreaLoader;
    now?: () => number;
    ttl?: number;
    maxBytes?: number;
    timeout?: number;
  } = {},
): AreaLoader {
  return async (area, signal) => {
    signal.throwIfAborted();
    // Query and provider are part of the key: different footprints, schema or
    // providers must never share results. Keys contain no readable coordinates.
    const key = createHash("sha256")
      .update(
        "map-v1:" +
          provider("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
            .href +
          mapQuery(area),
      )
      .digest("hex");
    const cached = await optional(() => store.get(key), timeout);
    signal.throwIfAborted();
    if (typeof cached === "string" && Buffer.byteLength(cached) <= maxBytes) {
      try {
        const record = JSON.parse(cached);
        if (
          typeof record.expires === "number" &&
          record.expires > now() &&
          typeof record.body === "string"
        ) {
          return elementsFrom(
            JSON.parse(
              gunzipSync(Buffer.from(record.body, "base64"), {
                maxOutputLength: 18_000_000,
              }).toString(),
            ),
          );
        }
      } catch {
        /* Corrupt or outdated cache entries are ordinary misses. */
      }
    }
    const elements = await load(area, signal);
    signal.throwIfAborted();
    // Validate before writing; provider errors and partial data are never cached.
    elementsFrom({ elements });
    const raw = JSON.stringify({ elements });
    if (Buffer.byteLength(raw) <= 18_000_000) {
      const value = JSON.stringify({
        expires: now() + ttl * 1000,
        body: gzipSync(raw).toString("base64"),
      });
      if (Buffer.byteLength(value) <= maxBytes)
        await optional(() => store.set(key, value, { ttl }), timeout);
    }
    signal.throwIfAborted();
    return elements;
  };
}
