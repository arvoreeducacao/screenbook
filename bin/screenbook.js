#!/usr/bin/env node
import { parseArgs } from "node:util";
import { openStore } from "../src/store/index.js";
import { Book } from "../src/book.js";

const USAGE = `screenbook <command> --store <where>

  where:  dir:./book | s3://bucket/prefix | https://<screenbook server> | github:owner/repo[@branch][/folder]
          (or the SCREENBOOK_STORE environment variable)

  login  --store https://<server>     connect this computer to a screenbook server (opens the browser once)
  install [--scope project|user] [--viewer <url>]   copy the skill and register the MCP in Claude Code
  init   --name "Storefront"          create the project (one folder per product: --store .../storefront)
  mcp    [--handle claude] [--viewer <url>]   MCP server over stdio, for the chat; with --viewer
         (or SCREENBOOK_VIEWER) the canvas shows where the chat is working
  watch  [--handle claude] [--product storefront] [--follow]   print each mention waiting for an answer (one JSON per line); exits after the first batch unless --follow
         [--interval 5] [--timeout 0] seconds; timeout 0 waits forever
  serve  [--port 4600] [--host 127.0.0.1]   the canvas in the browser
         GitHub login when SCREENBOOK_GITHUB_CLIENT_ID, SCREENBOOK_GITHUB_CLIENT_SECRET
         and SCREENBOOK_SESSION_SECRET are set
  create-github-app --org <org> --url <public url> [--out .screenbook/github-app.json]
         one GitHub App for the login and for writing to the store
`;

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    store: { type: "string", default: process.env.SCREENBOOK_STORE },
    handle: { type: "string", default: process.env.SCREENBOOK_HANDLE ?? "claude" },
    name: { type: "string" },
    port: { type: "string", default: process.env.PORT ?? "4600" },
    host: { type: "string", default: "127.0.0.1" },
    interval: { type: "string", default: "5" },
    timeout: { type: "string", default: "0" },
    follow: { type: "boolean", default: false },
    org: { type: "string" },
    url: { type: "string" },
    out: { type: "string", default: ".screenbook/github-app.json" },
    product: { type: "string" },
    scope: { type: "string", default: "project" },
    viewer: { type: "string", default: process.env.SCREENBOOK_VIEWER },
  },
  allowPositionals: true,
});

if (!command || command === "help" || command === "--help") {
  process.stdout.write(USAGE);
  process.exit(0);
}

const handle = values.handle.replace(/^@/, "").toLowerCase();

if (command === "create-github-app") {
  if (!values.org || !values.url) throw new Error("create-github-app needs --org and --url");
  const { createGithubApp } = await import("../src/create-app.js");
  await createGithubApp({ org: values.org, publicUrl: values.url, out: values.out });
  process.exit(0);
}

if (command === "install") {
  const { install } = await import("../src/install.js");
  await install({ store: values.store, scope: values.scope, viewer: values.viewer });
  process.exit(0);
}

const store = await openStore(values.store);

if (command === "login") {
  if (store.kind !== "remote") throw new Error("login is for a screenbook server: pass --store https://your-screenbook");
  await store.connect();
  process.stdout.write(`this computer is connected to ${store.describe()}\n`);
  process.exit(0);
}

if (command === "init") {
  if (!values.name) throw new Error("init needs --name");
  const project = await new Book(store).init({ name: values.name });
  process.stdout.write(`screenbook "${project.name}" ready at ${store.describe()}\n`);
} else if (command === "mcp") {
  const { runMcp } = await import("../src/mcp.js");
  await runMcp({ store, handle, viewer: values.viewer });
} else if (command === "watch") {
  const { waitForMentions } = await import("../src/watch.js");
  const found = await waitForMentions({
    store,
    handle,
    product: values.product,
    interval: Number(values.interval) * 1000,
    timeout: Number(values.timeout) * 1000,
    follow: values.follow,
    onListening: () =>
      process.stderr.write(
        `screenbook: listening for @${handle} on ${values.product ? `product ${values.product}` : "the whole store"} in ${store.describe()}, checking every ${Number(values.interval)}s\n`,
      ),
  });
  process.exit(found.length ? 0 : 2);
} else if (command === "serve") {
  const { createViewerServer } = await import("../src/server.js");
  const { authFromEnvironment, createAuth } = await import("../src/auth.js");
  const { singleWriter } = await import("../src/store/single-writer.js");
  const { repoAccess } = await import("../src/github-app.js");
  const settings = authFromEnvironment();
  const canRead = process.env.SCREENBOOK_ACCESS_REPO ? repoAccess({ repo: process.env.SCREENBOOK_ACCESS_REPO }) : store.canRead?.bind(store);
  const auth = settings ? createAuth({ ...settings, canRead }) : null;
  const written = store.kind === "github" ? store : singleWriter(store);
  const local = ["127.0.0.1", "localhost", "::1"].includes(values.host);
  const { createAi } = await import("../src/ai/index.js");
  const ai = (auth || local) && process.env.SCREENBOOK_AI !== "off"
    ? createAi({ store: written, secret: process.env.SCREENBOOK_SESSION_SECRET, origin: () => `http://127.0.0.1:${server.address().port}` })
    : null;
  const server = createViewerServer({ store: written, auth, ai });
  server.listen(Number(values.port), values.host, () => {
    process.stdout.write(`screenbook on http://${values.host}:${values.port} · ${store.describe()}${auth ? " · GitHub login" : ""}\n`);
  });
} else {
  process.stderr.write(USAGE);
  process.exit(1);
}
