import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { scopedStore } from "../src/store/scoped.js";
import { Book } from "../src/book.js";
import { isMulti, listProducts } from "../src/products.js";
import { buildProductTools, skillText } from "../src/mcp.js";
import { createViewerServer } from "../src/server.js";
import { waitForMentions } from "../src/watch.js";
import { install } from "../src/install.js";
import { translate } from "../viewer/i18n.js";

const root = await mkdtemp(join(tmpdir(), "screenbook-multi-"));
const store = localStore(root);
const crm = new Book(scopedStore(store, "crm"));
const storefront = new Book(scopedStore(store, "storefront"));
await crm.init({ name: "CRM" });
await storefront.init({ name: "Storefront" });
await crm.writeScreen({ proposal: "paused", name: "Deal", section: "Deals", html: "<p data-el='x'>a</p>" });

test("a store with product folders and no root project is multi", async () => {
  assert.equal(await isMulti(store), true);
  assert.equal(await isMulti(scopedStore(store, "crm")), false);
  assert.deepEqual(await listProducts(store), [{ id: "crm", name: "CRM" }, { id: "storefront", name: "Storefront" }]);
});

test("the scoped store keeps each product in its folder", async () => {
  assert.ok(await store.read("crm/screens/deal/v1.html"));
  assert.equal(await store.read("storefront/screens/deal/meta.json"), null);
});

test("product tools ask for the product, and open_project without one lists them", async () => {
  const tools = buildProductTools(store, { render: async () => Buffer.from("png") });
  const listing = JSON.parse((await tools.open_project.run({})).content[0].text);
  assert.deepEqual(listing.products.map((item) => item.id), ["crm", "storefront"]);
  const written = await tools.write_screen.run({ product: "storefront", proposal: "p", name: "Home", section: "Customer", html: "<p>hi</p>" });
  assert.equal(JSON.parse(written.content[0].text).screen, "home");
  assert.equal((await storefront.screens()).length, 1);
  await assert.rejects(tools.read_screen.run({ product: "nope", screen: "home" }), /no product called "nope"/);
});

test("the skill travels with the MCP as its instructions", async () => {
  const instructions = await skillText();
  assert.match(instructions, /^# Screenbook/);
  assert.doesNotMatch(instructions, /^---/);
});

test("the watcher looks at every product and says which one", async () => {
  await crm.comment({ screen: "deal", el: "x", text: "@claude hi", author: "Ana" });
  const found = await waitForMentions({ store, handle: "claude", interval: 10, timeout: 500, out: { write() {} } });
  assert.equal(found.length, 1);
  assert.equal(found[0].product, "crm");
});

const server = createViewerServer({ store });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test("the home lists products and each product has its own viewer and API", async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /href="\/crm\/"/);
  const redirect = await fetch(`${base}/crm?proposal=paused`, { redirect: "manual" });
  assert.equal(redirect.headers.get("location"), "/crm/?proposal=paused");
  assert.match(await (await fetch(`${base}/crm/`)).text(), /<meta name="screenbook-base" content="\/crm">/);
  assert.equal((await (await fetch(`${base}/crm/api/overview`)).json()).project.name, "CRM");
  assert.equal((await (await fetch(`${base}/storefront/api/overview`)).json()).project.name, "Storefront");
  assert.equal((await fetch(`${base}/nope/api/overview`)).status, 404);
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
});

test("the home shows each product as a card with its latest screen as the cover", async () => {
  await crm.savePng("deal", 1, Buffer.from("png"));
  await new Book(scopedStore(store, "blank")).init({ name: "Blank" });
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<img src="\/crm\/api\/screens\/deal\/v1\.png"/);
  assert.match(html, /Edited just now · 1 screen/);
  assert.match(html, /1 open proposal/);
  assert.match(html, /Nothing drawn yet · 0 screens/);
  assert.match(html, /href="\/ui\.css"/);
  assert.ok(html.indexOf('href="/crm/"') < html.indexOf('href="/blank/"'));
});

test("the home speaks the browser's language", async () => {
  const html = await (await fetch(`${base}/`, { headers: { "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" } })).text();
  assert.match(html, /<html lang="pt-BR">/);
  assert.ok(html.includes(`${translate("pt-BR", "Edited just now")} · ${translate("pt-BR", "1 screen")}`));
  assert.ok(html.includes(`placeholder="${translate("pt-BR", "Search products")}"`));
  assert.match(html, /<script type="module" src="\/home\.js"><\/script>/);
});

test("install copies the skill and registers the MCP", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "screenbook-install-"));
  const calls = [];
  await install({ store: "github:org/screens", cwd, log() {}, run: (cmd, args) => calls.push([cmd, ...args]) });
  assert.match(await readFile(join(cwd, ".claude/skills/screenbook/SKILL.md"), "utf8"), /name: screenbook/);
  assert.deepEqual(calls[0], ["claude", "mcp", "remove", "screenbook", "-s", "local"]);
  assert.deepEqual(calls[1], ["claude", "mcp", "remove", "screenbook", "-s", "project"]);
  assert.deepEqual(calls[2].slice(0, 6), ["claude", "mcp", "add", "screenbook", "--scope", "project"]);
  assert.ok(calls[2].includes("github:org/screens"));
});

test("a product can be created from the viewer and from the chat", async () => {
  const response = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Café Acme" }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "cafe-acme", name: "Café Acme", url: "/cafe-acme/" });
  assert.equal((await fetch(`${base}/api/products`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Café Acme" }) })).status, 400);
  assert.equal((await fetch(`${base}/api/products`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "api" }) })).status, 400);

  const tools = buildProductTools(store, { render: async () => Buffer.from("png") });
  const created = JSON.parse((await tools.create_project.run({ name: "Brand", head_html: "<style>:root{--ink:#111}</style>" })).content[0].text);
  assert.equal(created.id, "brand");
  const book = new Book(scopedStore(store, "brand"));
  assert.equal((await book.project()).head, "head.html");
  assert.ok((await listProducts(store)).some((product) => product.id === "brand"));
});

test("an empty store opens on the product list, ready to create the first one", async () => {
  const empty = localStore(await mkdtemp(join(tmpdir(), "screenbook-empty-multi-")));
  assert.equal(await isMulti(empty), true);
  assert.deepEqual(await listProducts(empty), []);
});
