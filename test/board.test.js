import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { singleWriter } from "../src/store/single-writer.js";
import { Book } from "../src/book.js";
import { buildTools } from "../src/mcp.js";
import { applyOps, expandOps, invertOps, summarize } from "../viewer/board-model.js";
import { pagesOf } from "../viewer/pages.js";

async function freshBook() {
  const book = new Book(singleWriter(localStore(await mkdtemp(join(tmpdir(), "screenbook-board-")))));
  await book.init({ name: "Demo" });
  return book;
}

test("a board page keeps its kind and never takes sections", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", screen: "home", name: "Home", section: "Start", html: "<p>a</p>" });
  const made = await book.createPage({ name: "Ideas", kind: "board" });
  assert.equal(made.kind, "board");
  const pages = pagesOf(await book.project());
  assert.deepEqual(pages.map((page) => [page.id, page.kind ?? "screens", page.sections]), [["telas", "screens", ["start"]], ["ideas", "board", []]]);
  await assert.rejects(book.moveSection({ section: "start", page: "ideas" }), /is a board/);
  await book.updatePage({ page: "ideas", index: 0 });
  assert.deepEqual(pagesOf(await book.project()).map((page) => [page.id, page.sections]), [["ideas", []], ["telas", ["start"]]]);
  await assert.rejects(book.deletePage({ page: "telas" }), /last page of screens/);
});

test("ops add, connect, group, move and delete, one change at a time", async () => {
  const book = await freshBook();
  await book.createPage({ name: "Ideas", kind: "board" });
  const first = await book.applyBoard({
    page: "ideas",
    by: "Ana",
    ops: [
      { op: "add", ref: "a", item: { type: "sticky", text: "Faster login", color: "pink" } },
      { op: "add", ref: "b", item: { type: "sticky", text: "Dark mode" } },
      { op: "add", ref: "c", item: { type: "shape", shape: "diamond", text: "Signed in?", x: 0, y: 600 } },
      { op: "connect", from: "a", to: "c", text: "yes" },
    ],
  });
  assert.equal(first.rev, 1);
  const { a, b, c } = first.refs;
  const board = await book.board("ideas");
  assert.equal(Object.keys(board.items).length, 4);
  assert.equal(board.items[a].color, "pink");
  assert.equal(board.items[a].by, "Ana");
  assert.notEqual(board.items[a].x, board.items[b].x);
  const grouped = await book.applyBoard({ page: "Ideas", ops: [{ op: "group", name: "Auth", ids: [a, b] }] });
  const section = grouped.ops.find((op) => op.op === "add").item;
  const after = await book.board("ideas");
  const inside = (item, box) => item.x >= box.x && item.x + item.w <= box.x + box.w && item.y >= box.y && item.y + item.h <= box.y + box.h;
  assert.ok(inside(after.items[a], after.items[section.id]));
  assert.ok(inside(after.items[b], after.items[section.id]));
  const summary = await book.boardSummary({ page: "ideas" });
  assert.equal(summary.items.find((item) => item.id === a).in, section.id);
  await Promise.all([
    book.applyBoard({ page: "ideas", ops: [{ op: "update", id: c, set: { text: "Logged in?" } }] }),
    book.applyBoard({ page: "ideas", ops: [{ op: "move", id: c, dx: 50, dy: 0 }] }),
  ]);
  const both = await book.board("ideas");
  assert.equal(both.items[c].text, "Logged in?");
  assert.equal(both.items[c].x, 50);
  assert.equal(both.rev, 4);
  const removed = await book.applyBoard({ page: "ideas", ops: [{ op: "delete", id: c }] });
  assert.equal(removed.ops.length, 2);
  await assert.rejects(book.applyBoard({ page: "ideas", ops: [{ op: "explode" }] }), /unknown op/);
  await assert.rejects(book.applyBoard({ page: "telas", ops: [] }), /not a board/);
});

test("undo is the inverse of what was applied", () => {
  const start = { s1: { id: "s1", type: "sticky", x: 0, y: 0, w: 200, h: 200, text: "a", color: "yellow", z: 1 } };
  const { ops } = expandOps({ rev: 0, items: start }, [
    { op: "update", id: "s1", set: { text: "b", x: 40 } },
    { op: "add", item: { id: "s2", type: "stamp", x: 10, y: 10 } },
    { op: "delete", id: "s1" },
  ]);
  const after = applyOps(start, ops);
  assert.deepEqual(Object.keys(after), ["s2"]);
  assert.deepEqual(applyOps(after, invertOps(start, ops)), start);
});

test("a big board is cut to fit what the AI can read", () => {
  const items = {};
  for (let n = 0; n < 900; n++) items[`n${n}`] = { id: `n${n}`, type: "sticky", x: n * 10, y: 0, w: 200, h: 200, z: n, text: "x".repeat(200), color: "yellow" };
  const summary = summarize({ rev: 3, items });
  assert.ok(JSON.stringify(summary).length < 28000);
  assert.match(summary.truncated, /left out/);
});

test("the AI reads and writes a board through its tools", async () => {
  const book = await freshBook();
  const seen = [];
  const tools = buildTools(book, { presence: async (activity) => seen.push(activity), render: async () => Buffer.from("") });
  const made = JSON.parse((await tools.create_board.run({ name: "Brainstorm" })).content[0].text);
  const wrote = JSON.parse((await tools.write_board.run({ page: made.page, ops: [{ op: "add", item: { type: "sticky", text: "Idea", x: 100, y: 100 } }] })).content[0].text);
  assert.equal(wrote.added.length, 1);
  const read = JSON.parse((await tools.read_board.run({ page: "Brainstorm" })).content[0].text);
  assert.equal(read.items[0].text, "Idea");
  const listed = JSON.parse((await tools.read_board.run({})).content[0].text);
  assert.deepEqual(listed.boards, [{ id: made.page, name: "Brainstorm" }]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(seen.some((activity) => activity.page === made.page && activity.boardX === 100));
});
