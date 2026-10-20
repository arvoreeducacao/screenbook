import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appFromEnvironment, installationTokenProvider } from "../github-app.js";

const TREE_TTL_MS = 2000;
const OWN_WRITE_MS = 60000;
const COMMIT_ATTEMPTS = 4;
const FILE_MODE = "100644";

function settle(message, result) {
  try {
    return typeof message === "function" ? message(result) : message;
  } catch {
    return null;
  }
}

function gitBlobSha(content) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

function isText(content) {
  return Buffer.from(content.toString("utf8"), "utf8").equals(content);
}

function resolveToken(owner, repo) {
  const app = appFromEnvironment();
  if (app) return installationTokenProvider({ ...app, owner, repo });
  if (process.env.SCREENBOOK_GITHUB_TOKEN) return process.env.SCREENBOOK_GITHUB_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("no GitHub token: set SCREENBOOK_GITHUB_TOKEN or log in with `gh auth login`");
  }
}

export function parseGithubSpec(spec) {
  const match = spec.match(/^([\w.-]+)\/([\w.-]+)(?:@([^/]+))?(?:\/(.+))?$/);
  if (!match) throw new Error(`invalid github store: ${spec} (expected owner/repo[@branch][/folder])`);
  const [, owner, repo, branch = "main", folder = ""] = match;
  return { owner, repo, branch, folder: folder.replace(/\/+$/, "") };
}

export function githubStore(spec, { token, fetchImpl = fetch, treeTtl = TREE_TTL_MS } = {}) {
  const { owner, repo, branch, folder } = parseGithubSpec(spec);
  const credential = token ?? resolveToken(owner, repo);
  const currentToken = typeof credential === "function" ? credential : async () => credential;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const tree = { etag: null, fetchedAt: 0, shas: new Map(), pending: null };
  const blobs = new Map();
  const ownWrites = new Map();
  const pending = new AsyncLocalStorage();

  function keepOwnWrites(shas) {
    const now = Date.now();
    for (const [path, write] of ownWrites) {
      const stale = (shas.get(path) ?? null) === write.previous;
      if (stale && now - write.at <= OWN_WRITE_MS) shas.set(path, write.sha);
      else ownWrites.delete(path);
    }
    return shas;
  }

  function repoPath(path) {
    return [folder, path].filter(Boolean).join("/");
  }

  async function call(method, url, { body, etag } = {}) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${await currentToken()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(etag ? { "If-None-Match": etag } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 304) return { notModified: true };
    if (response.status === 404 || response.status === 409) return { missing: true, status: response.status };
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${url} answered ${response.status}: ${await response.text()}`);
    }
    return { json: await response.json(), etag: response.headers.get("etag") };
  }

  async function refreshTree(force = false) {
    if (!force && Date.now() - tree.fetchedAt < treeTtl) return tree.shas;
    if (tree.pending) return tree.pending;
    tree.pending = (async () => {
      const result = await call("GET", `${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
        etag: force ? null : tree.etag,
      });
      if (result.missing) {
        tree.shas = new Map();
      } else if (!result.notModified) {
        tree.etag = result.etag;
        tree.shas = keepOwnWrites(new Map(result.json.tree.filter((node) => node.type === "blob").map((node) => [node.path, node.sha])));
      }
      tree.fetchedAt = Date.now();
      return tree.shas;
    })().finally(() => {
      tree.pending = null;
    });
    return tree.pending;
  }

  async function blob(sha) {
    if (blobs.has(sha)) return blobs.get(sha);
    const result = await call("GET", `${api}/git/blobs/${sha}`);
    if (result.missing) return null;
    const buffer = Buffer.from(result.json.content, "base64");
    blobs.set(sha, buffer);
    return buffer;
  }

  async function committed(path) {
    const shas = await refreshTree();
    const target = repoPath(path);
    const sha = shas.get(target);
    const reads = pending.getStore()?.reads;
    if (reads && !reads.has(target)) reads.set(target, sha ?? null);
    return sha ? blob(sha) : null;
  }

  async function read(path) {
    const change = pending.getStore()?.changes.get(repoPath(path));
    if (!change) return committed(path);
    if (change.data) return change.data;
    return Buffer.concat([(await committed(path)) ?? Buffer.alloc(0), Buffer.from(change.appended)]);
  }

  function remember(target, sha, content, previous) {
    tree.shas.set(target, sha);
    ownWrites.set(target, { sha, previous: ownWrites.get(target)?.previous ?? previous, at: Date.now() });
    blobs.set(sha, content);
    tree.etag = null;
  }

  async function write(path, data, attempt = 0) {
    const target = repoPath(path);
    const open = pending.getStore();
    if (open) {
      open.changes.set(target, { data: Buffer.from(data) });
      return;
    }
    if (attempt > 0) ownWrites.delete(target);
    const shas = await refreshTree(attempt > 0);
    const content = Buffer.from(data);
    try {
      const result = await call("PUT", `${api}/contents/${encodeURI(target)}`, {
        body: {
          message: `screenbook: ${path}`,
          branch,
          content: content.toString("base64"),
          ...(shas.get(target) ? { sha: shas.get(target) } : {}),
        },
      });
      if (result.missing) throw new Error(`GitHub refused the write (${result.status})`);
      remember(target, result.json.content.sha, content, shas.get(target) ?? null);
    } catch (error) {
      if (attempt < 2 && /\(409\)|answered 422/.test(error.message)) return write(path, data, attempt + 1);
      throw error;
    }
  }

  async function headOf() {
    const ref = await call("GET", `${api}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (ref.missing) return null;
    const sha = ref.json.object.sha;
    const [commit, listing] = await Promise.all([call("GET", `${api}/git/commits/${sha}`), call("GET", `${api}/git/trees/${sha}?recursive=1`)]);
    const files = listing.json.truncated ? null : new Map(listing.json.tree.filter((node) => node.type === "blob").map((node) => [node.path, node.sha]));
    return { sha, tree: commit.json.tree.sha, files };
  }

  async function fileAt(target, head) {
    const found = await call("GET", `${api}/contents/${encodeURI(target)}?ref=${head}`);
    return found.missing ? null : blob(found.json.sha);
  }

  async function blobFor(content) {
    const made = await call("POST", `${api}/git/blobs`, { body: { content: content.toString("base64"), encoding: "base64" } });
    blobs.set(made.json.sha, content);
    return made.json.sha;
  }

  async function currentAt(target, head) {
    if (!head.files) return fileAt(target, head.sha);
    const sha = head.files.get(target);
    return sha ? blob(sha) : null;
  }

  async function treeEntry(target, content, known) {
    if (known) return { path: target, mode: FILE_MODE, type: "blob", sha: known };
    if (isText(content)) {
      const sha = gitBlobSha(content);
      blobs.set(sha, content);
      return { path: target, mode: FILE_MODE, type: "blob", content: content.toString("utf8"), sha };
    }
    return { path: target, mode: FILE_MODE, type: "blob", sha: await blobFor(content) };
  }

  async function changedSince(reads, head) {
    if (!reads.size) return [];
    const { files } = head;
    if (files) {
      tree.shas = files;
      tree.etag = null;
      tree.fetchedAt = Date.now();
    }
    const changed = [];
    for (const [target, seen] of reads) {
      const now = files ? (files.get(target) ?? null) : await call("GET", `${api}/contents/${encodeURI(target)}?ref=${head.sha}`).then((found) => (found.missing ? null : found.json.sha));
      if (now !== seen) changed.push(target);
    }
    return changed;
  }

  async function commitChanges({ changes, reads }, message) {
    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
      const head = await headOf();
      if (!head) {
        for (const [target, change] of changes) {
          const path = folder ? target.slice(folder.length + 1) : target;
          if (change.data) await write(path, change.data);
          else await store.append(path, change.appended);
        }
        return [];
      }
      const changed = await changedSince(reads, head);
      if (changed.length) return changed;
      const files = await Promise.all(
        [...changes].map(async ([target, change]) => {
          const content = change.data ?? Buffer.concat([(await currentAt(target, head)) ?? Buffer.alloc(0), Buffer.from(change.appended)]);
          const entry = await treeEntry(target, content, change.data ? change.sha : null);
          if (change.data) change.sha = entry.sha;
          return { target, content, sha: entry.sha, entry };
        }),
      );
      const made = await call("POST", `${api}/git/trees`, {
        body: { base_tree: head.tree, tree: files.map(({ entry: { sha, content, ...rest } }) => (content === undefined ? { ...rest, sha } : { ...rest, content })) },
      });
      const commit = await call("POST", `${api}/git/commits`, { body: { message, tree: made.json.sha, parents: [head.sha] } });
      const moved = await call("PATCH", `${api}/git/refs/heads/${encodeURIComponent(branch)}`, { body: { sha: commit.json.sha, force: false } }).catch((error) => {
        if (/answered 422/.test(error.message)) return null;
        throw error;
      });
      if (!moved) continue;
      const shas = await refreshTree();
      for (const file of files) remember(file.target, file.sha, file.content, shas.get(file.target) ?? null);
      return [];
    }
    throw new Error(`GitHub kept moving ${branch} while saving: ${message}`);
  }

  async function transaction(message, work) {
    const open = pending.getStore();
    if (open) {
      const result = await work();
      open.inner ??= settle(message, result);
      return result;
    }
    let changed = [];
    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
      const scope = { changes: new Map(), reads: new Map(), inner: null };
      let result;
      let failure = null;
      try {
        result = await pending.run(scope, work);
      } catch (error) {
        failure = error;
      }
      if (scope.changes.size) {
        const paths = [...scope.changes.keys()];
        const label = (failure && typeof message === "function" ? null : settle(message, result)) ?? scope.inner ?? `${paths.length} file(s): ${paths.join(", ")}`;
        changed = await commitChanges(scope, `screenbook: ${label}`);
        if (changed.length) continue;
      }
      if (failure) throw failure;
      return result;
    }
    throw new Error(`someone else kept changing ${changed.join(", ")} while this was being saved; nothing was saved, try again`);
  }

  const store = {
    kind: "github",
    describe: () => `github:${owner}/${repo}@${branch}${folder ? `/${folder}` : ""}`,
    read,
    write,
    transaction,
    token: currentToken,

    async append(path, text, attempt = 0) {
      const open = pending.getStore();
      if (open) {
        const target = repoPath(path);
        const change = open.changes.get(target);
        if (change?.data) change.data = Buffer.concat([change.data, Buffer.from(text)]);
        else open.changes.set(target, { appended: (change?.appended ?? "") + text });
        return;
      }
      if (attempt > 0) {
        ownWrites.delete(repoPath(path));
        await refreshTree(true);
      }
      const current = (await read(path))?.toString("utf8") ?? "";
      try {
        await write(path, current + text);
      } catch (error) {
        if (attempt < 2) return this.append(path, text, attempt + 1);
        throw error;
      }
    },

    async canRead(login) {
      const result = await call("GET", `${api}/collaborators/${encodeURIComponent(login)}/permission`);
      if (result.missing || result.notModified) return false;
      return ["admin", "maintain", "write", "triage", "read"].includes(result.json.permission);
    },

    async list(prefix) {
      const shas = await refreshTree();
      const start = repoPath(prefix);
      const strip = folder ? folder.length + 1 : 0;
      const staged = [...(pending.getStore()?.changes.keys() ?? [])];
      return [...new Set([...shas.keys(), ...staged])]
        .filter((path) => (folder ? path.startsWith(`${folder}/`) : true))
        .filter((path) => start === "" || path === start || path.startsWith(`${start}/`))
        .map((path) => path.slice(strip))
        .sort();
    },
  };
  return store;
}
