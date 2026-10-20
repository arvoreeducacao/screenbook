import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/;

export function accountKey(login) {
  const clean = String(login ?? "").toLowerCase();
  if (!LOGIN.test(clean)) throw Object.assign(new Error("invalid account"), { status: 400 });
  return clean;
}

export function vaultKey(secret) {
  if (!secret) return randomBytes(32);
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from("screenbook"), Buffer.from("claude-credentials"), 32));
}

export function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

export function unseal(text, key) {
  const box = JSON.parse(text);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
}

export function createVault({ store, secret }) {
  const key = vaultKey(secret);
  const folder = (login) => `_accounts/${accountKey(login)}`;

  async function readJson(path) {
    const raw = await store.read(path);
    if (!raw || !raw.length) return null;
    return JSON.parse(raw.toString("utf8"));
  }

  return {
    async load(login) {
      const raw = await store.read(`${folder(login)}/claude.enc`);
      if (!raw || !raw.length) return null;
      try {
        return unseal(raw.toString("utf8"), key);
      } catch {
        return null;
      }
    },
    async save(login, files) {
      await store.write(`${folder(login)}/claude.enc`, Buffer.from(seal(files, key)));
    },
    async clear(login) {
      await store.write(`${folder(login)}/claude.enc`, Buffer.alloc(0));
    },
    async chat(login, product) {
      return (await readJson(`${folder(login)}/chats/${product}.json`)) ?? { session: null, messages: [] };
    },
    async prefs(login) {
      return (await readJson(`${folder(login)}/prefs.json`)) ?? {};
    },
    async savePrefs(login, prefs) {
      await store.write(`${folder(login)}/prefs.json`, Buffer.from(JSON.stringify(prefs)));
    },
    async saveChat(login, product, chat) {
      await store.write(`${folder(login)}/chats/${product}.json`, Buffer.from(JSON.stringify(chat)));
    },
  };
}
