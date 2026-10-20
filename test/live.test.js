import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";
import { createLive } from "../src/live.js";
import { buildTools } from "../src/mcp.js";
import { presenceSender } from "../src/presence.js";
import { agentSpot, ghostRect } from "../viewer/live.js";

const dir = await mkdtemp(join(tmpdir(), "screenbook-live-"));
const store = localStore(dir);
const book = new Book(store);
await book.init({ name: "CRM" });

const server = createViewerServer({ store, live: createLive({ pollMs: 50 }) });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const controllers = [];
after(() => {
  controllers.forEach((controller) => controller.abort());
  server.closeAllConnections();
  server.close();
});

async function connect(id, name) {
  const controller = new AbortController();
  controllers.push(controller);
  const response = await fetch(`${base}/api/live?id=${id}&name=${encodeURIComponent(name)}`, { signal: controller.signal });
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  const waiters = [];
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!name) continue;
          events.push({ name, data: JSON.parse(data) });
          waiters.splice(0).forEach((wake) => wake());
        }
      }
    } catch {}
  })();
  return {
    async next(name, match = () => true) {
      for (;;) {
        const found = events.findIndex((event) => event.name === name && match(event.data));
        if (found !== -1) return events.splice(found, 1)[0].data;
        await new Promise((resolve) => waiters.push(resolve));
      }
    },
  };
}

test("people see each other join and move", async () => {
  const ana = await connect("ana-tab-1", "Ana");
  assert.deepEqual((await ana.next("snapshot")).people, []);
  const bia = await connect("bia-tab-1", "Bia");
  const snapshot = await bia.next("snapshot");
  assert.equal(snapshot.people[0].name, "Ana");
  assert.equal((await ana.next("join")).name, "Bia");

  const moved = await fetch(`${base}/api/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "bia-tab-1", cursor: { screen: "list", version: 2, rx: 0.25, ry: 0.5, hand: true, evil: "<script>" } }),
  });
  assert.equal(moved.status, 204);
  const cursor = await ana.next("cursor");
  assert.equal(cursor.id, "bia-tab-1");
  assert.equal(cursor.cursor.rx, 0.25);
  assert.equal(cursor.cursor.evil, undefined);
  assert.equal(cursor.cursor.hand, true);
});

test("who follows whom and what each one sees travel with the cursor", async () => {
  const leader = await connect("lia-tab-1", "Lia");
  await leader.next("snapshot");
  const follower = await connect("leo-tab-1", "Leo");
  await follower.next("snapshot");

  await fetch(`${base}/api/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "lia-tab-1", cursor: null, view: { cx: 120.04, cy: -40, w: 1440, h: 900 } }),
  });
  const seen = await follower.next("cursor", (data) => data.id === "lia-tab-1");
  assert.deepEqual(seen.view, { cx: 120, cy: -40, w: 1440, h: 900 });

  await fetch(`${base}/api/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "leo-tab-1", cursor: null, view: { cx: 0, cy: 0, w: -1, h: 10 }, following: "lia-tab-1" }),
  });
  const watched = await leader.next("cursor", (data) => data.id === "leo-tab-1");
  assert.equal(watched.following, "lia-tab-1");
  assert.equal(watched.view, null);

  const late = await connect("lu-tab-1", "Lu");
  const snapshot = await late.next("snapshot");
  assert.equal(snapshot.people.find((person) => person.id === "leo-tab-1").following, "lia-tab-1");
});

test("a cursor from someone not connected is refused", async () => {
  const response = await fetch(`${base}/api/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "ghost-tab", cursor: { x: 1, y: 2 } }),
  });
  assert.equal(response.status, 404);
});

test("what the agent does in the MCP reaches the open canvases", async () => {
  const watcher = await connect("cai-tab-1", "Cai");
  await watcher.next("snapshot");
  const tools = buildTools(book, { render: async () => Buffer.from("png") });
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p data-el='row'>a</p>" });
  const drew = await watcher.next("agents", (agents) => agents.some((agent) => agent.action === "drew"));
  assert.deepEqual(
    { handle: drew[0].handle, action: drew[0].action, screen: drew[0].screen, version: drew[0].version },
    { handle: "claude", action: "drew", screen: "list", version: 1 },
  );
});

test("a chat that talks to the viewer shows up at once, one marker per chat even with the same name", async () => {
  const watcher = await connect("cai-tab-2", "Cai");
  await watcher.next("snapshot");
  const first = presenceSender({ viewer: base, handle: "claude", session: "chat-one" });
  const second = presenceSender({ viewer: base, handle: "claude", session: "chat-two" });
  const tools = buildTools(book, { render: async () => Buffer.from("png"), presence: (activity) => first(null, activity) });
  await tools.write_screen.run({ proposal: "p", name: "Detail", section: "Deals", html: "<p data-el='row'>b</p>" });
  await second(null, { action: "reading", screen: "list", version: 1 });
  const agents = await watcher.next("agents", (list) => list.some((agent) => agent.session === "chat-one" && agent.action === "drew") && list.some((agent) => agent.session === "chat-two"));
  const pushed = agents.filter((agent) => agent.session);
  assert.deepEqual(pushed.map((agent) => [agent.session, agent.action]).sort(), [["chat-one", "drew"], ["chat-two", "reading"]]);
  assert.ok(!((await store.read("presence/claude.json"))?.toString() ?? "").includes("Detail"));
});

test("the agent's marker says which piece it measures and where a new screen goes", async () => {
  const watcher = await connect("cai-tab-3", "Cai");
  await watcher.next("snapshot");
  const send = presenceSender({ viewer: base, handle: "claude", session: "chat-three" });
  const tools = buildTools(book, { render: async () => Buffer.from("png"), read: async () => ({}), presence: (activity) => send(null, activity) });
  await tools.inspect_screen.run({ screen: "list", el: "row" });
  const measuring = await watcher.next("agents", (list) => list.some((agent) => agent.session === "chat-three" && agent.action === "inspecting"));
  assert.equal(measuring.find((agent) => agent.session === "chat-three").el, "row");
  await send(null, { action: "drawing", screen: "list-empty", name: "Empty", proposal: "p", section: "deals", variantOf: "list" });
  const drawing = await watcher.next("agents", (list) => list.some((agent) => agent.session === "chat-three" && agent.action === "drawing"));
  assert.deepEqual((({ section, variantOf }) => ({ section, variantOf }))(drawing.find((agent) => agent.session === "chat-three")), { section: "deals", variantOf: "list" });
});

test("the agent reads a screen from top to bottom and its new screen is reserved where it will land", () => {
  const at = new Date(0).toISOString();
  const early = agentSpot({ action: "reading", at }, 500);
  const late = agentSpot({ action: "reading", at }, 7000);
  assert.ok(late.ry > early.ry);
  const placed = [
    { item: { screen: { id: "a", section: "deals" }, proposal: null }, x: 0, y: 0, width: 300, height: 200, reach: 300 },
    { item: { screen: { id: "b", section: "deals" }, proposal: { id: "p" } }, x: 400, y: 0, width: 300, height: 200, reach: 340 },
    { item: { screen: { id: "c", section: "other" }, proposal: null }, x: 0, y: 500, width: 300, height: 180, reach: 300 },
  ];
  assert.deepEqual(ghostRect({ section: "other" }, placed, 300), { x: 360, y: 500, width: 300, height: 188 });
  assert.deepEqual(ghostRect({ proposal: "p", section: "deals" }, placed, 300), { x: 800, y: 0, width: 300, height: 188 });
  assert.deepEqual(ghostRect({ variantOf: "a" }, placed, 300), { x: 0, y: 260, width: 300, height: 188 });
});

test("presence without a name or a session is refused", async () => {
  const response = await fetch(`${base}/api/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "drawing" }) });
  assert.equal(response.status, 400);
});

test("the GitHub token never travels to a viewer outside https", async () => {
  const sent = [];
  const capture = async (url, { headers }) => {
    sent.push(headers.Authorization ?? null);
    return new Response(null, { status: 204 });
  };
  const token = async () => "ghp_secret";
  await presenceSender({ viewer: "http://screens.example.com", token, handle: "claude", fetchImpl: capture })(null, { action: "looking" });
  await presenceSender({ viewer: "https://screens.example.com", token, handle: "claude", fetchImpl: capture })(null, { action: "looking" });
  await presenceSender({ viewer: "http://127.0.0.1:4600", token, handle: "claude", fetchImpl: capture })(null, { action: "looking" });
  assert.deepEqual(sent, [null, "Bearer ghp_secret", "Bearer ghp_secret"]);
});

test("a board change reaches everyone in the room, and a preview skips its sender", async () => {
  await book.createPage({ name: "Whiteboard", kind: "board" });
  const ana = await connect("ana-board-1", "Ana");
  const bia = await connect("bia-board-1", "Bia");
  await ana.next("snapshot");
  await bia.next("snapshot");
  const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const saved = await (await post("/api/boards/whiteboard", { client: "ana-board-1", by: "Ana", ops: [{ op: "add", item: { id: "note1", type: "sticky", text: "Hi", x: 0, y: 0 } }] })).json();
  assert.equal(saved.rev, 1);
  const seen = await bia.next("board", (data) => data.page === "whiteboard");
  assert.equal(seen.client, "ana-board-1");
  assert.equal(seen.ops[0].item.text, "Hi");
  assert.equal((await ana.next("board", (data) => data.page === "whiteboard")).rev, 1);
  assert.equal((await post("/api/boards/whiteboard/preview", { client: "ana-board-1", items: [{ id: "note1", x: 40, y: 0 }] })).status, 204);
  assert.equal((await bia.next("board-preview")).items[0].x, 40);
  const same = await (await fetch(`${base}/api/boards/whiteboard?since=1`)).json();
  assert.equal(same.same, true);
  const rpc = await (await post("/api/rpc", { method: "applyBoard", args: [{ page: "whiteboard", by: "claude", ops: [{ op: "move", id: "note1", dx: 10, dy: 0 }] }] })).json();
  assert.equal(rpc.result.rev, 2);
  assert.equal((await bia.next("board", (data) => data.rev === 2)).client, null);
});

test("the AI's spot on a board travels with its presence", async () => {
  const ana = await connect("ana-board-2", "Ana");
  await ana.next("snapshot");
  await fetch(`${base}/api/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: "claude", session: "board-1", action: "drawing", page: "whiteboard", boardX: 120.4, boardY: 80 }) });
  const agents = await ana.next("agents", (list) => list.some((agent) => agent.session === "board-1"));
  const agent = agents.find((entry) => entry.session === "board-1");
  assert.deepEqual([agent.page, agent.boardX, agent.boardY], ["whiteboard", 120, 80]);
});
