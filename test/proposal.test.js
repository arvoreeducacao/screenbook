import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";
import { closedLabel, closedVersion, isClosed, pinnedVersions, showsVersion } from "../viewer/proposal.js";

const dir = await mkdtemp(join(tmpdir(), "screenbook-proposal-"));
const store = localStore(dir);
const book = new Book(store);
await book.init({ name: "CRM" });
await book.writeScreen({ proposal: "first", name: "Home", section: "Main", html: "<p>first</p>" });
await book.writeScreen({ proposal: "first", name: "Deals", section: "Main", html: "<p>deals</p>" });
await book.approve("first", "Marina");
await book.writeScreen({ proposal: "second", screen: "home", html: "<p>second</p>" });
await book.approve("second", "Rafa");
await book.writeScreen({ proposal: "dropped", screen: "deals", html: "<p>dropped</p>" });
await book.archive({ proposal: "dropped", by: "Rafa", reason: "went another way" });
await book.writeScreen({ proposal: "draft", screen: "home", html: "<p>draft</p>" });

const server = createViewerServer({ store });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function overview() {
  return (await fetch(`${base}/api/overview`)).json();
}

function byId(list, id) {
  return list.find((entry) => entry.id === id);
}

test("an approved proposal keeps the versions it pinned after another approval replaces them", async () => {
  const data = await overview();
  const first = byId(data.proposals, "first");
  const home = byId(data.screens, "home");
  assert.equal(first.status, "approved");
  assert.deepEqual(first.screens, { home: 1, deals: 1 });
  assert.equal(home.official, 2);
  assert.deepEqual(pinnedVersions(first, data.screens), [
    { screenId: "home", version: 1 },
    { screenId: "deals", version: 1 },
  ]);
  assert.equal(showsVersion(first, home, 1), true);
  assert.equal(showsVersion(first, home, 2), true);
  assert.equal(showsVersion(first, home, 3), false);
});

test("the pinned versions of a closed proposal are still served", async () => {
  const html = await fetch(`${base}/api/screens/home/v1.html`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /<p>first<\/p>/);
  const dropped = await fetch(`${base}/api/screens/deals/v2.html`);
  assert.equal(dropped.status, 200);
  assert.match(await dropped.text(), /<p>dropped<\/p>/);
});

test("the viewer loads the proposal rules as a static file", async () => {
  const response = await fetch(`${base}/proposal.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
});

test("the viewer loads the annotation rules as a static file", async () => {
  const response = await fetch(`${base}/annotations.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
});

test("approved and archived proposals are closed, open ones are not", async () => {
  const data = await overview();
  assert.equal(isClosed(byId(data.proposals, "first")), true);
  assert.equal(isClosed(byId(data.proposals, "dropped")), true);
  assert.equal(isClosed(byId(data.proposals, "draft")), false);
  assert.equal(isClosed(null), false);
  assert.equal(closedLabel(byId(data.proposals, "first")), "Approved");
  assert.equal(closedLabel(byId(data.proposals, "dropped")), "Archived");
  assert.equal(closedLabel(byId(data.proposals, "draft")), null);
});

test("only a version of a closed proposal that is not official is read-only", async () => {
  const data = await overview();
  const home = byId(data.screens, "home");
  const deals = byId(data.screens, "deals");
  assert.equal(closedVersion(home, 1, data.proposals), true);
  assert.equal(closedVersion(home, 2, data.proposals), false);
  assert.equal(closedVersion(home, 3, data.proposals), false);
  assert.equal(closedVersion(deals, 1, data.proposals), false);
  assert.equal(closedVersion(deals, 2, data.proposals), true);
});

test("a pinned screen that is gone from the canvas is left out", () => {
  const proposal = { id: "p", status: "approved", screens: { home: 1, gone: 1, missing: 9 } };
  const screens = [
    { id: "missing", number: 1, versions: [{ v: 1 }] },
    { id: "home", number: 2, versions: [{ v: 1 }] },
  ];
  assert.deepEqual(pinnedVersions(proposal, screens), [{ screenId: "home", version: 1 }]);
  assert.deepEqual(pinnedVersions(null, screens), []);
});
