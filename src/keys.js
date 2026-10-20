import { createHash, randomBytes } from "node:crypto";

const PREFIX = "sbk_";
const KEY_DAYS = 180;
const REMEMBERED = 500;

export function hashKey(key) {
  return createHash("sha256").update(String(key)).digest("hex");
}

export function isLoopback(callback) {
  try {
    const url = new URL(callback);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && Boolean(url.port);
  } catch {
    return false;
  }
}

function bearer(request) {
  return String(request.headers.authorization ?? "").match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

export function createKeys({ store, now = () => Date.now() }) {
  const known = new Map();

  async function read(hash) {
    if (known.has(hash)) return known.get(hash);
    const buffer = await store.read(`_keys/${hash}.json`);
    const record = buffer ? JSON.parse(buffer.toString("utf8")) : null;
    if (known.size >= REMEMBERED) known.clear();
    known.set(hash, record);
    return record;
  }

  return {
    async mint(user, label = "chat") {
      const key = `${PREFIX}${randomBytes(32).toString("base64url")}`;
      const hash = hashKey(key);
      const record = {
        login: user.login,
        name: user.name ?? user.login,
        avatar: user.avatar ?? null,
        label: String(label).slice(0, 80),
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + KEY_DAYS * 86400 * 1000).toISOString(),
      };
      await store.write(`_keys/${hash}.json`, `${JSON.stringify(record, null, 2)}\n`);
      known.set(hash, record);
      return key;
    },

    async userOf(key) {
      if (!String(key ?? "").startsWith(PREFIX)) return null;
      const record = await read(hashKey(key));
      if (!record || record.revokedAt || Date.parse(record.expiresAt) <= now()) return null;
      return { login: record.login, name: record.name, avatar: record.avatar };
    },

    async fromRequest(request) {
      const key = bearer(request);
      return key ? this.userOf(key) : null;
    },

    async revokeAll(login) {
      const paths = (await store.list("_keys")).filter((path) => path.endsWith(".json"));
      let revoked = 0;
      for (const path of paths) {
        const hash = path.slice("_keys/".length, -".json".length);
        const record = await read(hash);
        if (!record || record.login !== login || record.revokedAt) continue;
        const updated = { ...record, revokedAt: new Date(now()).toISOString() };
        await store.write(path, `${JSON.stringify(updated, null, 2)}\n`);
        known.set(hash, updated);
        revoked += 1;
      }
      return revoked;
    },
  };
}
