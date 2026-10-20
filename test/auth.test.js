import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";
import { createAuth, sealSession, openSession } from "../src/auth.js";
import { appJwt } from "../src/github-app.js";
import { appManifest } from "../src/create-app.js";

const SECRET = "test-secret";

test("a session survives only with the right secret and before it expires", () => {
  const token = sealSession({ login: "alice", name: "Alice" }, SECRET, 0);
  assert.equal(openSession(token, SECRET, 1000).login, "alice");
  assert.equal(openSession(token, "other", 1000), null);
  assert.equal(openSession(token.replace(/.$/, "x"), SECRET, 1000), null);
  assert.equal(openSession(token, SECRET, 15 * 86400 * 1000), null);
});

test("the app token is a valid RS256 JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = appJwt({ appId: 42, privateKey: privateKey.export({ type: "pkcs1", format: "pem" }), now: 1_000_000_000 });
  const [header, payload, signature] = jwt.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, "base64url")));
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, "42");
});

test("the app manifest asks only for contents and metadata", () => {
  const manifest = appManifest({ name: "Screenbook", publicUrl: "https://sb.example.com", localPort: 4699 });
  assert.deepEqual(manifest.default_permissions, { contents: "write", metadata: "read" });
  assert.ok(manifest.callback_urls.includes("https://sb.example.com/auth/callback"));
  assert.equal(manifest.public, false);
});

const dir = await mkdtemp(join(tmpdir(), "screenbook-auth-"));
const store = localStore(dir);
const book = new Book(store);
await book.init({ name: "CRM" });
await book.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<p data-el='row'>a</p>" });
const auth = createAuth({ clientId: "id", clientSecret: "secret", sessionSecret: SECRET, publicUrl: "https://sb.example.com" });
const server = createViewerServer({ store, auth });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const session = `screenbook_session=${encodeURIComponent(sealSession({ login: "marina", name: "Marina Souza" }, SECRET))}`;

test("without a session the page redirects to the GitHub login and the API refuses", async () => {
  const page = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/auth/login?next=%2F");
  const login = await fetch(`${base}/auth/login`, { redirect: "manual" });
  assert.match(login.headers.get("location"), /^https:\/\/github\.com\/login\/oauth\/authorize\?client_id=id/);
  assert.match(login.headers.get("set-cookie"), /screenbook_state=.*Secure/);
  assert.equal((await fetch(`${base}/api/overview`)).status, 401);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

test("after the login, people land on the link they opened", async () => {
  const deep = await fetch(`${base}/?proposal=first-screens`, { redirect: "manual" });
  const loginPath = deep.headers.get("location");
  assert.equal(loginPath, "/auth/login?next=%2F%3Fproposal%3Dfirst-screens");
  const github = async (url) =>
    new Response(JSON.stringify(String(url).includes("access_token") ? { access_token: "t" } : { login: "marina", name: "Marina" }), { status: 200 });
  const loginAuth = createAuth({ clientId: "id", clientSecret: "secret", sessionSecret: SECRET, publicUrl: "https://sb.example.com", fetchImpl: github });
  const loginServer = createViewerServer({ store, auth: loginAuth });
  await new Promise((resolve) => loginServer.listen(0, "127.0.0.1", resolve));
  const loginBase = `http://127.0.0.1:${loginServer.address().port}`;
  try {
    const login = await fetch(`${loginBase}${loginPath}`, { redirect: "manual" });
    const jar = login.headers.getSetCookie().map((line) => line.split(";")[0]);
    const state = jar.find((pair) => pair.startsWith("screenbook_state=")).split("=")[1];
    const callback = await fetch(`${loginBase}/auth/callback?code=c&state=${state}`, { redirect: "manual", headers: { cookie: jar.join("; ") } });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "/?proposal=first-screens");

    const evil = await fetch(`${loginBase}/auth/login?next=${encodeURIComponent("//evil.example.com")}`, { redirect: "manual" });
    const evilJar = evil.headers.getSetCookie().map((line) => line.split(";")[0]);
    const evilState = evilJar.find((pair) => pair.startsWith("screenbook_state=")).split("=")[1];
    const evilCallback = await fetch(`${loginBase}/auth/callback?code=c&state=${evilState}`, { redirect: "manual", headers: { cookie: evilJar.join("; ") } });
    assert.equal(evilCallback.headers.get("location"), "/");
  } finally {
    loginServer.close();
  }
});

test("a callback with the wrong state is refused", async () => {
  const response = await fetch(`${base}/auth/callback?code=x&state=bad`, { headers: { cookie: "screenbook_state=good" } });
  assert.equal(response.status, 400);
});

test("with a session, comments carry the GitHub name, whatever the body says", async () => {
  const me = await (await fetch(`${base}/api/me`, { headers: { cookie: session } })).json();
  assert.equal(me.user.login, "marina");
  const posted = await fetch(`${base}/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: session },
    body: JSON.stringify({ screen: "list", el: "row", text: "hi", author: "Someone Else" }),
  });
  assert.equal((await posted.json()).author, "Marina Souza");
});

test("the chat's GitHub token reaches only the presence door, and only for people who can read the store", async () => {
  const seen = [];
  const github = async (url, { headers }) => {
    seen.push(headers.Authorization);
    const login = headers.Authorization === "Bearer good" ? "marina" : "intruder";
    return new Response(JSON.stringify({ login, name: login }), { status: 200 });
  };
  const tokenAuth = createAuth({ clientId: "id", clientSecret: "secret", sessionSecret: SECRET, canRead: async (login) => login === "marina", fetchImpl: github });
  const tokenServer = createViewerServer({ store, auth: tokenAuth });
  await new Promise((resolve) => tokenServer.listen(0, "127.0.0.1", resolve));
  const tokenBase = `http://127.0.0.1:${tokenServer.address().port}`;
  const presence = (token) =>
    fetch(`${tokenBase}/api/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ handle: "claude", session: "chat-one", action: "drawing" }),
    });
  try {
    assert.equal((await presence("good")).status, 204);
    assert.equal((await presence("good")).status, 204);
    assert.equal(seen.filter((header) => header === "Bearer good").length, 1);
    assert.equal((await presence("bad")).status, 401);
    assert.equal((await fetch(`${tokenBase}/api/overview`, { headers: { Authorization: "Bearer good" } })).status, 401);
  } finally {
    tokenServer.close();
  }
});
