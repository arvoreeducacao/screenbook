import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book, mentionsIn, slug } from "../src/book.js";

async function freshBook() {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-"));
  const book = new Book(localStore(dir));
  await book.init({ name: "CRM" });
  return book;
}

test("slug strips accents and spaces", () => {
  assert.equal(slug("Order, detail"), "order-detail");
});

test("mentionsIn finds each handle once and ignores e-mails", () => {
  assert.deepEqual(mentionsIn("@claude e @Codex, fala com @claude. alice@example.com"), ["claude", "codex"]);
});

test("a new screen needs a section and lands in a proposal", async () => {
  const book = await freshBook();
  await assert.rejects(book.writeScreen({ proposal: "x", screen: "deal", html: "<p>a</p>" }), /pass section/);
  const saved = await book.writeScreen({
    proposal: "Paused shipping",
    name: "Order, detail",
    section: "Orders",
    html: "<p data-el='aviso'>a</p>",
  });
  assert.deepEqual(saved, { screen: "order-detail", version: 1, proposal: "paused-shipping", width: 1280, height: 800 });
  const meta = await book.screen("order-detail");
  assert.equal(meta.official, null);
  assert.equal(meta.section, "orders");
  assert.deepEqual((await book.project()).sections, [{ id: "orders", name: "Orders" }]);
  assert.deepEqual((await book.proposal("paused-shipping")).screens, { "order-detail": 1 });
});

test("approving a proposal makes its versions official", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p1", name: "List", section: "Orders", html: "<p>v1</p>" });
  await book.writeScreen({ proposal: "p1", screen: "list", html: "<p>v2</p>" });
  await assert.rejects(book.approve("p1"), /person's name/);
  const record = await book.approve("p1", "Marina");
  assert.equal(record.status, "approved");
  assert.equal((await book.screen("list")).official, 2);
});

test("composed html wraps fragments with the shared head", async () => {
  const book = await freshBook();
  const project = await book.project();
  await book.writeJson("project.json", { ...project, head: "head.html" });
  await book.store.write("head.html", "<style>:root{--ink:#111}</style>");
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<main>hi</main>" });
  const html = await book.composedHtml("list", 1);
  assert.match(html, /<!doctype html>/);
  assert.match(html, /--ink:#111/);
  assert.match(html, /<main>hi<\/main>/);
});

test("a mention stays pending until the mentioned agent answers the thread", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p data-el='x'>a</p>" });
  const asked = await book.comment({ screen: "list", el: "x", version: 1, text: "@claude change the text", author: "Alice" });
  assert.equal((await book.pendingMentions("claude")).length, 1);
  assert.equal((await book.pendingMentions("codex")).length, 0);
  await book.reply({ comment: asked.id, text: "feito", author: "claude", version: 2 });
  assert.equal((await book.pendingMentions("claude")).length, 0);
  const followUp = await book.comment({ screen: "list", el: "x", text: "@claude one more", author: "Alice", replyTo: asked.id });
  const pending = await book.pendingMentions("claude");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].comment, followUp.id);
});

test("a comment keeps the point clicked on the screen, and the canvas gets every comment", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p data-el='x'>a</p>" });
  const asked = await book.comment({ screen: "list", el: "x", point: { x: 1.4, y: 0.25 }, version: 1, text: "here", author: "Ana" });
  assert.deepEqual(asked.point, { x: 1, y: 0.25 });
  const answer = await book.reply({ comment: asked.id, text: "ok", author: "claude" });
  assert.deepEqual(answer.point, asked.point);
  assert.equal((await book.comment({ screen: "list", text: "general", author: "Ana" })).point, null);
  const overview = await book.overview();
  assert.equal(overview.notes.length, 3);
  assert.equal(overview.comments.list, 3);
});

test("agent comments never create mentions", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  await book.comment({ screen: "list", text: "@codex look at this", author: "claude", kind: "agent" });
  assert.equal((await book.pendingMentions("codex")).length, 0);
});

test("links are kept once per piece and destination", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  await book.writeScreen({ proposal: "p", name: "Detail", section: "S", html: "<p>b</p>" });
  await book.link({ from: "list", el: "card", to: "detail" });
  await book.link({ from: "list", el: "card", to: "detail", label: "open" });
  assert.deepEqual(await book.flows(), [{ from: "list", el: "card", to: "detail", label: "open" }]);
  await assert.rejects(book.link({ from: "list", to: "missing" }), /no screen/);
});

test("the local store refuses paths outside its folder", async () => {
  const book = await freshBook();
  await assert.rejects(book.store.read("../../etc/passwd"), /escapes the store/);
});

test("a shared part is written once and lands inside every screen that names it", async () => {
  const book = await freshBook();
  await book.writePart("Sidebar", "<nav data-el='sidebar'>Orders</nav>");
  const saved = await book.writeScreen({ proposal: "p", name: "Deals", section: "Deals", html: "<sb-part name='sidebar'></sb-part><main>a</main>" });
  assert.equal(await book.screenHtml("deals", saved.version), "<nav data-el='sidebar'>Orders</nav><main>a</main>");
  assert.deepEqual((await book.overview()).parts, ["sidebar"]);
  await assert.rejects(book.writeScreen({ proposal: "p", screen: "deals", html: "<sb-part name='topbar'/>" }), /no part called "topbar"/);
});

test("edits change a few lines of the latest version", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Deals", section: "Deals", html: "<input class='search' style='width:80px'><span>Novo</span>" });
  const saved = await book.writeScreen({ proposal: "p", screen: "deals", edits: [{ old_string: "width:80px", new_string: "width:240px" }] });
  assert.equal(saved.version, 2);
  assert.equal(await book.screenHtml("deals", 2), "<input class='search' style='width:240px'><span>Novo</span>");
  await assert.rejects(book.writeScreen({ proposal: "p", screen: "deals", edits: [{ old_string: "nothing like this", new_string: "x" }] }), /exactly once/);
});

test("amend overwrites a draft until someone comments on it", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Deals", section: "Deals", html: "<p>broken</p>" });
  const fixed = await book.writeScreen({ proposal: "p", screen: "deals", html: "<p>fixed</p>", amend: true });
  assert.equal(fixed.version, 1);
  assert.equal((await book.screen("deals")).versions.length, 1);
  assert.equal(await book.screenHtml("deals", 1), "<p>fixed</p>");
  await book.comment({ screen: "deals", version: 1, text: "gostei", author: "Ana" });
  await assert.rejects(book.writeScreen({ proposal: "p", screen: "deals", html: "<p>again</p>", amend: true }), /already commented/);
  await assert.rejects(book.writeScreen({ proposal: "other", screen: "deals", html: "<p>x</p>", amend: true }), /belongs to proposal/);
});

test("the same comment sent twice in a row is kept once", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Deals", section: "Deals", html: "<p>a</p>" });
  const first = await book.comment({ screen: "deals", version: 1, text: "@claude ta ai?", author: "Alice" });
  const second = await book.comment({ screen: "deals", version: 1, text: "@claude ta ai?", author: "Alice" });
  assert.equal(second.id, first.id);
  assert.equal((await book.comments("deals")).length, 1);
  assert.equal((await book.pendingMentions("claude")).length, 1);
  const other = await book.comment({ screen: "deals", version: 1, text: "@claude ta ai?", author: "Ana" });
  assert.notEqual(other.id, first.id);
});

test("a proposal can be approved one screen at a time, and each screen undone on its own", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Deals", section: "S", html: "<p>d</p>" });
  await book.writeScreen({ proposal: "p", name: "Contacts", section: "S", html: "<p>c</p>" });
  const partial = await book.approve("p", "Ana", "deals");
  assert.equal(partial.status, "open");
  assert.equal((await book.screen("deals")).official, 1);
  assert.equal((await book.screen("contacts")).official, null);
  await assert.rejects(book.approve("p", "Ana", "nope"), /has no screen/);
  const done = await book.approve("p", "Ana", "contacts");
  assert.equal(done.status, "approved");
  const undone = await book.reopen("p", "Ana", "deals");
  assert.equal(undone.status, "open");
  assert.equal((await book.screen("deals")).official, null);
  assert.equal((await book.screen("contacts")).official, 1);
  assert.deepEqual(Object.keys(undone.approved), ["contacts"]);
});

test("a comment can be about several pieces at once", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p data-el='a'>a</p><p data-el='b'>b</p>" });
  const entry = await book.comment({ screen: "list", els: ["a", "b", "a", 3], text: "merge", author: "Ana" });
  assert.equal(entry.el, "a");
  assert.deepEqual(entry.els, ["a", "b"]);
  assert.deepEqual((await book.reply({ comment: entry.id, text: "ok", author: "claude" })).els, ["a", "b"]);
});

test("duplicating a screen copies it next to the original, inside a proposal", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "Orders", html: "<p>a</p>" });
  await book.savePng("list", 1, Buffer.from("png"));
  const sameProposal = await book.duplicate({ screen: "list", version: 1, by: "Ana" });
  assert.equal(sameProposal.screen, "list-copy");
  assert.equal(sameProposal.proposal, "p");
  assert.equal((await book.screen("list-copy")).copiedFrom.screen, "list");
  assert.ok(await book.png("list-copy", 1));
  await book.approve("p", "Ana");
  const fromOfficial = await book.duplicate({ screen: "list", by: "Ana" });
  assert.equal(fromOfficial.screen, "list-copy-2");
  assert.equal(fromOfficial.proposal, "variation-list");
  assert.match((await book.proposal("variation-list")).title, /Variation of screen 1/);
});

test("an edit made in the browser becomes a new version, never the official one", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  await book.approve("p", "Ana");
  const edited = await book.saveEdit({ screen: "list", version: 1, html: "<p style='color:red'>a</p>", by: "Ana" });
  assert.equal(edited.version, 2);
  assert.equal(edited.proposal, "edit-list");
  assert.equal((await book.screen("list")).official, 1);
  const again = await book.saveEdit({ screen: "list", version: 2, html: "<p>b</p>", by: "Ana" });
  assert.equal(again.proposal, "edit-list");
  await assert.rejects(book.saveEdit({ screen: "list", version: 2, html: " ", by: "Ana" }), /whole html/);
});

test("screens are numbered in the order they were first drawn", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Primeira", section: "S", html: "<p>1</p>" });
  await book.writeScreen({ proposal: "p", name: "Segunda", section: "S", html: "<p>2</p>" });
  await book.writeScreen({ proposal: "p", screen: "primeira", html: "<p>1b</p>" });
  assert.deepEqual((await book.screens()).map((screen) => [screen.id, screen.number]), [["primeira", 1], ["segunda", 2]]);
});

test("an approval can be undone, and the previous official versions come back", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "first", name: "Deals", section: "Deals", html: "<p>1</p>" });
  await book.approve("first", "Ana");
  await book.writeScreen({ proposal: "second", screen: "deals", html: "<p>2</p>" });
  await book.writeScreen({ proposal: "second", name: "Contacts", section: "Contacts", html: "<p>c</p>" });
  await book.approve("second", "Alice");
  assert.equal((await book.screen("deals")).official, 2);
  const reopened = await book.reopen("second", "Alice");
  assert.equal(reopened.status, "open");
  assert.equal((await book.screen("deals")).official, 1);
  assert.equal((await book.screen("contacts")).official, null);
});

test("a proposal closes once every screen left is approved or archived", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Option A", section: "S", html: "<p>a</p>" });
  await book.writeScreen({ proposal: "p", name: "Option B", section: "S", html: "<p>b</p>" });
  await book.writeScreen({ proposal: "p", name: "Later", section: "S", html: "<p>c</p>" });
  const partial = await book.approve("p", "Ana", "option-a");
  assert.equal(partial.status, "open");
  const first = await book.archive({ screen: "option-b", by: "Ana", reason: "lost" });
  assert.equal(first.closed, undefined);
  const last = await book.archive({ screen: "later", by: "Ana", reason: "not built" });
  assert.deepEqual(last.closed, ["p"]);
  assert.equal((await book.proposal("p")).status, "approved");
  assert.equal((await book.screen("option-b")).official, null);
});

test("approving a whole proposal leaves its archived screens archived", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Option A", section: "S", html: "<p>a</p>" });
  await book.writeScreen({ proposal: "p", name: "Option B", section: "S", html: "<p>b</p>" });
  await book.archive({ screen: "option-b", by: "Ana", reason: "lost" });
  const record = await book.approve("p", "Ana");
  assert.equal(record.status, "approved");
  assert.deepEqual(Object.keys(record.approved), ["option-a"]);
  assert.ok((await book.screen("option-b")).archived);
});

test("a proposal whose screens were all archived without approval stays open", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "Only", section: "S", html: "<p>a</p>" });
  const result = await book.archive({ screen: "only", by: "Ana", reason: "dropped" });
  assert.equal(result.closed, undefined);
  assert.equal((await book.proposal("p")).status, "open");
});

test("resolving marks the root of the conversation, from the root or any reply, and reopening takes it off", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  const root = await book.comment({ screen: "list", text: "bigger", author: "Ana" });
  const answer = await book.reply({ comment: root.id, text: "feito", author: "claude" });
  await assert.rejects(book.resolve({ comment: root.id }), /needs a name/);
  const closed = await book.resolve({ comment: answer.id, by: "Ana" });
  assert.equal(closed.comment, root.id);
  assert.equal(closed.resolved.by, "Ana");
  const [saved, reply] = await book.comments("list");
  assert.equal(saved.resolved.by, "Ana");
  assert.equal(reply.resolved, undefined);
  assert.equal(saved.text, "bigger");
  const opened = await book.resolve({ comment: root.id, by: "Ana", reopen: true });
  assert.equal(opened.resolved, null);
  assert.equal("resolved" in (await book.comments("list"))[0], false);
});

test("an annotation's conversation cannot be resolved", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  const note = await book.annotate({ screen: "list", text: "because", author: "claude" });
  const reply = await book.comment({ screen: "list", text: "ok", author: "Ana", replyTo: note.id });
  await assert.rejects(book.resolve({ comment: note.id, by: "Ana" }), /annotation/);
  await assert.rejects(book.resolve({ comment: reply.id, by: "Ana" }), /annotation/);
});

test("a person's reply reopens a resolved conversation, the chat's reply does not", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  const root = await book.comment({ screen: "list", text: "bigger", author: "Ana" });
  await book.resolve({ comment: root.id, by: "Ana" });
  await book.reply({ comment: root.id, text: "feito", author: "claude" });
  assert.ok((await book.comments("list"))[0].resolved);
  await book.comment({ screen: "list", text: "not yet", author: "Ana", replyTo: root.id });
  assert.equal((await book.comments("list"))[0].resolved, undefined);
  await book.resolve({ comment: root.id, by: "Ana" });
  await book.comment({ screen: "list", text: "from outside", author: "Visita", kind: "guest", replyTo: root.id });
  const entries = await book.comments("list");
  assert.equal(entries[0].resolved, undefined);
  assert.equal(entries.length, 4);
});

test("a resolved conversation does not count and its mention stops waiting", async () => {
  const book = await freshBook();
  await book.writeScreen({ proposal: "p", name: "List", section: "S", html: "<p>a</p>" });
  const asked = await book.comment({ screen: "list", text: "@claude bigger", author: "Ana" });
  await book.comment({ screen: "list", text: "ok", author: "Bia", replyTo: asked.id });
  await book.comment({ screen: "list", text: "another", author: "Bia" });
  assert.equal((await book.commentCounts()).list, 3);
  assert.equal((await book.pendingMentions("claude")).length, 1);
  await book.resolve({ comment: asked.id, by: "Ana" });
  assert.equal((await book.commentCounts()).list, 1);
  assert.equal((await book.pendingMentions("claude")).length, 0);
});
