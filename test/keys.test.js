import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { singleWriter } from "../src/store/single-writer.js";
import { createProduct, listProducts } from "../src/products.js";
import { createViewerServer } from "../src/server.js";
import { createAuth, sealSession } from "../src/auth.js";
import { createKeys, isLoopback } from "../src/keys.js";
import { remoteStore } from "../src/remote.js";

const root = await mkdtemp(join(tmpdir(), "screenbook-keys-"));
const disk = localStore(join(root, "store"));
await createProduct(disk, { name: "Shop" });
const store = singleWriter(disk);
const secret = "session-secret";
const auth = createAuth({ clientId: "id", clientSecret: "secret", sessionSecret: secret, publicUrl: null, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
const server = createViewerServer({ store, auth });
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const session = `screenbook_session=${sealSession({ login: "maria", name: "Maria" }, secret)}`;

async function approve(link) {
  const page = new URL(link);
  const form = new URLSearchParams({ callback: page.searchParams.get("callback"), state: page.searchParams.get("state"), label: "laptop" });
  const response = await fetch(`${base}/connect`, { method: "POST", redirect: "manual", headers: { Cookie: session, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  assert.equal(response.status, 303);
  return new URL(response.headers.get("location")).searchParams.get("key");
}

test("only a loopback address can receive a key", () => {
  assert.equal(isLoopback("http://127.0.0.1:5000/callback"), true);
  assert.equal(isLoopback("http://localhost:5000/cb"), true);
  assert.equal(isLoopback("https://evil.example/cb"), false);
  assert.equal(isLoopback("http://127.0.0.1/cb"), false);
});

test("without a session the connect page sends the person to log in first", async () => {
  const response = await fetch(`${base}/connect?callback=${encodeURIComponent("http://127.0.0.1:5000/callback")}&state=abcdefgh12`, { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /^\/auth\/login\?next=%2Fconnect/);
});

test("a chat connects once through the browser and keeps its own key, without GitHub", async () => {
  const file = join(root, "credentials.json");
  const links = [];
  const connect = async (url) => {
    const state = "state-12345";
    const link = `${url}/connect?callback=${encodeURIComponent("http://127.0.0.1:5999/callback")}&state=${state}`;
    links.push(link);
    return approve(link);
  };
  const first = remoteStore(base, { file, connect });
  assert.deepEqual((await listProducts(first)).map((item) => item.id), ["shop"]);
  assert.equal(links.length, 1);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.match(saved[new URL(base).origin], /^sbk_/);
  const second = remoteStore(base, { file, connect });
  await listProducts(second);
  assert.equal(links.length, 1, "the saved key is reused, no second login");
  const revoked = await fetch(`${base}/api/keys/revoke`, { method: "POST", headers: { Cookie: session } });
  assert.equal((await revoked.json()).revoked, 1);
  const third = remoteStore(base, { file, connect });
  await listProducts(third);
  assert.equal(links.length, 2, "a revoked key asks for a new login");
});

test("a key stops working when it expires", async () => {
  let clock = Date.now();
  const keys = createKeys({ store, now: () => clock });
  const key = await keys.mint({ login: "ana" });
  assert.equal((await keys.userOf(key)).login, "ana");
  clock += 181 * 86400 * 1000;
  assert.equal(await keys.userOf(key), null);
  assert.equal(await keys.userOf("ghp_not_a_screenbook_key"), null);
});
