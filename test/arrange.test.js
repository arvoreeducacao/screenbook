import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { arrange } from "../viewer/arrange.js";

async function bookWith(names) {
  const book = new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-"))));
  await book.init({ name: "CRM" });
  for (const name of names) {
    await book.writeScreen({ proposal: "p", screen: name, name, section: "Customers", html: `<p>${name}</p>` });
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  return book;
}

async function layout(book) {
  const [project, screens] = await Promise.all([book.project(), book.screens()]);
  return arrange(project.sections, screens).map(({ section, groups }) => [
    section.name,
    groups.map((group) => [group.screen.id, ...group.variants.map((variant) => variant.id)].join("+")),
  ]);
}

test("screens go in creation order until someone places them", async () => {
  const book = await bookWith(["list", "detail", "edit"]);
  assert.deepEqual(await layout(book), [["Customers", ["list", "detail", "edit"]]]);
});

test("a new screen can land right after another, or first", async () => {
  const book = await bookWith(["list", "detail"]);
  await book.writeScreen({ proposal: "p", screen: "filter", name: "Filter", section: "Customers", html: "<p>f</p>", after: "list" });
  await book.writeScreen({ proposal: "p", screen: "home", name: "Home", section: "Customers", html: "<p>i</p>", after: "start" });
  assert.deepEqual(await layout(book), [["Customers", ["home", "list", "filter", "detail"]]]);
  assert.deepEqual((await book.screens()).map((screen) => screen.number), [1, 2, 3, 4]);
});

test("a variation stacks below its base, in the base's section", async () => {
  const book = await bookWith(["list", "detail"]);
  await book.writeScreen({ proposal: "p", screen: "list-empty", name: "List · vazia", section: "Other", html: "<p>v</p>", variantOf: "list" });
  await book.writeScreen({ proposal: "p", screen: "list-error", name: "List · erro", html: "<p>e</p>", variantOf: "list-empty" });
  assert.deepEqual(await layout(book), [["Customers", ["list+list-empty+list-error", "detail"]]]);
  await assert.rejects(book.writeScreen({ proposal: "p", screen: "list", html: "<p>x</p>", variantOf: "list-error" }), /itself/);
});

test("duplicating a screen makes a variation of it", async () => {
  const book = await bookWith(["list", "detail"]);
  await book.duplicate({ screen: "list", by: "Ana" });
  assert.deepEqual(await layout(book), [["Customers", ["list+list-copy", "detail"]]]);
});

test("arrange reorders sections, screens and variations in one go", async () => {
  const book = await bookWith(["list", "detail", "empty", "edit"]);
  await book.writeScreen({ proposal: "p", screen: "login", name: "Login", section: "Entry", html: "<p>l</p>" });
  await book.arrange({
    sections: [
      { name: "Entry" },
      { name: "Customers", screens: [{ id: "list", variants: ["empty"] }, "edit"] },
      { name: "Perfil", screens: ["detail"] },
    ],
  });
  assert.deepEqual(await layout(book), [
    ["Entry", ["login"]],
    ["Customers", ["list+empty", "edit"]],
    ["Perfil", ["detail"]],
  ]);
  await book.arrange({ sections: [{ name: "Customers", screens: ["empty"] }] });
  assert.deepEqual((await layout(book))[1], ["Customers", ["empty", "list", "edit"]]);
  await assert.rejects(book.arrange({ sections: [{ name: "Customers", screens: ["list", "list"] }] }), /twice/);
  await assert.rejects(book.arrange({ sections: [{ name: "Customers", screens: ["missing"] }] }), /no screen/);
});
