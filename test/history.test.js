import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";

const dir = await mkdtemp(join(tmpdir(), "screenbook-history-"));
const store = localStore(dir);
const book = new Book(store);
await book.init({ name: "CRM" });
await book.writeScreen({ proposal: "first", name: "List", section: "Deals", html: "<p data-el='row'>one</p>", width: 390, height: 844 });
await book.savePng("list", 1, Buffer.from("png-one"));
await book.approve("first", "Marina");
await book.writeScreen({ proposal: "second", screen: "list", html: "<p data-el='row'>two</p>" });

const server = createViewerServer({ store });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

function post(path, body) {
  return fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("restoring an old version adds it back as a new version in its own proposal", async () => {
  const response = await post("/api/screens/list/revert", { version: 1, by: "Marina" });
  assert.equal(response.status, 201);
  const restored = await response.json();
  assert.equal(restored.version, 3);
  assert.equal(restored.restoredFrom, 1);
  assert.equal(restored.proposal, "restore-list");
  assert.equal(await book.screenHtml("list", 3), "<p data-el='row'>one</p>");
  const meta = await book.screen("list");
  assert.equal(meta.official, 1);
  assert.deepEqual(meta.versions.at(-1), { ...meta.versions.at(-1), v: 3, width: 390, height: 844, restoredFrom: 1, by: "Marina" });
  assert.equal((await book.png("list", 3)).toString(), "png-one");
  const proposal = await book.proposal("restore-list");
  assert.equal(proposal.screens.list, 3);
  assert.match(proposal.title, /v1/);
});

test("restoring the latest version or a missing one is refused", async () => {
  assert.equal((await post("/api/screens/list/revert", { version: 3, by: "Marina" })).status, 400);
  assert.equal((await post("/api/screens/list/revert", { version: 9, by: "Marina" })).status, 404);
  await assert.rejects(book.revert({ screen: "list", version: 1 }), /name/);
});

test("the screen html carries the inspect bridge and the export downloads it without any bridge", async () => {
  const live = await (await fetch(`${base}/api/screens/list/v2.html`)).text();
  assert.match(live, /sb-inspect-pick/);
  assert.match(live, /sb-play-go/);
  const response = await fetch(`${base}/api/screens/list/v2.export.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="list-v2.html"/);
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  const html = await response.text();
  assert.match(html, /two/);
  assert.doesNotMatch(html, /<script/);
});

test("a screen with $ patterns keeps them when the bridges are added", async () => {
  await book.writeScreen({ proposal: "second", screen: "list", html: "<body><p data-el='row'>R$ 10 $&</p></body>" });
  const html = await (await fetch(`${base}/api/screens/list/v4.html`)).text();
  assert.match(html, /R\$ 10 \$&/);
});

test("the viewer modules are served", async () => {
  for (const file of ["devmode.css", "inspect.js", "history.js", "present.js", "export.js"]) {
    assert.equal((await fetch(`${base}/${file}`)).status, 200, file);
  }
});
