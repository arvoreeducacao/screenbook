import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";
import { createAuth, sealSession } from "../src/auth.js";
import { createProduct, productBooks } from "../src/products.js";

const SECRET = "test-secret";
const dir = await mkdtemp(join(tmpdir(), "screenbook-share-"));
const store = localStore(dir);
await createProduct(store, { name: "CRM", id: "crm" });
const book = await productBooks(store)("crm");
await book.writeScreen({ proposal: "kpis", name: "Home", section: "Main", html: "<p data-el='total'>1</p>" });
await book.approve("kpis", "Marina");
await book.writeScreen({ proposal: "kpis-2", screen: "home", html: "<p data-el='total'>2</p>" });
await book.writeScreen({ proposal: "segredo", name: "Settings", section: "Admin", html: "<p>secret</p>" });

const auth = createAuth({ clientId: "id", clientSecret: "secret", sessionSecret: SECRET, publicUrl: "https://sb.example.com" });
const server = createViewerServer({ store, auth });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const session = { Cookie: `screenbook_session=${encodeURIComponent(sealSession({ login: "marina", name: "Marina" }, SECRET))}` };
const json = { "Content-Type": "application/json" };

async function share(proposal) {
  const response = await fetch(`${base}/crm/api/proposals/${proposal}/share`, { method: "POST", headers: { ...session, ...json }, body: "{}" });
  assert.equal(response.status, 201);
  return response.json();
}

test("only a signed-in person opens a link", async () => {
  const response = await fetch(`${base}/crm/api/proposals/kpis-2/share`, { method: "POST", headers: json, body: "{}" });
  assert.equal(response.status, 401);
});

test("the link shows its proposal without signing in, and nothing else", async () => {
  const entry = await share("kpis-2");
  assert.equal(entry.by, "Marina");
  assert.equal(entry.path, `/crm/s/${entry.token}/`);
  assert.equal(Date.parse(entry.expiresAt) - Date.parse(entry.at), 30 * 86400 * 1000);

  const page = await fetch(`${base}${entry.path}`, { redirect: "manual" });
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(`content="/crm/s/${entry.token}"`));
  assert.equal((await fetch(`${base}/app.js`, { redirect: "manual" })).status, 200);

  const me = await (await fetch(`${base}${entry.path}api/me`)).json();
  assert.deepEqual(me.share, { proposal: "kpis-2", expiresAt: entry.expiresAt });

  const overview = await (await fetch(`${base}${entry.path}api/overview`)).json();
  assert.deepEqual(overview.screens.map((screen) => [screen.id, screen.versions.map((version) => version.v)]), [["home", [1, 2]]]);
  assert.deepEqual(overview.proposals.map((proposal) => proposal.id), ["kpis-2"]);
  assert.deepEqual(overview.shares, []);

  assert.equal((await fetch(`${base}${entry.path}api/screens/home/v2.html`)).status, 200);
  assert.equal((await fetch(`${base}${entry.path}api/screens/settings/v1.html`)).status, 404);
  assert.equal((await fetch(`${base}${entry.path}api/screens/home/v2.source`)).status, 404);
  assert.equal((await fetch(`${base}${entry.path}api/proposals/kpis-2/approve`, { method: "POST", headers: json, body: "{}" })).status, 404);
  assert.equal((await fetch(`${base}/crm/api/overview`, { headers: { Cookie: "" } })).status, 401);
});

test("a visitor comments by name, and the comment wakes nobody", async () => {
  const entry = await share("kpis-2");
  const posted = await fetch(`${base}${entry.path}api/comments`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ screen: "home", el: "total", version: 2, text: "@claude bigger", author: "Ana from the shop", kind: "agent" }),
  });
  assert.equal(posted.status, 201);
  const comment = await posted.json();
  assert.equal(comment.kind, "guest");
  assert.equal(comment.author, "Ana from the shop");
  assert.deepEqual(await book.pendingMentions("claude"), []);

  const elsewhere = await fetch(`${base}${entry.path}api/comments`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ screen: "settings", version: 1, text: "hi", author: "Ana" }),
  });
  assert.equal(elsewhere.status, 404);
  const nameless = await fetch(`${base}${entry.path}api/comments`, { method: "POST", headers: json, body: JSON.stringify({ screen: "home", version: 2, text: "hi" }) });
  assert.equal(nameless.status, 400);
});

test("a revoked or expired link stops working", async () => {
  const entry = await share("kpis-2");
  const revoked = await fetch(`${base}/crm/api/shares/${entry.token}/revoke`, { method: "POST", headers: { ...session, ...json }, body: "{}" });
  assert.equal((await revoked.json()).revoked.by, "Marina");
  assert.equal((await fetch(`${base}${entry.path}`)).status, 404);
  assert.equal((await fetch(`${base}${entry.path}api/overview`)).status, 404);

  const old = await share("kpis-2");
  await book.writeJson(`shares/${old.token}.json`, { ...old, path: undefined, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await fetch(`${base}${old.path}api/overview`)).status, 404);
  assert.equal((await fetch(`${base}/crm/s/this-link-does-not-exist/api/overview`)).status, 404);
});

test("the people with access see the open links in the overview", async () => {
  const entry = await share("kpis-2");
  const overview = await (await fetch(`${base}/crm/api/overview`, { headers: session })).json();
  assert.ok(overview.shares.some((item) => item.token === entry.token));
});

test("a link to an approved proposal shows the version it pinned and the official one", async () => {
  const solo = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-share-approved-"))));
  await solo.init({ name: "Solo" });
  await solo.writeScreen({ proposal: "first", name: "List", section: "Deals", html: "<p>a</p>" });
  await solo.approve("first", "Marina");
  await solo.writeScreen({ proposal: "second", screen: "list", html: "<p>b</p>" });
  await solo.writeScreen({ proposal: "second", screen: "list", html: "<p>c</p>" });
  await solo.approve("second", "Rafa");
  const entry = await solo.share({ proposal: "first", by: "Marina" });
  const opened = await solo.openShare(entry.token);
  const overview = await solo.sharedOverview(opened);
  assert.deepEqual(overview.proposals.map((proposal) => [proposal.id, proposal.status]), [["first", "approved"]]);
  assert.deepEqual(overview.screens[0].versions.map((version) => version.v), [1, 3]);
  await assert.rejects(solo.sharedScreen(opened, "list", 2), /no version 2/);
});

test("archiving the proposal closes its links", async () => {
  const solo = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-share-solo-"))));
  await solo.init({ name: "Solo" });
  await solo.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  const entry = await solo.share({ proposal: "p", by: "Marina" });
  assert.ok(await solo.openShare(entry.token));
  await solo.archive({ proposal: "p", by: "Marina", reason: "not building" });
  assert.equal(await solo.openShare(entry.token), null);
});

test("a visitor cannot resolve a conversation, a signed-in person resolves it in their own name", async () => {
  const entry = await share("kpis-2");
  const root = await book.comment({ screen: "home", el: "total", version: 2, text: "bigger", author: "Bia" });
  const fromLink = await fetch(`${base}${entry.path}api/comments/${root.id}/resolve`, { method: "POST", headers: json, body: JSON.stringify({ by: "Ana" }) });
  assert.equal(fromLink.status, 404);
  assert.equal((await book.comments("home")).find((item) => item.id === root.id).resolved, undefined);
  const signed = await fetch(`${base}/crm/api/comments/${root.id}/resolve`, { method: "POST", headers: { ...session, ...json }, body: JSON.stringify({ by: "Other" }) });
  assert.equal((await signed.json()).resolved.by, "Marina");
});
