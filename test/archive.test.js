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
const store = localStore(await mkdtemp(join(tmpdir(), "screenbook-archive-")));
await createProduct(store, { name: "Shipping", id: "shipping" });
const book = await productBooks(store)("shipping");
await book.writeScreen({ proposal: "checkout-flow", name: "Signup", section: "Entry", html: "<p data-el='form'>a</p>" });
await book.writeScreen({ proposal: "checkout-flow", name: "Welcome", section: "Entry", html: "<p>b</p>" });
await book.writeScreen({ proposal: "approved", name: "Home", section: "Account", html: "<p>c</p>" });
await book.approve("approved", "Marina");

const auth = createAuth({ clientId: "id", clientSecret: "secret", sessionSecret: SECRET, publicUrl: "https://sb.example.com" });
const server = createViewerServer({ store, auth });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const session = { Cookie: `screenbook_session=${encodeURIComponent(sealSession({ login: "bob", name: "Bob" }, SECRET))}` };
const json = { "Content-Type": "application/json" };

function post(path, body, headers = { ...session, ...json }) {
  return fetch(`${base}/shipping${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("archiving or restoring without a session is refused", async () => {
  assert.equal((await post("/api/proposals/checkout-flow/archive", { by: "Intruder" }, json)).status, 401);
  assert.equal((await post("/api/proposals/checkout-flow/restore", { by: "Intruder" }, json)).status, 401);
  assert.equal((await book.proposal("checkout-flow")).status, "open");
});

test("the signed-in person archives a proposal, whatever the body says, and restores it", async () => {
  const archived = await post("/api/proposals/checkout-flow/archive", { by: "Another person", reason: "  let us redo it in high fidelity  " });
  assert.equal(archived.status, 200);
  const { archived: stamp } = await archived.json();
  assert.equal(stamp.by, "Bob");
  assert.equal(stamp.reason, "let us redo it in high fidelity");

  const overview = await (await fetch(`${base}/shipping/api/overview`, { headers: session })).json();
  const record = overview.proposals.find((proposal) => proposal.id === "checkout-flow");
  assert.equal(record.status, "archived");
  assert.deepEqual(record.screens, { signup: 1, "welcome": 1 });
  assert.equal((await fetch(`${base}/shipping/api/screens/signup/v1.html`, { headers: session })).status, 200);

  const restored = await post("/api/proposals/checkout-flow/restore", {});
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), { proposal: "checkout-flow", restored: true });
  const back = await book.proposal("checkout-flow");
  assert.equal(back.status, "open");
  assert.equal(back.archived, undefined);
});

test("the reason is optional from the browser", async () => {
  const response = await post("/api/proposals/checkout-flow/archive", {});
  assert.equal(response.status, 200);
  const record = await book.proposal("checkout-flow");
  assert.equal(record.archived.by, "Bob");
  assert.equal("reason" in record.archived, false);
  await post("/api/proposals/checkout-flow/restore", {});
});

test("an approved proposal cannot be archived, and an open one cannot be restored", async () => {
  const approved = await post("/api/proposals/approved/archive", {});
  assert.equal(approved.status, 400);
  assert.match((await approved.json()).error, /approved/);
  const open = await post("/api/proposals/checkout-flow/restore", {});
  assert.equal(open.status, 400);
  assert.match((await open.json()).error, /not archived/);
  assert.equal((await post("/api/proposals/missing/archive", {})).status, 404);
});

test("an archived screen comes back from the browser and the overview says which version it had", async () => {
  await book.archive({ screen: "welcome", by: "claude", reason: "left the flow" });
  const before = await (await fetch(`${base}/shipping/api/overview`, { headers: session })).json();
  assert.deepEqual(before.archived.map((entry) => [entry.id, entry.version, entry.by, entry.reason]), [["welcome", 1, "claude", "left the flow"]]);
  assert.equal((await post("/api/screens/welcome/restore", {})).status, 200);
  const after = await (await fetch(`${base}/shipping/api/overview`, { headers: session })).json();
  assert.equal(after.archived.length, 0);
  assert.ok(after.screens.some((screen) => screen.id === "welcome"));
});

test("a public link cannot archive or restore", async () => {
  const entry = await book.share({ proposal: "checkout-flow", by: "Bob" });
  const link = `${base}/shipping/s/${entry.token}`;
  const archive = await fetch(`${link}/api/proposals/checkout-flow/archive`, { method: "POST", headers: json, body: "{}" });
  assert.equal(archive.status, 404);
  const restore = await fetch(`${link}/api/proposals/checkout-flow/restore`, { method: "POST", headers: json, body: "{}" });
  assert.equal(restore.status, 404);
  assert.equal((await book.proposal("checkout-flow")).status, "open");
});

test("the book archives a proposal without a reason and restore takes it back", async () => {
  const solo = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-archive-solo-"))));
  await solo.init({ name: "Solo" });
  await solo.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  const result = await solo.archive({ proposal: "p", by: "Ana" });
  assert.deepEqual(Object.keys(result.archived).sort(), ["at", "by"]);
  await assert.rejects(solo.archive({ proposal: "p" }), /needs a name/);
  await solo.restore({ proposal: "p", by: "Ana" });
  assert.equal((await solo.proposal("p")).status, "open");
});
