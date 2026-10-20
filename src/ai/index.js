import { readFileSync } from "node:fs";
import { createHomes } from "./home.js";
import { createLogins } from "./login.js";
import { MODELS, createAiRunner } from "./run.js";
import { createInternalTokens, stampAuthor } from "./token.js";
import { accountKey, createVault } from "./vault.js";

export { stampAuthor };

const CONTEXT_WORD = /^[\w-]{1,120}$/;
const MEMORY_NEEDED = 1.5 * 1024 ** 3;

export function memoryLimit(read = (path) => readFileSync(path, "utf8")) {
  for (const path of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const value = Number(read(path).trim());
      if (Number.isFinite(value) && value > 0 && value < 2 ** 60) return value;
    } catch {}
  }
  return null;
}

function word(value) {
  return typeof value === "string" && CONTEXT_WORD.test(value) ? value : undefined;
}

async function cleanContext(book, raw = {}) {
  const context = {
    view: word(raw.view),
    proposal: word(raw.proposal),
    screen: word(raw.screen),
    version: Number.isInteger(raw.version) ? raw.version : undefined,
    el: typeof raw.el === "string" ? raw.el.slice(0, 120) : undefined,
    label: typeof raw.label === "string" ? raw.label.slice(0, 160) : undefined,
    board: word(raw.board),
    boardName: typeof raw.boardName === "string" ? raw.boardName.slice(0, 60) : undefined,
    items: Array.isArray(raw.items) ? raw.items.filter((id) => typeof id === "string" && /^[\w-]{1,40}$/.test(id)).slice(0, 60) : undefined,
  };
  if (Array.isArray(raw.mentions)) {
    const cited = raw.mentions.filter((item) => word(item?.screen)).slice(0, 12);
    context.mentions = await Promise.all(cited.map(async (item) => ({ screen: item.screen, el: typeof item.el === "string" ? item.el.slice(0, 120) : undefined, name: (await book.screen(item.screen).catch(() => null))?.name })));
  }
  if (context.screen) context.screenName = (await book.screen(context.screen).catch(() => null))?.name;
  if (word(raw.comment)) {
    const found = await book.findComment(raw.comment).catch(() => null);
    if (found) context.comment = { id: found.id, author: found.author, screen: found.screen, el: found.el, version: found.version, text: String(found.text).slice(0, 4000) };
  }
  return context;
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createAi({ store, secret, origin, claude, homeRoot, spawnImpl, exec, memory = memoryLimit() }) {
  const roomy = memory === null || memory >= MEMORY_NEEDED;
  const vault = createVault({ store, secret });
  const homes = createHomes({ vault, ...(homeRoot ? { root: homeRoot } : {}) });
  const logins = createLogins({ homes, ...(claude ? { claude } : {}), ...(exec ? { exec } : {}) });
  const tokens = createInternalTokens();
  const runner = createAiRunner({ vault, homes, tokens, origin, ...(claude ? { claude } : {}), ...(spawnImpl ? { spawnImpl } : {}) });

  async function modelOf(login) {
    const prefs = await vault.prefs(login).catch(() => ({}));
    return MODELS.includes(prefs.model) ? prefs.model : MODELS[0];
  }

  async function status(login) {
    const found = await homes.status(login);
    if (found.connected && logins.waiting(login)) await homes.persist(login);
    return { ...found, waitingCode: logins.waiting(login), loginError: logins.failure(login), running: runner.running(login), ready: roomy, model: await modelOf(login), models: MODELS };
  }

  async function guideFor(book) {
    const guide = await book.guide().catch(() => null);
    if (!guide) return null;
    const lessons = await book.lessons(guide.updatedAt).catch(() => []);
    return { text: guide.text, lessons: lessons.length };
  }

  async function chatStream({ request, response, readBody, book, product, person }) {
    const body = await readBody(request);
    const text = String(body.text ?? "").trim().slice(0, 8000);
    if (!text) return send(response, 400, { error: "write your request" });
    const context = await cleanContext(book, body.context ?? {});
    const project = await book.project().catch(() => ({ name: product || "Screenbook" }));
    const model = MODELS.includes(body.model) ? body.model : await modelOf(person.login);
    if (body.model && MODELS.includes(body.model)) await vault.savePrefs(person.login, { ...(await vault.prefs(person.login).catch(() => ({}))), model: body.model }).catch(() => {});
    const guide = await guideFor(book);
    response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const emit = (event) => {
      if (!response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
    };
    const beat = setInterval(() => emit({ type: "ping" }), 15000);
    response.on("close", () => clearInterval(beat));
    try {
      const shown = typeof body.shown === "string" ? body.shown.slice(0, 8000) : null;
      const command = typeof body.command === "string" ? body.command.slice(0, 40) : null;
      await runner.chat({ person, product, productName: project.name ?? product, text, shown, command, context, emit, model, guide });
    } catch (error) {
      emit({ type: "result", ok: false, error: error.message });
    } finally {
      clearInterval(beat);
      response.end();
    }
  }

  return {
    userFromToken: (request) => tokens.fromRequest(request),

    async route({ request, response, path, readBody, book, product, user }) {
      if (!user?.login || user.via) return send(response, 403, { error: "sign in with your GitHub account to use the AI" });
      const login = accountKey(user.login);
      const person = { login, name: user.name ?? login };
      if (request.method === "GET" && path === "/api/ai/status") return send(response, 200, await status(login));
      if (request.method === "POST" && path === "/api/ai/login") return send(response, 200, await logins.start(login));
      if (request.method === "POST" && path === "/api/ai/code") {
        const body = await readBody(request);
        return send(response, 200, await logins.code(login, body.code));
      }
      if (request.method === "POST" && path === "/api/ai/logout") {
        await logins.stop(login);
        await homes.forget(login);
        return send(response, 200, { connected: false });
      }
      if (request.method === "POST" && path === "/api/ai/model") {
        const body = await readBody(request);
        if (!MODELS.includes(body.model)) return send(response, 400, { error: `pick one of these models: ${MODELS.join(", ")}` });
        await vault.savePrefs(login, { ...(await vault.prefs(login).catch(() => ({}))), model: body.model });
        return send(response, 200, { model: body.model });
      }
      if (request.method === "GET" && path === "/api/ai/guide") {
        const guide = await book.guide();
        return send(response, 200, { ...guide, lessons: await book.lessons(guide.updatedAt).catch(() => []) });
      }
      if (request.method === "PUT" && path === "/api/ai/guide") {
        const body = await readBody(request);
        if (typeof body.text !== "string") return send(response, 400, { error: "send the guide text" });
        try {
          return send(response, 200, await book.writeGuide({ text: body.text, change: "edited by hand", by: login }));
        } catch (error) {
          return send(response, 400, { error: error.message });
        }
      }
      if (request.method === "GET" && path === "/api/ai/chat") {
        const chat = await vault.chat(login, product || "_");
        return send(response, 200, { messages: chat.messages, running: runner.running(login) });
      }
      if (request.method === "POST" && path === "/api/ai/chat" && !roomy) return send(response, 503, { error: "the AI does not have enough memory on this server yet; come back soon" });
      if (request.method === "POST" && path === "/api/ai/chat") return chatStream({ request, response, readBody, book, product, person });
      if (request.method === "POST" && path === "/api/ai/reset") {
        runner.stop(login);
        await vault.saveChat(login, product || "_", { session: null, messages: [] });
        return send(response, 200, { messages: [] });
      }
      if (request.method === "POST" && path === "/api/ai/stop") {
        runner.stop(login);
        return send(response, 200, { stopped: true });
      }
      return send(response, 404, { error: "not found" });
    },
  };
}
