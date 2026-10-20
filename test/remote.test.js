import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { singleWriter } from "../src/store/single-writer.js";
import { remoteStore } from "../src/remote.js";
import { createProduct, listProducts } from "../src/products.js";
import { buildProductTools } from "../src/mcp.js";
import { createViewerServer } from "../src/server.js";
import { waitForMentions } from "../src/watch.js";

const root = await mkdtemp(join(tmpdir(), "screenbook-remote-"));
const disk = localStore(root);
await createProduct(disk, { name: "CRM" });
const server = createViewerServer({ store: singleWriter(disk) });
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const remote = remoteStore(`http://127.0.0.1:${server.address().port}`, { token: "unused" });
after(() => server.close());

test("the chat draws through the server, which is the only one writing to the store", async () => {
  const tools = buildProductTools(remote, { render: async () => Buffer.from("png") });
  const listing = JSON.parse((await tools.open_project.run({})).content[0].text);
  assert.deepEqual(listing.products.map((item) => item.id), ["crm"]);
  const written = JSON.parse((await tools.write_screen.run({ product: "crm", proposal: "p", name: "Deal", section: "Deals", html: "<p data-el='x'>a</p>" })).content[0].text);
  assert.equal(written.screen, "deal");
  assert.ok(await disk.read("crm/screens/deal/v1.html"));
  assert.equal((await disk.read("crm/screens/deal/v1.png")).toString(), "png");
});

test("many writes at once over the server all land", async () => {
  const tools = buildProductTools(remote, { render: async () => Buffer.from("png") });
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      tools.write_screen.run({ product: "crm", proposal: "rush", name: `Screen ${index}`, section: "Deals", html: `<p>${index}</p>` }),
    ),
  );
  const proposal = JSON.parse((await disk.read("crm/proposals/rush/proposal.json")).toString());
  assert.equal(Object.keys(proposal.screens).length, 12);
  const listing = JSON.parse((await tools.open_project.run({ product: "crm" })).content[0].text);
  assert.equal(listing.layout.flatMap((section) => section.screens).length, 13);
});

test("products are created and listed through the server", async () => {
  await createProduct(remote, { name: "Storefront" });
  assert.deepEqual((await listProducts(remote)).map((item) => item.id), ["crm", "storefront"]);
});

test("the listener watches mentions through the server", async () => {
  const controller = new AbortController();
  const lines = [];
  const out = { write: (line) => lines.push(line) };
  const watching = waitForMentions({ store: remote, handle: "claude", interval: 20, out, signal: controller.signal });
  const book = await (await import("../src/products.js")).productBooks(remote)("crm");
  await book.comment({ screen: "deal", el: "x", text: "@claude change this", author: "maria" });
  const found = await watching;
  assert.equal(found.length, 1);
  assert.equal(found[0].product, "crm");
});

test("calls that were refused while the login was open reuse its key instead of logging in again", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "screenbook-credentials-")), "credentials.json");
  let refused = 0;
  const fetchImpl = async (url, { headers }) => {
    if (headers.Authorization === "Bearer fresh") return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    await new Promise((done) => setTimeout(done, refused++ === 0 ? 0 : 50));
    return new Response(JSON.stringify({ error: "login" }), { status: 401 });
  };
  let logins = 0;
  const connect = async () => {
    logins += 1;
    await new Promise((done) => setTimeout(done, 10));
    return "fresh";
  };
  const store = remoteStore("https://screenbook.example", { fetchImpl, file, connect });
  const results = await Promise.all(Array.from({ length: 5 }, () => store.call("crm", "project")));
  assert.deepEqual(results, ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal(logins, 1);
  assert.equal(await store.token(), "fresh");
});
