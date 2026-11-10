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

test("only the author of a comment edits it through the API", async () => {
  const mine = await book.comment({ screen: "list", text: "taller", author: "You", login: "local" });
  const theirs = await book.comment({ screen: "list", text: "wider", author: "Rafa", login: "rafa" });
  const edit = (id, body) => fetch(`${base}/api/comments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const saved = await edit(mine.id, { text: "much taller" });
  assert.equal(saved.status, 200);
  const entry = await saved.json();
  assert.equal(entry.text, "much taller");
  assert.ok(entry.edited);
  const refused = await edit(theirs.id, { text: "mine now" });
  assert.equal(refused.status, 403);
  assert.equal((await book.comments("list")).find((item) => item.id === theirs.id).text, "wider");
  assert.equal((await edit(mine.id, { text: "" })).status, 400);
  assert.equal((await edit("nope1234", { text: "x" })).status, 404);
  const form = await fetch(`${base}/api/comments/${mine.id}`, { method: "PATCH", body: "text=x" });
  assert.equal(form.status, 415);
});

test("people come from whoever commented when there is no repository to ask, and tagging them asks no chat", async () => {
  await book.comment({ screen: "list", text: "hello", author: "Bia Souza", login: "biasouza" });
  const people = await (await fetch(`${base}/api/people`)).json();
  const bia = people.find((person) => person.login === "biasouza");
  assert.deepEqual(bia, { login: "biasouza", name: "Bia Souza", avatar: null });
  assert.ok(people.some((person) => person.login === "rafa"));
  assert.ok(!people.some((person) => person.login === "local"));
  const names = people.map((person) => person.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  const posted = await fetch(`${base}/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screen: "list", text: "@biasouza and @claude, check", author: "Marina", login: "someone-else" }),
  });
  const entry = await posted.json();
  assert.equal(entry.login, "local");
  assert.equal(await store.read("mentions/biasouza.jsonl"), null);
  assert.ok((await book.pendingMentions("claude")).some((mention) => mention.comment === entry.id));
});

test("the people list merges the repository's people with commenters, and falls back when the repository fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-people-"));
  const own = new Book(localStore(dir));
  await own.init({ name: "People" });
  await own.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  await own.comment({ screen: "list", text: "hi", author: "Old Name", login: "Tiago" });
  let failing = false;
  const people = async () => {
    if (failing) throw new Error("GitHub is down");
    return [{ login: "tiago", name: "Tiago Alves", avatar: "https://avatars.example/t.png" }, { login: "lara", name: "Lara Mendes", avatar: null }];
  };
  const running = createViewerServer({ store: localStore(dir), people });
  await new Promise((resolve) => running.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${running.address().port}`;
  try {
    const merged = await (await fetch(`${address}/api/people`)).json();
    assert.deepEqual(merged, [
      { login: "lara", name: "Lara Mendes", avatar: null },
      { login: "tiago", name: "Tiago Alves", avatar: "https://avatars.example/t.png" },
    ]);
    failing = true;
    const fallback = await (await fetch(`${address}/api/people`)).json();
    assert.deepEqual(fallback, [{ login: "Tiago", name: "Old Name", avatar: null }]);
  } finally {
    running.close();
  }
});
