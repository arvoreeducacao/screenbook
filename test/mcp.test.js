import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { buildTools } from "../src/mcp.js";

const FAKE_PNG = Buffer.from("png-bytes");

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-mcp-"));
  const book = new Book(localStore(dir));
  await book.init({ name: "CRM" });
  const renders = [];
  const tools = buildTools(book, {
    handle: "claude",
    render: async (html, size) => {
      renders.push({ html, size });
      return FAKE_PNG;
    },
  });
  return { book, tools, renders };
}

test("there are exactly twenty-three tools, and ask_person only inside the screenbook's own AI", async () => {
  const { tools } = await setup();
  assert.deepEqual(Object.keys(tools).sort(), [
    "annotate",
    "approve",
    "archive",
    "arrange",
    "create_board",
    "find_screens",
    "inspect_screen",
    "link_screens",
    "open_project",
    "read_board",
    "read_guide",
    "read_proposal",
    "read_screen",
    "remove_annotation",
    "reply_comment",
    "resolve_comment",
    "restore",
    "screenshot",
    "share",
    "write_board",
    "write_guide",
    "write_part",
    "write_screen",
  ]);
  assert.ok(buildTools(new Book(localStore(await mkdtemp(join(tmpdir(), "screenbook-ask-")))), { ask: true }).ask_person);
});

test("the guide is the product's memory: written, edited, and fed by what people did since", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "Deal", section: "Deals", html: "<main data-el='card'>x</main>" });
  await book.comment({ screen: "deal", el: "card", version: 1, text: "no color stripe", author: "alice" });
  let read = JSON.parse((await tools.read_guide.run({})).content[0].text);
  assert.match(read.guide, /empty/);
  assert.equal(read.lessonsSinceUpdate[0].text, "no color stripe");
  await tools.write_guide.run({ text: "## Rejected\n- color stripe on the card", change: "learned from alice" });
  await tools.write_guide.run({ edits: [{ old_string: "color stripe", new_string: "color stripe on one side" }], change: "more precise" });
  read = JSON.parse((await tools.read_guide.run({})).content[0].text);
  assert.match(read.guide, /color stripe on one side on the card/);
  assert.deepEqual(read.lessonsSinceUpdate, []);
  assert.equal(read.recentChanges[0].change, "more precise");
  await assert.rejects(book.writeGuide({ text: "x".repeat(13000), by: "alice" }), /under 12000/);
});

test("find_screens ranks screens by what they show, and like finds the neighbors of a screen", async () => {
  const { tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "Order list", section: "Deals", route: "/deals", html: "<main data-el='filter-status'>Filter by status · Open order</main>" });
  await tools.write_screen.run({ proposal: "p", name: "Order detail", section: "Deals", html: "<main data-el='status'>Status of the open order</main>" });
  await tools.write_screen.run({ proposal: "p", name: "Login", section: "Auth", html: "<main>Sign in with email</main>" });
  const found = JSON.parse((await tools.find_screens.run({ query: "order list status" })).content[0].text);
  assert.equal(found.matches[0].screen, "order-list");
  assert.ok(!found.matches.some((match) => match.screen === "login"));
  const near = JSON.parse((await tools.find_screens.run({ like: "order-detail" })).content[0].text);
  assert.equal(near.matches[0].screen, "order-list");
});

test("read_proposal brings every conversation of the proposal, open ones first", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "A", section: "S", html: "<main data-el='x'>a</main>" });
  await tools.write_screen.run({ proposal: "p", name: "B", section: "S", html: "<main>b</main>" });
  const first = await book.comment({ screen: "a", el: "x", version: 1, text: "resolved", author: "ana" });
  await book.resolve({ comment: first.id, by: "ana" });
  await book.comment({ screen: "b", version: 1, text: "change the title", author: "ana" });
  await tools.annotate.run({ screen: "a", text: "why" });
  const read = JSON.parse((await tools.read_proposal.run({ proposal: "p" })).content[0].text);
  assert.equal(read.open, 1);
  assert.equal(read.threads[0].messages[0].text, "change the title");
  assert.deepEqual(read.screens.map((screen) => screen.id).sort(), ["a", "b"]);
  assert.ok(read.threads.some((thread) => thread.annotation));
});

test("inspect_screen measures the composed screen at its size, and big answers are cut to fit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-inspect-"));
  const book = new Book(localStore(dir));
  await book.init({ name: "CRM" });
  const calls = [];
  const tools = buildTools(book, { render: async () => FAKE_PNG, read: async (html, options) => (calls.push({ html, options }), { pieces: Array.from({ length: 4000 }, (_, at) => ({ piece: `p${at}`, text: "x".repeat(20) })) }) });
  await tools.write_screen.run({ proposal: "p", name: "A", section: "S", width: 375, height: 700, html: "<main data-el='x'>a</main>" });
  const result = await tools.inspect_screen.run({ screen: "a", el: "x" });
  assert.deepEqual(calls[0].options, { width: 375, height: 700, el: "x" });
  assert.match(calls[0].html, /data-el='x'/);
  const body = result.content[0].text;
  assert.ok(body.length < 30000);
  assert.equal(JSON.parse(body).truncated, true);
});

test("write_screen saves a version and answers with its screenshot", async () => {
  const { book, tools, renders } = await setup();
  const result = await tools.write_screen.run({
    proposal: "paused-cadence",
    name: "Deal detail",
    section: "Deals",
    html: "<main data-el='notice'>paused</main>",
  });
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].data, FAKE_PNG.toString("base64"));
  assert.deepEqual(renders[0].size, { width: 1280, height: 800 });
  assert.equal((await book.png("deal-detail", 1)).toString(), "png-bytes");
  assert.equal((await book.screen("deal-detail")).versions[0].by, "claude");
});

test("screenshot at phone width does not overwrite the saved screenshot", async () => {
  const { book, tools, renders } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  await book.savePng("list", 1, Buffer.from("desktop"));
  await tools.screenshot.run({ screen: "list", mobile: true });
  assert.deepEqual(renders.at(-1).size, { width: 375, height: 812 });
  assert.equal((await book.png("list", 1)).toString(), "desktop");
});

test("open_project lists what waits for the agent, and replying clears it", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p data-el='row'>a</p>" });
  const asked = await book.comment({ screen: "list", el: "row", text: "@claude bigger", author: "Marina" });
  const before = JSON.parse((await tools.open_project.run()).content[0].text);
  assert.equal(before.pending.length, 1);
  assert.equal(before.handle, "@claude");
  await tools.reply_comment.run({ comment: asked.id, text: "done, see v2", version: 2 });
  const after = JSON.parse((await tools.open_project.run()).content[0].text);
  assert.equal(after.pending.length, 0);
});

test("read_screen falls back to the latest version and carries the comments", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p>one</p>" });
  await tools.write_screen.run({ proposal: "p", screen: "list", html: "<p>two</p>" });
  await book.comment({ screen: "list", text: "nice", author: "Marina" });
  const result = await tools.read_screen.run({ screen: "list" });
  const info = JSON.parse(result.content[0].text);
  assert.equal(info.version, 2);
  assert.equal(info.comments.length, 1);
  assert.equal(result.content[1].text, "<p>two</p>");
  assert.equal(result.content[2].type, "image");
});

test("approve makes the proposal official in the agent's name, with the reason", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Orders", html: "<p>a</p>" });
  const result = await tools.approve.run({ proposal: "p", reason: "live at /deals since PR #10" });
  assert.equal(JSON.parse(result.content[0].text).status, "approved");
  const record = await book.proposal("p");
  assert.equal(record.approved.list.by, "claude");
  assert.equal(record.approved.list.reason, "live at /deals since PR #10");
  assert.equal((await book.screen("list")).official, 1);
});

test("archive takes a screen off the canvas and a new version brings it back", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Orders", html: "<p>a</p>" });
  await tools.write_screen.run({ proposal: "p", name: "Other", section: "Orders", html: "<p>b</p>" });
  await tools.archive.run({ screen: "list", reason: "never built" });
  const overview = await book.overview("claude");
  assert.deepEqual(overview.screens.map((screen) => screen.id), ["other"]);
  assert.equal(overview.screens[0].number, 2);
  assert.deepEqual(overview.archived.map((entry) => [entry.id, entry.number, entry.version, entry.reason]), [["list", 1, 1, "never built"]]);
  await tools.write_screen.run({ proposal: "p", screen: "list", html: "<p>a2</p>" });
  assert.equal((await book.overview("claude")).archived.length, 0);
});

test("archive closes an open proposal, refuses an approved one, and restore reopens it", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Orders", html: "<p>a</p>" });
  await tools.write_screen.run({ proposal: "q", name: "Other", section: "Orders", html: "<p>b</p>" });
  await tools.approve.run({ proposal: "q", reason: "live" });
  await tools.archive.run({ proposal: "p", reason: "nobody will build it" });
  assert.equal((await book.proposal("p")).status, "archived");
  await assert.rejects(book.archive({ proposal: "q", by: "claude", reason: "x" }), /approved/);
  await assert.rejects(tools.archive.run({ screen: "list", reason: " " }), /reason/);
  await tools.restore.run({ proposal: "p" });
  assert.equal((await book.proposal("p")).status, "open");
});

test("share opens a public link to one proposal", async () => {
  const { book, tools } = await setup();
  await book.writeScreen({ proposal: "kpis", name: "Home", section: "Main", html: "<p>a</p>" });
  const result = JSON.parse((await tools.share.run({ proposal: "kpis" })).content[0].text);
  assert.equal(result.proposal, "kpis");
  assert.match(result.link, /^\/s\/[\w-]{24}\/$/);
  assert.equal((await book.shares())[0].by, "claude");
});

test("annotate leaves a note beside the screen, apart from people's comments", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p data-el='row'>a</p>" });
  await tools.write_screen.run({ proposal: "p", screen: "list", html: "<p data-el='row'>b</p>" });
  const note = JSON.parse((await tools.annotate.run({ screen: "list", el: "row", text: "**Why** this row\nsecond line", category: "Decision" })).content[0].text);
  assert.equal(note.kind, "annotation");
  assert.equal(note.category, "Decision");
  assert.equal(note.version, 2);
  assert.deepEqual(note.els, ["row"]);
  await book.comment({ screen: "list", el: "row", text: "@claude is this right?", author: "Marina" });
  const info = JSON.parse((await tools.read_screen.run({ screen: "list" })).content[0].text);
  assert.deepEqual(info.annotations.map((entry) => entry.id), [note.id]);
  assert.equal(info.comments.length, 1);
  const overview = JSON.parse((await tools.open_project.run()).content[0].text);
  assert.equal(overview.pending.length, 1);
  assert.equal(overview.comments.list, 1);
  assert.equal(overview.annotations.list, 1);
});

test("an annotation never mentions anyone and a person's comment cannot carry a category", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  await tools.annotate.run({ screen: "list", text: "ask @marina about it" });
  assert.equal((await book.waiting()).length, 0);
  const human = await book.comment({ screen: "list", text: "hi", author: "Marina", category: "Risco" });
  assert.equal(human.category, undefined);
});

test("remove_annotation drops the note and its replies, and refuses people's comments", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  const note = JSON.parse((await tools.annotate.run({ screen: "list", text: "old note" })).content[0].text);
  await book.comment({ screen: "list", text: "ok", author: "Marina", replyTo: note.id });
  const human = await book.comment({ screen: "list", text: "keep me", author: "Marina" });
  const removed = await tools.remove_annotation.run({ id: note.id });
  assert.equal(JSON.parse(removed.content[0].text).removed, note.id);
  assert.deepEqual((await book.comments("list")).map((entry) => entry.id), [human.id]);
  await assert.rejects(book.removeAnnotation({ id: human.id, by: "claude" }), /not an annotation/);
});

test("an agent's root comment from before annotations existed counts as an annotation", async () => {
  const { book } = await setup();
  await book.writeScreen({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  await book.comment({ screen: "list", text: "old style note", author: "claude", kind: "agent" });
  const asked = await book.comment({ screen: "list", text: "@claude why?", author: "Marina" });
  await book.reply({ comment: asked.id, text: "because", author: "claude" });
  const overview = await book.overview("claude");
  assert.equal(overview.annotations.list, 1);
  assert.equal(overview.comments.list, 2);
  assert.equal(overview.pending.length, 0);
});

test("resolve_comment closes a conversation, and what the tools return about it carries resolved", async () => {
  const { book, tools } = await setup();
  await tools.write_screen.run({ proposal: "p", name: "List", section: "Deals", html: "<p>a</p>" });
  const asked = await book.comment({ screen: "list", el: "row", text: "@claude bigger", author: "Marina" });
  const replied = JSON.parse((await tools.reply_comment.run({ comment: asked.id, text: "done, v2" })).content[0].text);
  assert.equal(replied.resolved, null);
  const closed = JSON.parse((await tools.resolve_comment.run({ comment: replied.id })).content[0].text);
  assert.equal(closed.comment, asked.id);
  assert.equal(closed.resolved.by, "claude");
  const info = JSON.parse((await tools.read_screen.run({ screen: "list" })).content[0].text);
  assert.equal(info.comments.find((entry) => entry.id === asked.id).resolved.by, "claude");
  const overview = JSON.parse((await tools.open_project.run()).content[0].text);
  assert.equal(overview.comments.list, undefined);
  const reopened = JSON.parse((await tools.resolve_comment.run({ comment: asked.id, reopen: true })).content[0].text);
  assert.equal(reopened.resolved, null);
  const note = JSON.parse((await tools.annotate.run({ screen: "list", text: "why" })).content[0].text);
  const refused = await tools.resolve_comment.run({ comment: note.id }).catch((error) => error);
  assert.match(refused.message, /annotation/);
});
