import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { Book } from "./book.js";

export const RPC_METHODS = new Set([
  "project",
  "init",
  "ensureSection",
  "screens",
  "screen",
  "screenHtml",
  "composedHtml",
  "parts",
  "writePart",
  "expandParts",
  "editedHtml",
  "writeScreen",
  "arrange",
  "numberOf",
  "duplicate",
  "saveEdit",
  "savePng",
  "png",
  "proposals",
  "proposal",
  "approve",
  "reopen",
  "archive",
  "restore",
  "flows",
  "link",
  "comments",
  "comment",
  "annotate",
  "annotations",
  "removeAnnotation",
  "resolve",
  "findComment",
  "reply",
  "pendingMentions",
  "waiting",
  "guide",
  "writeGuide",
  "lessons",
  "searchScreens",
  "proposalThreads",
  "allComments",
  "share",
  "shares",
  "revokeShare",
  "setPresence",
  "presence",
  "overview",
  "boards",
  "board",
  "boardSummary",
  "applyBoard",
  "createPage",
]);

export function encode(value) {
  if (Buffer.isBuffer(value)) return { $buffer: value.toString("base64") };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

export function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    if (typeof value.$buffer === "string" && Object.keys(value).length === 1) return Buffer.from(value.$buffer, "base64");
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  }
  return value;
}

export function credentialsFile(env = process.env) {
  return env.SCREENBOOK_CREDENTIALS ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "screenbook", "credentials.json");
}

async function readCredentials(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function saveKey(file, origin, key) {
  const all = await readCredentials(file);
  if (key) all[origin] = key;
  else delete all[origin];
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
}

function openInBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Screenbook</title><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>Your chat is connected to Screenbook. You can close this tab.</p></body>`;

export function connectByBrowser(base, { open = openInBrowser, timeout = 180000, say = (line) => process.stderr.write(`${line}\n`), label = hostname() } = {}) {
  return new Promise((resolve, reject) => {
    const state = randomBytes(16).toString("base64url");
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname !== "/callback" || url.searchParams.get("state") !== state || !url.searchParams.get("key")) {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(DONE_PAGE);
      clearTimeout(timer);
      server.close();
      resolve(url.searchParams.get("key"));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`the screenbook login was not finished; open ${base}/connect from this chat again`));
    }, timeout);
    server.listen(0, "127.0.0.1", () => {
      const callback = `http://127.0.0.1:${server.address().port}/callback`;
      const link = `${base}/connect?callback=${encodeURIComponent(callback)}&state=${state}&label=${encodeURIComponent(label)}`;
      say(`screenbook: open this link to connect this chat: ${link}`);
      open(link);
    });
  });
}

export function remoteStore(url, { token, fetchImpl = fetch, file = credentialsFile(), connect = connectByBrowser } = {}) {
  const base = url.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  let credential = token ?? process.env.SCREENBOOK_TOKEN ?? null;
  const fixed = Boolean(credential);
  let connecting = null;

  async function currentToken() {
    credential ??= (await readCredentials(file))[origin] ?? null;
    return credential;
  }

  async function reconnect() {
    connecting ??= connect(base)
      .then(async (key) => {
        await saveKey(file, origin, key);
        credential = key;
        return key;
      })
      .finally(() => (connecting = null));
    return connecting;
  }

  async function send(product, method, args, key) {
    return fetchImpl(`${base}${product ? `/${product}` : ""}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ method, args: encode(args) }),
      signal: AbortSignal.timeout(120000),
    });
  }

  async function call(product, method, args = []) {
    const sent = await currentToken();
    let response = await send(product, method, args, sent);
    if (response.status === 401 && !fixed) {
      // A call refused before a parallel login finished must reuse that login's key, not wipe it and open another tab.
      if (sent && credential === sent) {
        await saveKey(file, origin, null);
        credential = null;
      }
      response = await send(product, method, args, credential ?? (await reconnect()));
    }
    const body = await response.json().catch(() => ({ error: `the screenbook server answered ${response.status}` }));
    if (!response.ok) {
      const error = new Error(body.error ?? `the screenbook server answered ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return decode(body.result);
  }

  return {
    kind: "remote",
    url: base,
    describe: () => base,
    token: currentToken,
    connect: reconnect,
    call,
    async read() {
      throw new Error("a remote screenbook is read through its server, not file by file");
    },
  };
}

export function remoteBook(store, product = null) {
  const book = new Book(store);
  for (const method of RPC_METHODS) book[method] = (...args) => store.call(product, method, args);
  book.saving = (message, work) => work();
  return book;
}
