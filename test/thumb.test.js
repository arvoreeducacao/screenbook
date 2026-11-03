import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";

const dir = await mkdtemp(join(tmpdir(), "screenbook-thumb-"));
const store = localStore(dir);
const book = new Book(store);
await book.init({ name: "CRM" });
await book.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<body><p>a</p></body>" });
await book.savePng("list", 1, Buffer.from("png-one"));

let made = 0;
const server = createViewerServer({
  store,
  makeThumb: async (png) => {
    made++;
    return Buffer.from(`webp:${png.toString()}`);
  },
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test("the card thumbnail is made once from the png and kept in the store", async () => {
  const first = await fetch(`${base}/api/screens/list/v1.thumb.webp`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/webp");
  assert.equal(await first.text(), "webp:png-one");
  const second = await fetch(`${base}/api/screens/list/v1.thumb.webp`);
  assert.equal(await second.text(), "webp:png-one");
  assert.equal(made, 1);
  assert.equal((await book.thumb("list", 1, "")).toString(), "webp:png-one");
});

test("a versioned shot is cached for good only when its stamp matches what the screen shows", async () => {
  const png = await fetch(`${base}/api/screens/list/v1.png`);
  assert.match(png.headers.get("cache-control"), /immutable/);
  const thumb = await fetch(`${base}/api/screens/list/v1.thumb.webp`);
  assert.match(thumb.headers.get("cache-control"), /immutable/);
  const wrongStamp = await fetch(`${base}/api/screens/list/v1.png?p=header.2`);
  assert.equal(wrongStamp.headers.get("cache-control"), "no-store");
  const html = await fetch(`${base}/api/screens/list/v1.html`);
  assert.equal(html.headers.get("cache-control"), "no-store");
});

test("a screen that does not exist has no thumbnail", async () => {
  const response = await fetch(`${base}/api/screens/nope/v1.thumb.webp`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
