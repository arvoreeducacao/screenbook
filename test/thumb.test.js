import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";

function fakePng(width, label) {
  const png = Buffer.alloc(33 + label.length);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "latin1");
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(800, 20);
  png.write(label, 33, "latin1");
  return png;
}

const labelOf = (png) => png.subarray(33).toString("latin1");

const dir = await mkdtemp(join(tmpdir(), "screenbook-thumb-"));
const store = localStore(dir);
const book = new Book(store);
await book.init({ name: "CRM" });
await book.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<body><p>a</p></body>" });
await book.savePng("list", 1, fakePng(2560, "two-x"));
await book.writeScreen({ proposal: "p", name: "Old", section: "Deals", html: "<body><p>b</p></body>" });
await book.savePng("old", 1, fakePng(1280, "one-x"));

let made = 0;
const shots = [];
const server = createViewerServer({
  store,
  makeThumb: async (png) => {
    made++;
    return Buffer.from(`webp:${labelOf(png)}`);
  },
  takeShot: async (html, size) => {
    shots.push(size);
    return fakePng(size.width * 2, "redrawn");
  },
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test("the card thumbnail is made once from the png and kept in the store", async () => {
  const first = await fetch(`${base}/api/screens/list/v1.thumb.webp?p=2x`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/webp");
  assert.equal(await first.text(), "webp:two-x");
  const second = await fetch(`${base}/api/screens/list/v1.thumb.webp?p=2x`);
  assert.equal(await second.text(), "webp:two-x");
  assert.equal(made, 1);
  assert.equal((await book.thumb("list", 1, "2x")).toString(), "webp:two-x");
});

test("a versioned shot is cached for good only when its stamp matches what the screen shows", async () => {
  const png = await fetch(`${base}/api/screens/list/v1.png?p=2x`);
  assert.match(png.headers.get("cache-control"), /immutable/);
  const thumb = await fetch(`${base}/api/screens/list/v1.thumb.webp?p=2x`);
  assert.match(thumb.headers.get("cache-control"), /immutable/);
  const unstamped = await fetch(`${base}/api/screens/list/v1.png`);
  assert.equal(unstamped.headers.get("cache-control"), "no-store");
  const wrongStamp = await fetch(`${base}/api/screens/list/v1.png?p=2x-header.2`);
  assert.equal(wrongStamp.headers.get("cache-control"), "no-store");
  const html = await fetch(`${base}/api/screens/list/v1.html`);
  assert.equal(html.headers.get("cache-control"), "no-store");
});

test("an old 1x screenshot is shown at once and shot again at 2x behind it", async () => {
  const first = await fetch(`${base}/api/screens/old/v1.png?p=2x`);
  assert.equal(labelOf(Buffer.from(await first.arrayBuffer())), "one-x");
  assert.equal(first.headers.get("cache-control"), "no-store");
  const thumb = await fetch(`${base}/api/screens/old/v1.thumb.webp?p=2x`);
  assert.equal(await thumb.text(), "webp:one-x");
  assert.equal(await book.thumb("old", 1, "2x"), null);
  for (let tries = 0; tries < 50 && (await book.shotIsLowRes("old", 1)); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(shots, [{ width: 1280, height: 800 }]);
  const upgraded = await fetch(`${base}/api/screens/old/v1.png?p=2x`);
  assert.equal(labelOf(Buffer.from(await upgraded.arrayBuffer())), "redrawn");
  assert.match(upgraded.headers.get("cache-control"), /immutable/);
});

test("a screen that does not exist has no thumbnail", async () => {
  const response = await fetch(`${base}/api/screens/nope/v1.thumb.webp`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
