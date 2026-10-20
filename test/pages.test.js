import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { onPage, pageOfSection, pagesOf } from "../viewer/pages.js";

async function bookWithSections(names) {
  const book = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-pages-"))));
  await book.init({ name: "CRM" });
  for (const name of names) await book.writeScreen({ proposal: "p", screen: `screen-${name}`, section: name, html: "<p>a</p>" });
  return book;
}

const shape = (pages) => pages.map((page) => [page.id, page.sections]);

test("without pages every section lives on one page", () => {
  const pages = pagesOf({ sections: [{ id: "a" }, { id: "b" }] });
  assert.deepEqual(shape(pages), [["telas", ["a", "b"]]]);
  assert.equal(onPage(pages, "telas", null), true);
});

test("sections nobody placed fall on the first page, and gone sections drop out", () => {
  const pages = pagesOf({
    sections: [{ id: "a" }, { id: "b" }, { id: "c" }],
    pages: [{ id: "one", name: "One", sections: ["gone"] }, { id: "two", name: "Two", sections: ["b", "a"] }],
  });
  assert.deepEqual(shape(pages), [["one", ["c"]], ["two", ["b", "a"]]]);
  assert.equal(pageOfSection(pages, "a").id, "two");
  assert.equal(onPage(pages, "two", null), false);
});

test("a page is created, renamed, reordered and receives a section", async () => {
  const book = await bookWithSections(["Orders", "Returns"]);
  const created = await book.createPage({ name: "Archive", by: "Ana" });
  assert.equal(created.id, "archive");
  assert.deepEqual(shape(pagesOf(await book.project())), [["telas", ["orders", "returns"]], ["archive", []]]);
  await book.moveSection({ section: "returns", page: "archive", by: "Ana" });
  await book.updatePage({ page: "archive", name: "Archived", index: 0, by: "Ana" });
  const pages = pagesOf(await book.project());
  assert.deepEqual(pages.map((page) => page.name), ["Archived", "Screens"]);
  assert.deepEqual(shape(pages), [["archive", ["returns"]], ["telas", ["orders"]]]);
});

test("a new section drawn later lands on the first page", async () => {
  const book = await bookWithSections(["Orders"]);
  await book.createPage({ name: "Other" });
  await book.updatePage({ page: "other", index: 0 });
  await book.writeScreen({ proposal: "p", screen: "fresh", section: "Fresh", html: "<p>n</p>" });
  assert.deepEqual(shape(pagesOf(await book.project())), [["other", ["fresh"]], ["telas", ["orders"]]]);
});

test("deleting a page hands its sections to the page before it", async () => {
  const book = await bookWithSections(["A", "B"]);
  await book.createPage({ name: "Two" });
  await book.moveSection({ section: "b", page: "two" });
  await assert.rejects(book.createPage({ name: "  " }), /needs a name/);
  const result = await book.deletePage({ page: "two" });
  assert.equal(result.movedTo, "telas");
  assert.deepEqual(shape(pagesOf(await book.project())), [["telas", ["a", "b"]]]);
  await assert.rejects(book.deletePage({ page: "telas" }), /last page/);
});

test("two pages with the same name get different ids", async () => {
  const book = await bookWithSections(["A"]);
  await book.createPage({ name: "Rascunho" });
  const second = await book.createPage({ name: "Rascunho" });
  assert.equal(second.id, "rascunho-2");
});
