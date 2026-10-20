import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";
import { waitForMentions } from "../src/watch.js";

const dir = await mkdtemp(join(tmpdir(), "screenbook-server-"));
const store = localStore(dir);
const book = new Book(store);
await book.init({ name: "CRM" });
await book.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<body><p data-el='row'>a</p></body>" });

const server = createViewerServer({ store });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test("the overview carries screens and proposals", async () => {
  const overview = await (await fetch(`${base}/api/overview`)).json();
  assert.equal(overview.project.name, "CRM");
  assert.equal(overview.screens[0].id, "list");
  assert.equal(overview.proposals[0].id, "p");
});

test("screen html is sandboxed and carries the comment bridge", async () => {
  const response = await fetch(`${base}/api/screens/list/v1.html`);
  assert.equal(response.headers.get("content-security-policy"), "sandbox allow-scripts");
  const html = await response.text();
  assert.match(html, /__screenbook_pins/);
  assert.match(html, /__screenbook_edit/);
  assert.match(html, /data-el='row'/);
});

test("writes only accept JSON", async () => {
  const response = await fetch(`${base}/api/comments`, { method: "POST", body: "screen=list" });
  assert.equal(response.status, 415);
});

test("a comment with a mention wakes the watcher, and approving goes through", async () => {
  const waiting = waitForMentions({ store, handle: "claude", interval: 20, timeout: 3000, out: { write() {} } });
  const posted = await fetch(`${base}/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screen: "list", el: "row", version: 1, text: "@claude bigger", author: "Marina" }),
  });
  assert.equal(posted.status, 201);
  const found = await waiting;
  assert.equal(found.length, 1);
  assert.equal(found[0].el, "row");

  const approved = await fetch(`${base}/api/proposals/p/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ by: "Marina" }),
  });
  assert.equal((await approved.json()).status, "approved");
  assert.equal((await book.screen("list")).official, 1);
});

test("unknown screens answer 404", async () => {
  const response = await fetch(`${base}/api/screens/nope/v1.html`);
  assert.equal(response.status, 404);
});

test("the watcher gives up after its timeout", async () => {
  const empty = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-empty-"))));
  await empty.init({ name: "X" });
  const found = await waitForMentions({ store: empty.store, handle: "claude", interval: 10, timeout: 50, out: { write() {} } });
  assert.deepEqual(found, []);
});

test("the watcher says once that it is listening, after the first look", async () => {
  const quiet = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-quiet-"))));
  await quiet.init({ name: "Quiet" });
  let said = 0;
  const found = await waitForMentions({ store: quiet.store, handle: "claude", interval: 10, timeout: 50, onListening: () => said++ });
  assert.deepEqual(found, []);
  assert.equal(said, 1);
});

test("follow prints each mention once and keeps listening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-follow-"));
  const followed = new Book(localStore(dir));
  await followed.init({ name: "Follow" });
  await followed.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  const lines = [];
  const controller = new AbortController();
  const running = waitForMentions({ store: followed.store, handle: "claude", interval: 15, follow: true, signal: controller.signal, out: { write: (line) => lines.push(JSON.parse(line)) } });
  const first = await followed.comment({ screen: "list", text: "@claude primeira", author: "Ana" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  await followed.comment({ screen: "list", text: "@claude segunda", author: "Ana" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  controller.abort();
  await running;
  assert.deepEqual(lines.map((line) => line.text), ["@claude primeira", "@claude segunda"]);
  assert.equal(lines[0].comment, first.id);
});

test("a mention answered right before the watcher looks is not handed out again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-race-"));
  const raced = new Book(localStore(dir));
  await raced.init({ name: "Race" });
  await raced.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  const asked = await raced.comment({ screen: "list", text: "@claude hi", author: "Ana" });
  let looks = 0;
  const lagging = {
    ...raced.store,
    describe: raced.store.describe,
    read: async (path) => {
      if (path === "comments/list.jsonl" && looks++ === 0) return Buffer.from(`${JSON.stringify(asked)}\n`);
      return raced.store.read(path);
    },
  };
  await raced.reply({ comment: asked.id, text: "hi!", author: "claude" });
  const found = await waitForMentions({ store: lagging, handle: "claude", interval: 10, timeout: 100, out: { write() {} } });
  assert.deepEqual(found, []);
});

test("a conversation is resolved and reopened through the API", async () => {
  const root = await book.comment({ screen: "list", el: "row", text: "smaller", author: "Bia" });
  const resolve = (body) =>
    fetch(`${base}/api/comments/${root.id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const closed = await resolve({ by: "Bia" });
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).resolved.by, "Bia");
  assert.equal((await book.comments("list")).find((entry) => entry.id === root.id).resolved.by, "Bia");
  const opened = await (await resolve({ by: "Bia", reopen: true })).json();
  assert.equal(opened.resolved, null);
  const missing = await fetch(`${base}/api/comments/nope1234/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ by: "Bia" }) });
  assert.equal(missing.status, 404);
});
