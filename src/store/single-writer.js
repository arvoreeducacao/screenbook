import { AsyncLocalStorage } from "node:async_hooks";

const CACHE_BYTES = 192 * 1024 * 1024;

export function singleWriter(store, { cacheBytes = CACHE_BYTES } = {}) {
  const cache = new Map();
  let cached = 0;
  let index = null;
  let chain = Promise.resolve();
  const inside = new AsyncLocalStorage();

  function remember(path, data) {
    const previous = cache.get(path);
    if (previous) cached -= previous.length;
    cache.delete(path);
    if (data && data.length > cacheBytes / 8) return;
    const value = data ?? Buffer.alloc(0);
    cache.set(path, data);
    cached += value.length;
    for (const [key, item] of cache) {
      if (cached <= cacheBytes) break;
      cache.delete(key);
      cached -= item?.length ?? 0;
    }
  }

  async function keys() {
    index ??= store.list("").then((found) => new Set(found));
    return index;
  }

  async function read(path) {
    if (cache.has(path)) {
      const data = cache.get(path);
      cache.delete(path);
      cache.set(path, data);
      return data;
    }
    const known = await keys();
    if (!known.has(path)) return null;
    const data = await store.read(path);
    remember(path, data);
    return data;
  }

  async function write(path, data) {
    const buffer = Buffer.from(data);
    await store.write(path, buffer);
    (await keys()).add(path);
    remember(path, buffer);
  }

  function transaction(message, work) {
    if (inside.getStore()) return work();
    const run = chain.then(() => inside.run(true, work));
    chain = run.catch(() => {});
    return run;
  }

  return {
    kind: store.kind,
    describe: () => store.describe(),
    read,
    write,
    append: (path, text) =>
      transaction(null, async () => {
        const current = (await read(path))?.toString("utf8") ?? "";
        await write(path, current + text);
      }),
    async list(prefix) {
      const known = await keys();
      const start = String(prefix ?? "").replace(/\/+$/, "");
      return [...known].filter((path) => start === "" || path === start || path.startsWith(`${start}/`)).sort();
    },
    transaction,
    canRead: store.canRead,
    token: store.token,
  };
}
