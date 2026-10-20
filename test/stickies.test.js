import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";

async function freshBook() {
  const book = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-stickies-"))));
  await book.init({ name: "CRM" });
  return book;
}

test("a sticky note is pinned, edited, moved and removed", async () => {
  const book = await freshBook();
  const sticky = await book.addSticky({ section: "orders", x: 40.6, y: -12, text: "Missing the empty", by: "Ana" });
  assert.equal(sticky.color, "yellow");
  assert.deepEqual([sticky.x, sticky.y], [41, -12]);
  await book.updateSticky({ id: sticky.id, text: "Missing the empty state", color: "pink", x: 100, by: "Bia" });
  const [saved] = await book.stickies();
  assert.equal(saved.text, "Missing the empty state");
  assert.equal(saved.color, "pink");
  assert.equal(saved.x, 100);
  assert.equal(saved.editedBy, "Bia");
  assert.deepEqual((await book.overview()).stickies.map((entry) => entry.id), [sticky.id]);
  await book.removeSticky({ id: sticky.id, by: "Ana" });
  assert.deepEqual(await book.stickies(), []);
});

test("a sticky refuses bad positions, unknown colors fall back to yellow", async () => {
  const book = await freshBook();
  await assert.rejects(book.addSticky({ x: "abc", y: 0 }), /x must be a number/);
  const sticky = await book.addSticky({ x: 0, y: 0, color: "neon" });
  assert.equal(sticky.color, "yellow");
  await assert.rejects(book.updateSticky({ id: "missing", text: "x" }), /no sticky/);
});
