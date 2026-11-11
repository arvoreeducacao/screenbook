import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";

test("a read during a write sees the old file or the new one, never half of it", async () => {
  const store = localStore(await mkdtemp(join(tmpdir(), "screenbook-local-")));
  const old = JSON.stringify({ version: "old", fill: "a".repeat(200000) });
  const next = JSON.stringify({ version: "new", fill: "b".repeat(200000) });
  await store.write("screens/list/meta.json", old);
  const seen = new Set();
  let writing = true;
  const writer = (async () => {
    for (let round = 0; round < 40; round++) await store.write("screens/list/meta.json", round % 2 ? old : next);
    writing = false;
  })();
  while (writing) seen.add(JSON.parse((await store.read("screens/list/meta.json")).toString("utf8")).version);
  await writer;
  assert.ok([...seen].every((version) => version === "old" || version === "new"));
});

test("files still being written stay out of every listing", async () => {
  const store = localStore(await mkdtemp(join(tmpdir(), "screenbook-local-")));
  await store.write("crm/project.json", "{}");
  await store.write("crm/comments/list.jsonl", "");
  assert.deepEqual(await store.list(""), ["crm/comments/list.jsonl", "crm/project.json"]);
});
