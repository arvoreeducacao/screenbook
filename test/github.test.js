import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { githubStore, parseGithubSpec } from "../src/store/github.js";
import { scopedStore } from "../src/store/scoped.js";
import { Book } from "../src/book.js";

function gitSha(content) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

function fakeGithub() {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const heads = new Map();
  const calls = [];
  let version = 0;
  let counter = 0;
  let frozen = null;
  const hooks = { beforeRefUpdate: null };

  function saveBlob(base64) {
    const sha = gitSha(Buffer.from(base64, "base64"));
    blobs.set(sha, base64);
    return sha;
  }

  function saveTree(files) {
    counter += 1;
    const sha = `tree${counter}`;
    trees.set(sha, files);
    return sha;
  }

  function saveCommit(tree, parents, message) {
    counter += 1;
    const sha = `commit${counter}`;
    commits.set(sha, { tree, parents, message });
    return sha;
  }

  function filesOf(ref) {
    if (trees.has(ref)) return trees.get(ref);
    const sha = heads.get(ref) ?? ref;
    return commits.has(sha) ? trees.get(commits.get(sha).tree) : null;
  }

  function advance(branch, files, message) {
    heads.set(branch, saveCommit(saveTree(files), heads.has(branch) ? [heads.get(branch)] : [], message));
    version += 1;
  }

  function historyOf(branch) {
    const log = [];
    for (let sha = heads.get(branch); sha; sha = commits.get(sha).parents[0]) log.push(commits.get(sha).message);
    return log;
  }

  const unprocessable = (text) => new Response(text, { status: 422 });

  async function fetchImpl(url, { method, body, headers }) {
    calls.push({ method, url });
    const payload = body ? JSON.parse(body) : null;
    const path = new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
    const query = new URL(url).searchParams;
    let match;
    if (method === "GET" && (match = path.match(/^\/git\/trees\/(.+)$/))) {
      const branch = decodeURIComponent(match[1]);
      const files = branch === "main" && frozen ? frozen : filesOf(branch);
      if (!files) return new Response("{}", { status: 404 });
      const etag = `"v${version}"`;
      if (headers["If-None-Match"] === etag) return new Response(null, { status: 304 });
      return Response.json({ tree: [...files].map(([file, sha]) => ({ path: file, sha, type: "blob" })) }, { headers: { etag } });
    }
    if (method === "GET" && (match = path.match(/^\/git\/blobs\/(\w+)$/))) {
      return blobs.has(match[1]) ? Response.json({ content: blobs.get(match[1]) }) : new Response("{}", { status: 404 });
    }
    if ((match = path.match(/^\/contents\/(.+)$/))) {
      const file = decodeURI(match[1]);
      if (method === "GET") {
        const sha = filesOf(query.get("ref"))?.get(file);
        return sha ? Response.json({ sha }) : new Response("{}", { status: 404 });
      }
      const files = new Map(filesOf(payload.branch) ?? []);
      if (files.has(file) && payload.sha !== files.get(file)) return new Response("conflict", { status: 409 });
      const sha = saveBlob(payload.content);
      files.set(file, sha);
      advance(payload.branch, files, payload.message);
      return Response.json({ content: { sha } });
    }
    if (method === "GET" && (match = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = heads.get(decodeURIComponent(match[1]));
      return sha ? Response.json({ object: { sha } }) : new Response("{}", { status: 404 });
    }
    if (method === "GET" && (match = path.match(/^\/git\/commits\/(\w+)$/))) {
      return Response.json({ tree: { sha: commits.get(match[1]).tree } });
    }
    if (method === "POST" && path === "/git/blobs") return Response.json({ sha: saveBlob(payload.content) });
    if (method === "POST" && path === "/git/trees") {
      const files = new Map(payload.base_tree ? trees.get(payload.base_tree) : []);
      for (const entry of payload.tree) files.set(entry.path, entry.sha ?? saveBlob(Buffer.from(entry.content).toString("base64")));
      return Response.json({ sha: saveTree(files) });
    }
    if (method === "POST" && path === "/git/commits") return Response.json({ sha: saveCommit(payload.tree, payload.parents, payload.message) });
    if (method === "PATCH" && (match = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const branch = decodeURIComponent(match[1]);
      if (hooks.beforeRefUpdate) {
        const hook = hooks.beforeRefUpdate;
        hooks.beforeRefUpdate = null;
        await hook();
      }
      if (!heads.has(branch)) return unprocessable("Reference does not exist");
      if (!payload.force && !commits.get(payload.sha).parents.includes(heads.get(branch))) return unprocessable("Update is not a fast forward");
      heads.set(branch, payload.sha);
      version += 1;
      return Response.json({ object: { sha: payload.sha } });
    }
    if (method === "POST" && path === "/git/refs") {
      const branch = payload.ref.replace("refs/heads/", "");
      if (heads.has(branch)) return unprocessable("Reference already exists");
      heads.set(branch, payload.sha);
      version += 1;
      return Response.json({ object: { sha: payload.sha } });
    }
    return new Response("?", { status: 500 });
  }

  return {
    get files() {
      return filesOf("main") ?? new Map();
    },
    calls,
    hooks,
    heads,
    commits,
    historyOf,
    advance,
    filesOf,
    contentOf(branch, file) {
      const sha = filesOf(branch)?.get(file);
      return sha ? Buffer.from(blobs.get(sha), "base64").toString("utf8") : null;
    },
    fetchImpl,
    lag: () => {
      frozen = new Map(filesOf("main") ?? []);
    },
  };
}

test("parses owner, repo, branch and folder", () => {
  assert.deepEqual(parseGithubSpec("acme/screens@design/crm"), {
    owner: "acme",
    repo: "screens",
    branch: "design",
    folder: "crm",
  });
  assert.equal(parseGithubSpec("a/b").branch, "main");
});

test("writes, appends and lists inside the folder", async () => {
  const fake = fakeGithub();
  const store = githubStore("org/repo/crm", { token: "t", fetchImpl: fake.fetchImpl });
  assert.equal(await store.read("project.json"), null);
  await store.write("project.json", "{}");
  await store.append("comments/a.jsonl", "one\n");
  await store.append("comments/a.jsonl", "two\n");
  assert.equal((await store.read("comments/a.jsonl")).toString(), "one\ntwo\n");
  assert.ok(fake.files.has("crm/project.json"));
  assert.deepEqual(await store.list("comments"), ["comments/a.jsonl"]);
});

test("a write by someone else is seen after the tree refreshes", async () => {
  const fake = fakeGithub();
  const first = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  const second = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await first.write("f.txt", "a");
  assert.equal((await second.read("f.txt")).toString(), "a");
  await first.write("f.txt", "b");
  await second.write("f.txt", "c");
  assert.equal((await first.read("f.txt")).toString(), "c");
});

test("polling an unchanged store costs only conditional requests", async () => {
  const fake = fakeGithub();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await store.write("a.txt", "a");
  await store.read("a.txt");
  fake.calls.length = 0;
  for (let i = 0; i < 5; i += 1) await store.read("a.txt");
  assert.ok(fake.calls.every((call) => call.url.includes("/git/trees/")));
  assert.equal(fake.calls.filter((call) => call.url.includes("/git/blobs/")).length, 0);
});

test("a tree that lags behind our own write does not bring the old file back", async () => {
  const fake = fakeGithub();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await store.write("proposal.json", "open");
  fake.lag();
  await store.write("proposal.json", "approved");
  assert.equal((await store.read("proposal.json")).toString(), "approved");
  await store.write("proposal.json", "approved again");
  assert.equal((await store.read("proposal.json")).toString(), "approved again");
});

function seeded() {
  const fake = fakeGithub();
  fake.advance("main", new Map(), "first");
  return fake;
}

test("everything saved inside one transaction lands in one commit", async () => {
  const fake = seeded();
  const store = githubStore("org/repo/crm", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  const result = await store.transaction((value) => `drew ${value}`, async () => {
    await store.write("screens/a/v1.html", "<p>a</p>");
    await store.write("screens/a/meta.json", "{}");
    await store.append("comments/a.jsonl", "one\n");
    await store.append("comments/a.jsonl", "two\n");
    assert.equal((await store.read("comments/a.jsonl")).toString(), "one\ntwo\n");
    assert.deepEqual(await store.list("screens"), ["screens/a/meta.json", "screens/a/v1.html"]);
    assert.equal(fake.historyOf("main").length, 1);
    return "a";
  });
  assert.equal(result, "a");
  assert.deepEqual(fake.historyOf("main"), ["screenbook: drew a", "first"]);
  assert.equal(fake.contentOf("main", "crm/comments/a.jsonl"), "one\ntwo\n");
  assert.equal((await store.read("screens/a/v1.html")).toString(), "<p>a</p>");
});

test("a drawing and its screenshot become one commit that says what happened", async () => {
  const fake = seeded();
  const book = new Book(scopedStore(githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 }), "crm"));
  await book.saving(null, async () => {
    const saved = await book.writeScreen({ proposal: "kpis", screen: "home", name: "Home", section: "Hoje", html: "<p>hi</p>", by: "claude" });
    await book.savePng(saved.screen, saved.version, Buffer.from("png"));
  });
  assert.deepEqual(fake.historyOf("main"), ["screenbook: crm: claude drew home v1 (kpis)", "first"]);
  assert.ok(fake.files.has("crm/screens/home/v1.png"));
  assert.ok(fake.files.has("crm/proposals/kpis/proposal.json"));
});

test("a comment is saved in one commit without uploading blobs or reading files one by one", async () => {
  const fake = seeded();
  const book = new Book(scopedStore(githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl }), "crm"));
  await book.writeScreen({ proposal: "kpis", screen: "home", name: "Home", section: "Hoje", html: "<p>hi</p>", by: "claude" });
  await book.comment({ screen: "home", text: "first", author: "Ana" });
  fake.calls.length = 0;
  const saved = await book.comment({ screen: "home", text: "@claude change the title", author: "Ana" });
  assert.equal(fake.calls.filter((call) => call.method === "POST" && call.url.endsWith("/git/blobs")).length, 0);
  assert.equal(fake.calls.filter((call) => call.url.includes("/contents/")).length, 0);
  assert.ok(fake.calls.length <= 7, `${fake.calls.length} calls: ${fake.calls.map((call) => `${call.method} ${call.url}`).join(", ")}`);
  assert.deepEqual(
    fake.contentOf("main", "crm/comments/home.jsonl").trim().split("\n").map((line) => JSON.parse(line).text),
    ["first", "@claude change the title"],
  );
  assert.equal(JSON.parse(fake.contentOf("main", "crm/mentions/claude.jsonl").trim()).comment, saved.id);
});

test("a binary file still goes up as a blob", async () => {
  const fake = seeded();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]);
  await store.transaction("png", async () => store.write("shot.png", png));
  assert.ok(fake.calls.some((call) => call.method === "POST" && call.url.endsWith("/git/blobs")));
  assert.ok((await githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 }).read("shot.png")).equals(png));
});

test("when someone else commits first, the save is replayed on top and keeps both", async () => {
  const fake = seeded();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  const other = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await store.append("comments/a.jsonl", "first\n");
  fake.hooks.beforeRefUpdate = async () => {
    await other.append("comments/a.jsonl", "theirs\n");
    await other.write("flows.json", "[]");
  };
  await store.transaction("mine", async () => {
    await store.append("comments/a.jsonl", "mine\n");
  });
  assert.equal(fake.contentOf("main", "comments/a.jsonl"), "first\ntheirs\nmine\n");
  assert.equal(fake.contentOf("main", "flows.json"), "[]");
  assert.equal(fake.historyOf("main")[0], "screenbook: mine");
});

test("what was saved before a failure is still committed, and the failure goes on", async () => {
  const fake = seeded();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await assert.rejects(
    store.transaction("half", async () => {
      await store.write("a.txt", "a");
      throw new Error("no chrome");
    }),
    /no chrome/,
  );
  assert.equal(fake.contentOf("main", "a.txt"), "a");
  assert.equal(fake.historyOf("main")[0], "screenbook: half");
});

test("a transaction that saves nothing makes no commit", async () => {
  const fake = seeded();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await store.transaction("nothing", async () => store.read("a.txt"));
  assert.deepEqual(fake.historyOf("main"), ["first"]);
});

test("a branch that does not exist yet is written file by file", async () => {
  const fake = fakeGithub();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await store.transaction("start", async () => {
    await store.write("project.json", "{}");
    await store.append("comments/a.jsonl", "one\n");
  });
  assert.equal(fake.contentOf("main", "project.json"), "{}");
  assert.equal(fake.contentOf("main", "comments/a.jsonl"), "one\n");
});

test("a drawing that fails halfway is named by its files, not by a result it never had", async () => {
  const fake = seeded();
  const store = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await assert.rejects(
    store.transaction((saved) => `drew ${saved.screen}`, async () => {
      await store.write("screens/a/v1.html", "a");
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(fake.historyOf("main")[0], "screenbook: 1 file(s): screens/a/v1.html");
});

test("an approval made while a drawing is being saved is not lost: the drawing is redone on top of it", async () => {
  const fake = seeded();
  const person = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  const chat = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await person.write("proposal.json", JSON.stringify({ screens: ["s3"], approved: [] }));
  let runs = 0;
  await chat.transaction("drew s5", async () => {
    runs += 1;
    const record = JSON.parse((await chat.read("proposal.json")).toString());
    if (runs === 1) await person.write("proposal.json", JSON.stringify({ ...record, approved: ["s3"] }));
    record.screens.push("s5");
    await chat.write("proposal.json", JSON.stringify(record));
  });
  assert.equal(runs, 2);
  assert.deepEqual(JSON.parse(fake.contentOf("main", "proposal.json")), { screens: ["s3", "s5"], approved: ["s3"] });
  assert.equal(fake.historyOf("main")[0], "screenbook: drew s5");
});

test("a file read by the action that someone keeps changing ends in an error, never in a lost change", async () => {
  const fake = seeded();
  const person = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  const chat = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  await person.write("flows.json", "0");
  let runs = 0;
  await assert.rejects(
    chat.transaction("link", async () => {
      runs += 1;
      const seen = (await chat.read("flows.json")).toString();
      await person.write("flows.json", `person ${runs}`);
      await chat.write("flows.json", `${seen} + chat`);
    }),
    /kept changing flows.json/,
  );
  assert.equal(runs, 4);
  assert.equal(fake.contentOf("main", "flows.json"), "person 4");
});

test("a file that appeared after it was seen missing also redoes the action", async () => {
  const fake = seeded();
  const person = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  const chat = githubStore("org/repo", { token: "t", fetchImpl: fake.fetchImpl, treeTtl: 0 });
  let runs = 0;
  await chat.transaction("new proposal", async () => {
    runs += 1;
    const existing = await chat.read("proposals/p/proposal.json");
    if (runs === 1) await person.write("proposals/p/proposal.json", "theirs");
    await chat.write("proposals/p/proposal.json", existing ? `${existing} + mine` : "mine");
  });
  assert.equal(runs, 2);
  assert.equal(fake.contentOf("main", "proposals/p/proposal.json"), "theirs + mine");
});
