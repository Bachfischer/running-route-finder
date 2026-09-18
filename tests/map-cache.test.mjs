import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { cachedAreaLoader, memoryMapStore } from "../lib/map-cache.ts";
const area = { center: [11.577, 48.142], radius: 2650 };
const data = [{ type: "node", id: 1, lat: 48.142, lon: 11.577 }];
const signal = () => new AbortController().signal;
test("changing map provider invalidates the cached query", async () => {
  const before = process.env.OVERPASS_URL;
  const s = setup();
  try {
    process.env.OVERPASS_URL = "https://one.example/api";
    await s.load(area, signal());
    process.env.OVERPASS_URL = "https://two.example/api";
    await s.load(area, signal());
    assert.equal(s.calls(), 2);
  } finally {
    if (before === undefined) delete process.env.OVERPASS_URL;
    else process.env.OVERPASS_URL = before;
  }
});
function setup(options = {}) {
  const store = memoryMapStore();
  let calls = 0;
  const load = cachedAreaLoader(store, {
    load: async () => {
      calls++;
      return structuredClone(data);
    },
    ...options,
  });
  return { load, store, calls: () => calls };
}
test("repeated map searches reuse data without sharing mutable objects", async () => {
  const s = setup();
  (await s.load(area, signal()))[0].id = 99;
  assert.deepEqual(await s.load(area, signal()), data);
  assert.equal(s.calls(), 1);
});
test("different areas and radii never collide", async () => {
  const s = setup();
  await s.load(area, signal());
  await s.load({ ...area, radius: 2000 }, signal());
  await s.load({ ...area, center: [11.6, 48.2] }, signal());
  assert.equal(s.calls(), 3);
});
test("expiry reloads even when the backing store retains stale entries", async () => {
  let time = 1000;
  const s = setup({ now: () => time, ttl: 1 });
  await s.load(area, signal());
  time = 1999;
  await s.load(area, signal());
  assert.equal(s.calls(), 1);
  time = 2000;
  await s.load(area, signal());
  assert.equal(s.calls(), 2);
});
test("bounded local cache evicts older entries", async () => {
  const store = memoryMapStore(2);
  await store.set("a", "A");
  await store.set("b", "B");
  await store.set("a", "new A");
  await store.set("c", "C");
  assert.equal(await store.get("b"), undefined);
  assert.equal(await store.get("a"), "new A");
});
for (const cached of [
  null,
  "bad json",
  "{}",
  JSON.stringify({ expires: Date.now() + 10000, body: "bad gzip" }),
  JSON.stringify({
    expires: Date.now() + 10000,
    body: gzipSync("{}").toString("base64"),
  }),
  "x".repeat(2000),
])
  test(`invalid cache entry is a miss: ${String(cached).slice(0, 50)}`, async () => {
    let calls = 0;
    const load = cachedAreaLoader(
      { get: async () => cached, set: async () => {} },
      {
        maxBytes: 1000,
        load: async () => {
          calls++;
          return data;
        },
      },
    );
    assert.deepEqual(await load(area, signal()), data);
    assert.equal(calls, 1);
  });
for (const mode of ["reject", "throw", "hang"])
  test(`cache ${mode} cannot break routing`, async () => {
    const operation = () => {
      if (mode === "throw") throw Error("offline");
      return mode === "reject"
        ? Promise.reject(Error("offline"))
        : new Promise(() => {});
    };
    const load = cachedAreaLoader(
      { get: operation, set: operation },
      { load: async () => data, timeout: 5 },
    );
    assert.deepEqual(await load(area, signal()), data);
  });
test("provider errors are not cached", async () => {
  let writes = 0;
  const load = cachedAreaLoader(
    {
      get: async () => undefined,
      set: async () => {
        writes++;
      },
    },
    {
      load: async () => {
        throw Error("provider down");
      },
    },
  );
  await assert.rejects(load(area, signal()), /provider down/);
  assert.equal(writes, 0);
});
test("invalid provider data is not cached", async () => {
  const s = setup({ load: async () => [{ id: "bad" }] });
  await assert.rejects(s.load(area, signal()), /invalid data/);
});
test("oversized compressed entries remain usable but are not cached", async () => {
  const s = setup({ maxBytes: 1 });
  assert.deepEqual(await s.load(area, signal()), data);
  await s.load(area, signal());
  assert.equal(s.calls(), 2);
});
test("oversized uncompressed entries skip compression and storage", async () => {
  const large = [{ ...data[0], tags: { name: "a".repeat(18_000_000) } }];
  const s = setup({ load: async () => large });
  assert.equal(await s.load(area, signal()), large);
});
test("decompression bomb is bounded and treated as a miss", async () => {
  const cached = JSON.stringify({
    expires: Date.now() + 10000,
    body: gzipSync("a".repeat(18_000_001)).toString("base64"),
  });
  const load = cachedAreaLoader(
    { get: async () => cached, set: async () => {} },
    { load: async () => data },
  );
  assert.deepEqual(await load(area, signal()), data);
});
test("abort before lookup prevents any provider work", async () => {
  const s = setup();
  await assert.rejects(s.load(area, AbortSignal.abort()), {
    name: "AbortError",
  });
  assert.equal(s.calls(), 0);
});
test("abort during cache lookup does not start a provider request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const load = cachedAreaLoader(
    {
      get: async () => {
        controller.abort();
      },
      set: async () => {},
    },
    {
      load: async () => {
        calls++;
        return data;
      },
    },
  );
  await assert.rejects(load(area, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
});
test("aborted provider result is not written", async () => {
  const controller = new AbortController();
  let writes = 0;
  const load = cachedAreaLoader(
    {
      get: async () => undefined,
      set: async () => {
        writes++;
      },
    },
    {
      load: async () => {
        controller.abort();
        return data;
      },
    },
  );
  await assert.rejects(load(area, controller.signal), { name: "AbortError" });
  assert.equal(writes, 0);
});
test("cache writes use hashed keys and the configured TTL", async () => {
  let record;
  const load = cachedAreaLoader(
    {
      get: async () => undefined,
      set: async (...args) => {
        record = args;
      },
    },
    { load: async () => data, ttl: 17 },
  );
  await load(area, signal());
  assert.match(record[0], /^[a-f0-9]{64}$/);
  assert.deepEqual(record[2], { ttl: 17 });
});
