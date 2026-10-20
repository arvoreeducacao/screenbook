import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Book } from "./book.js";
import { INSPECT_BRIDGE } from "./inspect-bridge.js";
import { EDIT_BRIDGE } from "./edit-bridge.js";
import { createLive } from "./live.js";
import { createProduct, isMulti, listProducts, productBooks, productSummaries } from "./products.js";
import { RPC_METHODS, decode, encode } from "./remote.js";
import { createKeys, isLoopback } from "./keys.js";
import { stampAuthor } from "./ai/index.js";
import { pickLang, translate } from "../viewer/i18n.js";

const VIEWER = fileURLToPath(new URL("../viewer/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

const BRIDGE = `<script>
(function () {
  var commenting = false;
  var editing = false;
  var picked = [];
  var outlines = null;
  function pieceOf(node) {
    return node && node.closest ? node.closest("[data-el]") : null;
  }
  function nodeOf(name) {
    return document.querySelector('[data-el="' + CSS.escape(name) + '"]');
  }
  function describe(name) {
    var node = nodeOf(name);
    if (!node) return null;
    var cs = getComputedStyle(node);
    return {
      el: name,
      text: node.children.length ? null : node.textContent,
      background: cs.backgroundColor,
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      padding: parseFloat(cs.paddingTop),
      radius: parseFloat(cs.borderTopLeftRadius),
      hidden: cs.display === "none"
    };
  }
  function outline(node, name, solid, index) {
    var box = node.getBoundingClientRect();
    var frame = document.createElement("div");
    frame.style.cssText = "position:absolute;pointer-events:none;border-radius:4px;left:" + (box.left + scrollX - 2) + "px;top:" + (box.top + scrollY - 2) + "px;width:" + (box.width + 4) + "px;height:" + (box.height + 4) + "px;border:2px " + (solid ? "solid" : "dashed") + " #4E6FFF";
    var tag = document.createElement("span");
    tag.textContent = (index ? index + " · " : "") + name;
    tag.style.cssText = "position:absolute;left:-2px;top:-21px;background:#4E6FFF;color:#fff;font:600 11px system-ui,sans-serif;padding:2px 6px;border-radius:4px 4px 4px 0;white-space:nowrap";
    frame.appendChild(tag);
    outlines.appendChild(frame);
  }
  function drawOutlines(hovered) {
    if (outlines) outlines.remove();
    outlines = document.createElement("div");
    outlines.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646";
    picked.forEach(function (name, index) {
      var node = nodeOf(name);
      if (node) outline(node, name, true, picked.length > 1 ? index + 1 : 0);
    });
    if (hovered && picked.indexOf(hovered.getAttribute("data-el")) === -1) outline(hovered, hovered.getAttribute("data-el"), false, 0);
    document.body.appendChild(outlines);
  }
  function palette() {
    var counts = {};
    var nodes = document.body ? document.body.getElementsByTagName("*") : [];
    for (var i = 0; i < nodes.length && i < 3000; i++) {
      var cs = getComputedStyle(nodes[i]);
      [cs.backgroundColor, cs.color].forEach(function (value) {
        if (!value || value === "transparent" || value.replace(/ /g, "").slice(-3) === ",0)") return;
        counts[value] = (counts[value] || 0) + 1;
      });
    }
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 12);
  }
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (type) {
    document.addEventListener(type, function (event) { event.preventDefault(); }, { passive: false });
  });
  document.addEventListener("mousemove", function (event) {
    if (!editing) return;
    drawOutlines(pieceOf(event.target));
  });
  document.addEventListener("click", function (event) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    var target = pieceOf(event.target);
    if (!target) return;
    var name = target.getAttribute("data-el");
    if (event.shiftKey) {
      var at = picked.indexOf(name);
      if (at === -1) picked.push(name);
      else picked.splice(at, 1);
    } else {
      picked = [name];
    }
    drawOutlines(null);
    parent.postMessage({ type: "edit-pick", els: picked.slice(), info: picked.length ? describe(picked[0]) : null }, "*");
  }, true);
  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type === "mode") {
      commenting = !!data.comment;
      editing = !!data.edit;
      if (!editing) {
        picked = [];
        if (outlines) outlines.remove();
      }
      document.documentElement.style.cursor = commenting || editing ? "crosshair" : "";
      if (editing) parent.postMessage({ type: "edit-ready", palette: palette() }, "*");
    }
    if (data.type === "edit-select") {
      picked = (data.els || []).filter(function (name) { return !!nodeOf(name); });
      drawOutlines(null);
      parent.postMessage({ type: "edit-pick", els: picked.slice(), info: picked.length ? describe(picked[0]) : null }, "*");
    }
    if (data.type === "edit-apply") {
      (data.els || []).forEach(function (name) {
        var node = nodeOf(name);
        if (!node) return;
        if (data.prop === "text") node.textContent = data.value;
        else node.style.setProperty(data.prop, data.value);
      });
      drawOutlines(null);
      if (picked.length) parent.postMessage({ type: "edit-info", info: describe(picked[0]) }, "*");
    }
    if (data.type === "pins") drawPins(data.pins || []);
    if (data.type === "probe") {
      var hit = document.elementFromPoint(data.x * innerWidth, data.y * innerHeight);
      var piece = hit && hit.closest("[data-el]");
      parent.postMessage({ type: "probed", id: data.id, el: piece ? piece.getAttribute("data-el") : null }, "*");
    }
    if (data.type === "boxes") {
      var boxes = {};
      document.querySelectorAll("[data-el]").forEach(function (node) {
        var name = node.getAttribute("data-el");
        var box = node.getBoundingClientRect();
        if (!name || boxes[name] || (!box.width && !box.height)) return;
        boxes[name] = { left: (box.left + scrollX) / innerWidth, top: (box.top + scrollY) / innerHeight, width: box.width / innerWidth, height: box.height / innerHeight };
      });
      parent.postMessage({ type: "boxes", id: data.id, boxes: boxes }, "*");
    }
  });
  document.addEventListener("click", function (event) {
    if (!commenting) return;
    event.preventDefault();
    event.stopPropagation();
    var target = event.target.closest("[data-el]");
    parent.postMessage({ type: "pick", el: target ? target.getAttribute("data-el") : null }, "*");
  }, true);
  function drawPins(pins) {
    var old = document.getElementById("__screenbook_pins");
    if (old) old.remove();
    var layer = document.createElement("div");
    layer.id = "__screenbook_pins";
    layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647";
    pins.forEach(function (pin) {
      var target = pin.el && document.querySelector('[data-el="' + CSS.escape(pin.el) + '"]');
      if (!target) return;
      var box = target.getBoundingClientRect();
      var badge = document.createElement("button");
      badge.textContent = pin.count;
      badge.title = pin.el;
      var left = box.right + 6;
      if (left + 26 > document.documentElement.clientWidth) left = box.left - 32;
      if (left < 0) left = box.right - 30;
      var top = Math.max(0, box.top - 14);
      badge.style.cssText = "position:absolute;left:" + (left + scrollX) + "px;top:" + (top + scrollY) + "px;width:26px;height:26px;border-radius:50% 50% 50% 3px;border:2px solid #fff;background:" + pin.color + ";color:#fff;font:700 11px system-ui,sans-serif;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;padding:0";
      badge.addEventListener("click", function (event) {
        event.stopPropagation();
        parent.postMessage({ type: "open", el: pin.el }, "*");
      });
      layer.appendChild(badge);
    });
    document.body.appendChild(layer);
  }
  var names = [];
  document.querySelectorAll("[data-el]").forEach(function (node) {
    var name = node.getAttribute("data-el");
    if (name && names.indexOf(name) === -1) names.push(name);
  });
  parent.postMessage({ type: "ready", els: names }, "*");
})();
</script>`;

function send(response, status, body, type = "application/json; charset=utf-8", headers = {}) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  response.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readBody(request, limit = 1_000_000) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
    throw Object.assign(new Error("send JSON"), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const STATIC_FILES = new Set(["style.css", "app.js", "i18n.js", "i18n-pt.js", "live.js", "proposal.js", "annotations.js", "arrange.js", "pages.js", "tabs.js", "layers.js", "menu.js", "zoom.js", "palette.js", "stickies.js", "ai.js", "logo.svg", "board.js", "board-model.js", "board.css"]);
for (const file of ["ui.css", "shell.js", "devmode.css", "home.css", "home.js", "inspect.js", "history.js", "present.js", "export.js", "edit.js", "edit-ops.js", "edit.css"]) STATIC_FILES.add(file);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function viewerPage(base) {
  const html = (await readFile(join(VIEWER, "index.html"), "utf8"));
  return html.replace("</head>", `  <meta name="screenbook-base" content="${escapeHtml(base)}">\n</head>`);
}

function languageOf(request) {
  return pickLang(request.headers["accept-language"]);
}

function editedAgo(language, iso, now = Date.now()) {
  if (!iso) return translate(language, "Nothing drawn yet");
  const minutes = Math.round((Date.parse(iso) - now) / 60000);
  if (minutes > -1) return translate(language, "Edited just now");
  const [value, unit] =
    minutes > -60 ? [minutes, "minute"]
    : minutes > -1440 ? [Math.round(minutes / 60), "hour"]
    : minutes > -43200 ? [Math.round(minutes / 1440), "day"]
    : minutes > -525600 ? [Math.round(minutes / 43200), "month"]
    : [Math.round(minutes / 525600), "year"];
  return translate(language, "Edited {when}", { when: new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(value, unit) });
}

function plural(language, count, one, many) {
  return count === 1 ? translate(language, one) : translate(language, many, { n: count });
}

const ICONS = {
  search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-linecap="round"/></svg>',
  clock: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor"/><path d="M8 5v3.2l2 1.3" stroke="currentColor" stroke-linecap="round"/></svg>',
  grid: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor"/><rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor"/></svg>',
  list: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-linecap="round"/></svg>',
  folder: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4.5a1 1 0 0 1 1-1h2.6l1.4 1.5h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" stroke="currentColor" stroke-linejoin="round"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-linecap="round"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" stroke-linecap="round"/></svg>',
  theme: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/></svg>',
  chevron: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="m3 4 2 2 2-2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function productCard(language, product) {
  const id = escapeHtml(product.id);
  const name = escapeHtml(product.name);
  const initial = escapeHtml(product.name.trim().charAt(0).toUpperCase());
  const cover = product.cover
    ? `<img src="/${id}/api/screens/${escapeHtml(product.cover.screen)}/v${Number(product.cover.version)}.png" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  const meta = [editedAgo(language, product.updatedAt), plural(language, product.screens, "1 screen", "{n} screens")];
  if (product.openProposals) meta.push(plural(language, product.openProposals, "1 open proposal", "{n} open proposals"));
  return `<a class="card" href="/${id}/" data-name="${name.toLowerCase()}" data-updated="${escapeHtml(product.updatedAt ?? "")}"><div class="card-thumb"><span class="card-initial">${initial}</span>${cover}</div><div class="card-body"><span class="card-icon">${initial}</span><div class="card-text"><b>${name}</b><span title="${escapeHtml(meta.join(" · "))}">${escapeHtml(meta.join(" · "))}</span></div></div></a>`;
}

function productsPage(language, products) {
  const tr = (text) => escapeHtml(translate(language, text));
  const items = [...products]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .map((product) => productCard(language, product))
    .join("");
  const total = products.length;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Screenbook</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/home.css"><script>try{document.documentElement.dataset.theme=localStorage.getItem("screenbook.theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}</script></head><body class="home"><aside class="home-side" id="home-side"><div class="home-brand"><img src="/logo.svg" alt=""><b>Screenbook</b></div><label class="home-search">${ICONS.search}<input id="home-search" type="search" placeholder="${tr("Search products")}" autocomplete="off"></label><nav class="home-nav"><button class="home-nav-item on" data-view="recent">${ICONS.clock}<span>${tr("Recent")}</span></button><button class="home-nav-item" data-view="all">${ICONS.folder}<span>${tr("All products")}</span><em>${total}</em></button></nav><div class="home-side-fill"></div><nav class="home-nav"><button class="home-nav-item" id="home-create-side">${ICONS.plus}<span>${tr("Create product")}</span></button><button class="home-nav-item" id="home-theme">${ICONS.theme}<span>${tr("Theme")}</span></button></nav></aside><main class="home-main"><header class="home-head"><button class="home-icon home-menu" id="home-menu" aria-label="Menu">${ICONS.list}</button><h1 id="home-title">${tr("Recent")}</h1><div class="home-tools"><div class="home-seg" role="group" aria-label="${tr("Sort")}"><button data-sort="updated" class="on">${tr("Last edited")}</button><button data-sort="name">${tr("Name")}</button></div><div class="home-seg home-seg-icons" role="group" aria-label="${tr("Layout")}"><button data-layout="grid" class="on" aria-label="${tr("Grid")}" title="${tr("Grid")}">${ICONS.grid}</button><button data-layout="list" aria-label="${tr("List")}" title="${tr("List")}">${ICONS.list}</button></div><div class="home-create"><button class="home-new" id="home-create">${ICONS.plus}<span>${tr("New product")}</span></button><form class="home-pop" id="home-pop" hidden><label for="home-new-name">${tr("Product name")}</label><input id="home-new-name" required maxlength="60" placeholder="${tr("e.g. Storefront")}" autocomplete="off"><p class="home-pop-error" id="home-pop-error" hidden></p><div class="home-pop-actions"><button type="button" class="btn" id="home-pop-cancel">${tr("Cancel")}</button><button class="btn primary">${tr("Create")}</button></div></form></div></div></header><section class="home-grid" id="home-grid">${items}</section><p class="home-empty" id="home-empty"${items ? " hidden" : ""}>${items ? tr("No product with that name.") : tr("No products yet. Create the first one or ask in a chat.")}</p></main><script type="module" src="/home.js"></script></body></html>`;
}

function personOf(user, url, language) {
  if (user) return { name: user.name, login: user.login, avatar: user.avatar };
  return { name: String(url.searchParams.get("name") || translate(language, "Guest")).slice(0, 40) };
}

async function sendScreenHtml(response, book, id, version) {
  const html = await book.composedHtml(id, version);
  const bridges = BRIDGE + INSPECT_BRIDGE + EDIT_BRIDGE;
  const withBridge = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${bridges}</body>`) : html + bridges;
  return send(response, 200, withBridge, "text/html; charset=utf-8", {
    "Content-Security-Policy": "sandbox allow-scripts",
  });
}

async function sendScreenExport(response, book, id, version) {
  const html = await book.composedHtml(id, version);
  return send(response, 200, html, "text/html; charset=utf-8", {
    "Content-Security-Policy": "sandbox",
    "Content-Disposition": `attachment; filename="${id}-v${version}.html"`,
  });
}

async function sendScreenPng(response, book, id, version) {
  const png = await book.png(id, version);
  return png ? send(response, 200, png, "image/png") : send(response, 404, { error: "no screenshot yet" });
}

async function rpcCall(request, response, methods, user = null) {
  const body = await readBody(request, 40_000_000);
  const method = String(body.method ?? "");
  const run = Object.hasOwn(methods, method) ? methods[method] : null;
  if (!run) return send(response, 404, { error: `no method ${method}` });
  const args = decode(Array.isArray(body.args) ? body.args : []);
  return send(response, 200, { result: encode((await run(...(user?.via ? stampAuthor(method, args, user.name) : args))) ?? null) });
}

function bookMethods(book, live, key) {
  const methods = { isMulti: () => false, ...Object.fromEntries([...RPC_METHODS].map((method) => [method, (...args) => book[method](...args)])) };
  methods.applyBoard = async (...args) => {
    const result = await book.applyBoard(...args);
    if (result.ops.length) live.emit({ key, name: "board", data: { page: result.page, rev: result.rev, ops: result.ops, client: null } });
    return result;
  };
  return methods;
}

const CLIENT = /^[\w-]{6,40}$/;

function previewOf(body) {
  if (!Array.isArray(body.items) || body.items.length > 400) return null;
  const items = body.items.filter((item) => item && typeof item === "object" && typeof item.id === "string" && /^[\w-]{1,40}$/.test(item.id));
  const json = JSON.stringify(items);
  return json.length > 200_000 ? null : JSON.parse(json);
}

async function apiRoute({ book, key, live, ai, auth, request, response, path, url, user }) {
  const language = languageOf(request);
  let match;
  if (request.method === "POST" && path === "/api/rpc") return rpcCall(request, response, bookMethods(book, live, key), user);
  if (path.startsWith("/api/ai/")) {
    if (!ai) return send(response, 404, { error: "the AI is not turned on in this Screenbook" });
    return ai.route({ request, response, path, readBody, book, product: key, user: user ?? (auth ? null : { login: "local", name: translate(language, "You") }) });
  }
  if (request.method === "GET" && path === "/api/live") {
    return live.join({ key, book, id: url.searchParams.get("id"), person: personOf(user, url, language), request, response });
  }
  if (request.method === "POST" && path === "/api/live") {
    const body = await readBody(request);
    return live.move({ key, id: body.id, cursor: body.cursor, view: body.view, following: body.following }) ? send(response, 204, "", "text/plain") : send(response, 404, { error: "not connected" });
  }
  if (request.method === "POST" && path === "/api/presence") {
    const body = await readBody(request);
    return live.agent({ key, activity: user?.via ? { ...body, via: user.via } : body }) ? send(response, 204, "", "text/plain") : send(response, 400, { error: "pass handle and session" });
  }
  if (request.method === "GET" && path === "/api/overview") {
    return send(response, 200, await book.overview(url.searchParams.get("handle")));
  }
  if (request.method === "GET" && (match = path.match(/^\/api\/screens\/([\w-]+)\/v(\d+)\.html$/))) {
    return sendScreenHtml(response, book, match[1], Number(match[2]));
  }
  if (request.method === "GET" && (match = path.match(/^\/api\/screens\/([\w-]+)\/v(\d+)\.source$/))) {
    return send(response, 200, await book.screenHtml(match[1], Number(match[2])), "text/plain; charset=utf-8");
  }
  if (request.method === "GET" && (match = path.match(/^\/api\/screens\/([\w-]+)\/v(\d+)\.export\.html$/))) {
    return sendScreenExport(response, book, match[1], Number(match[2]));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/screens\/([\w-]+)\/revert$/))) {
    const body = await readBody(request);
    return send(response, 201, await book.revert({ screen: match[1], version: Number(body.version), by: user?.name ?? body.by, lang: language }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/screens\/([\w-]+)\/duplicate$/))) {
    const body = await readBody(request);
    return send(response, 201, await book.duplicate({ screen: match[1], version: body.version ?? null, fresh: Boolean(body.fresh), by: user?.name ?? body.by, lang: language }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/screens\/([\w-]+)\/edit$/))) {
    const body = await readBody(request);
    return send(response, 201, await book.saveEdit({ screen: match[1], version: Number(body.version), html: body.html, by: user?.name ?? body.by, lang: language }));
  }
  if (request.method === "GET" && (match = path.match(/^\/api\/screens\/([\w-]+)\/v(\d+)\.png$/))) {
    return sendScreenPng(response, book, match[1], Number(match[2]));
  }
  if (request.method === "GET" && (match = path.match(/^\/api\/comments\/([\w-]+)$/))) {
    return send(response, 200, await book.comments(match[1]));
  }
  if (request.method === "POST" && path === "/api/comments") {
    const body = await readBody(request);
    return send(response, 201, await book.comment({ ...body, author: user?.name ?? body.author, kind: "human" }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/comments\/([\w-]+)\/resolve$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.resolve({ comment: match[1], by: user?.name ?? body.by, reopen: Boolean(body.reopen) }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/proposals\/([\w-]+)\/reopen$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.reopen(match[1], user?.name ?? body.by, body.screen ?? null));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/proposals\/([\w-]+)\/share$/))) {
    const body = await readBody(request);
    const entry = await book.share({ proposal: match[1], by: user?.name ?? body.by });
    return send(response, 201, { ...entry, path: `${sharePath(key, entry.token)}/` });
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/shares\/([\w-]+)\/revoke$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.revokeShare(match[1], user?.name ?? body.by));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/proposals\/([\w-]+)\/archive$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.archive({ proposal: match[1], by: user?.name ?? body.by, reason: typeof body.reason === "string" ? body.reason.slice(0, 280) : null }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/(proposals|screens)\/([\w-]+)\/restore$/))) {
    const body = await readBody(request);
    const target = match[1] === "proposals" ? { proposal: match[2] } : { screen: match[2] };
    return send(response, 200, await book.restore({ ...target, by: user?.name ?? body.by }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/proposals\/([\w-]+)\/approve$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.approve(match[1], user?.name ?? body.by, body.screen ?? null));
  }
  if (request.method === "POST" && path === "/api/stickies") {
    const body = await readBody(request);
    return send(response, 201, await book.addSticky({ ...body, by: user?.name ?? body.by }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/stickies\/([\w-]+)$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.updateSticky({ ...body, id: match[1], by: user?.name ?? body.by }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/stickies\/([\w-]+)\/delete$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.removeSticky({ id: match[1], by: user?.name ?? body.by }));
  }
  if (request.method === "GET" && (match = path.match(/^\/api\/boards\/([\w-]+)$/))) {
    const board = await book.board(match[1]);
    const since = Number(url.searchParams.get("since"));
    return send(response, 200, Number.isInteger(since) && since === board.rev ? { page: board.page, rev: board.rev, same: true } : board);
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/boards\/([\w-]+)$/))) {
    const body = await readBody(request, 4_000_000);
    const client = CLIENT.test(body.client ?? "") ? body.client : null;
    const result = await book.applyBoard({ page: match[1], ops: body.ops, by: user?.name ?? body.by ?? "" });
    if (result.ops.length) live.emit({ key, name: "board", data: { page: result.page, rev: result.rev, ops: result.ops, client } });
    return send(response, 200, { page: result.page, rev: result.rev, count: result.ops.length });
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/boards\/([\w-]+)\/preview$/))) {
    const body = await readBody(request, 400_000);
    const items = previewOf(body);
    if (!items || !CLIENT.test(body.client ?? "")) return send(response, 400, { error: "pass client and items" });
    live.emit({ key, name: "board-preview", data: { page: match[1], client: body.client, items, done: body.done === true }, except: body.client });
    return send(response, 204, "", "text/plain");
  }
  if (request.method === "POST" && path === "/api/pages") {
    const body = await readBody(request);
    return send(response, 201, await book.createPage({ name: body.name, kind: body.kind === "board" ? "board" : undefined, by: user?.name ?? body.by }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/pages\/([\w-]+)$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.updatePage({ page: match[1], name: body.name, index: body.index, by: user?.name ?? body.by }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/pages\/([\w-]+)\/delete$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.deletePage({ page: match[1], by: user?.name ?? body.by }));
  }
  if (request.method === "POST" && (match = path.match(/^\/api\/sections\/([\w-]+)\/page$/))) {
    const body = await readBody(request);
    return send(response, 200, await book.moveSection({ section: match[1], page: body.page, by: user?.name ?? body.by }));
  }
  return send(response, 404, { error: "not found" });
}

const GUEST_TEXT_LIMIT = 2000;

function sharePath(key, token) {
  return `${key ? `/${key}` : ""}/s/${token}`;
}

function goneLink(request, response, path) {
  if (/(^|\/)api\//.test(path)) return send(response, 404, { error: "this link expired or was revoked" });
  const language = languageOf(request);
  return send(
    response,
    404,
    `<!doctype html><html lang="${language}"><meta charset="utf-8"><title>Screenbook</title><body style="font-family:system-ui;padding:48px;max-width:520px"><h1 style="font-weight:400">${escapeHtml(translate(language, "Link unavailable"))}</h1><p>${escapeHtml(translate(language, "This link expired or was revoked. Ask whoever sent it for a new one."))}</p></body>`,
    "text/html; charset=utf-8",
  );
}

async function shareRoute({ book, base, token, request, response, path }) {
  const share = await book.openShare(token);
  if (!share) return goneLink(request, response, path);
  let match;
  if (path === "") {
    response.writeHead(302, { Location: `${base}/` });
    return response.end();
  }
  if (request.method === "GET" && path === "/") return send(response, 200, await viewerPage(base), TYPES[".html"]);
  if (request.method === "GET" && path === "/api/me") {
    return send(response, 200, { auth: false, user: null, share: { proposal: share.proposal, expiresAt: share.expiresAt } });
  }
  if (request.method === "GET" && path === "/api/overview") return send(response, 200, await book.sharedOverview(share));
  if (request.method === "GET" && (match = path.match(/^\/api\/screens\/([\w-]+)\/v(\d+)\.(html|png)$/))) {
    const [, id, version, kind] = match;
    await book.sharedScreen(share, id, Number(version));
    return kind === "html" ? sendScreenHtml(response, book, id, Number(version)) : sendScreenPng(response, book, id, Number(version));
  }
  if (request.method === "GET" && (match = path.match(/^\/api\/comments\/([\w-]+)$/))) {
    await book.sharedScreen(share, match[1]);
    return send(response, 200, await book.comments(match[1]));
  }
  if (request.method === "POST" && path === "/api/comments") {
    const body = await readBody(request);
    await book.sharedScreen(share, String(body.screen), body.version == null ? null : Number(body.version));
    const author = String(body.author ?? "").trim().slice(0, 40);
    if (!author) throw new Error("comment needs an author");
    if (String(body.text ?? "").length > GUEST_TEXT_LIMIT) throw new Error(`a comment from a shared link has at most ${GUEST_TEXT_LIMIT} characters`);
    const { screen, el, els, point, version, text, replyTo } = body;
    return send(response, 201, await book.comment({ screen, el, els, point, version, text, replyTo, author, kind: "guest" }));
  }
  return send(response, 404, { error: "not found" });
}

async function staticRoute(response, file) {
  if (!STATIC_FILES.has(file)) return send(response, 404, { error: "not found" });
  const content = await readFile(join(VIEWER, file));
  return send(response, 200, content, TYPES[extname(file)] ?? "application/octet-stream");
}

function connectPage({ login, callback, state, label, language }) {
  const tr = (text, vars) => escapeAttr(translate(language, text, vars));
  const field = (name, value) => `<input type="hidden" name="${name}" value="${escapeAttr(value)}">`;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${tr("Connect your chat")} · Screenbook</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/ui.css"><script>try{document.documentElement.dataset.theme=localStorage.getItem("screenbook.theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}</script></head><body class="connect-page"><main class="connect-card"><img src="/logo.svg" alt="" width="40" height="40"><h1>${tr("Connect your chat to Screenbook")}</h1><p>${tr("The chat on your computer will draw and comment as {login}. The key stays on that computer only and lasts 180 days.", { login: login })}</p><form method="post" action="/connect">${field("callback", callback)}${field("state", state)}${field("label", label)}<button class="btn primary">${tr("Connect")}</button></form></main></body></html>`;
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8000) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

async function connectRoute({ request, response, url, auth, keys }) {
  const input = request.method === "POST" ? await readForm(request) : Object.fromEntries(url.searchParams);
  const callback = String(input.callback ?? "");
  const state = String(input.state ?? "");
  const label = String(input.label ?? "chat").slice(0, 80);
  if (!isLoopback(callback) || !/^[\w-]{8,80}$/.test(state)) return send(response, 400, { error: translate(languageOf(request), "This connect link is not valid; start the login from your chat again") });
  const who = auth ? auth.user(request) : { login: "local", name: "local" };
  if (!who) return auth.redirect(response, `/auth/login?next=${encodeURIComponent(`/connect${url.search}`)}`);
  if (request.method !== "POST") return send(response, 200, connectPage({ login: who.login, callback, state, label, language: languageOf(request) }), TYPES[".html"]);
  const key = await keys.mint(who, label);
  const back = new URL(callback);
  back.searchParams.set("key", key);
  back.searchParams.set("state", state);
  response.writeHead(303, { Location: back.toString(), "Cache-Control": "no-store" });
  return response.end();
}

export function createViewerServer({ store, auth = null, live = createLive(), ai = null, keys = createKeys({ store }) }) {
  const single = new Book(store);
  const bookFor = productBooks(store);
  let multi = null;
  let checkedAt = 0;

  async function isMultiNow() {
    if (multi === null || Date.now() - checkedAt > 10000) {
      multi = await isMulti(store);
      checkedAt = Date.now();
    }
    return multi;
  }

  async function route(request, response) {
    const url = new URL(request.url, "http://local");
    const path = decodeURIComponent(url.pathname);

    if (path === "/healthz") return send(response, 200, { ok: true });
    if (auth && path.startsWith("/auth/")) return auth.handle(request, response, url);
    if (path === "/connect") return connectRoute({ request, response, url, auth, keys });
    if (request.method === "GET" && STATIC_FILES.has(path.slice(1))) return staticRoute(response, path.slice(1));
    const shared = path.match(/^(?:\/([a-z0-9][a-z0-9-]*))?\/s\/([\w-]+)(\/.*)?$/);
    if (shared && Boolean(shared[1]) === (await isMultiNow())) {
      const [, product, token, rest = ""] = shared;
      const book = product ? await bookFor(product) : single;
      return shareRoute({ book, base: sharePath(product, token), token, request, response, path: rest });
    }
    const presence = request.method === "POST" && /(^|\/)api\/(presence|rpc)$/.test(path);
    const internal = presence && ai ? ai.userFromToken(request) : null;
    const keyed = presence && !internal ? await keys.fromRequest(request) : null;
    const user = internal ?? keyed ?? (auth ? (auth.user(request) ?? (presence ? await auth.userFromToken(request) : null)) : null);
    if (auth && !user) {
      if (/(^|\/)api\//.test(path)) return send(response, 401, { error: "sign in with your GitHub account" });
      return auth.redirect(response, `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }

    if (request.method === "POST" && path === "/api/keys/revoke" && user && !user.via) return send(response, 200, { revoked: await keys.revokeAll(user.login) });

    if (!(await isMultiNow())) {
      if (request.method === "GET" && path === "/api/me") return send(response, 200, { auth: Boolean(auth), user, ai: Boolean(ai) });
      if (path.startsWith("/api/")) return apiRoute({ book: single, key: "", live, ai, auth, request, response, path, url, user });
      if (request.method === "GET" && path === "/") return send(response, 200, await viewerPage(""), TYPES[".html"]);
      return send(response, 404, { error: "not found" });
    }

    if (request.method === "GET" && path === "/") {
      return send(response, 200, productsPage(languageOf(request), await productSummaries(store)), TYPES[".html"]);
    }
    if (request.method === "POST" && path === "/api/rpc") {
      return rpcCall(request, response, {
        isMulti: () => true,
        listProducts: () => listProducts(store),
        createProduct: (input) => createProduct(store, input ?? {}).finally(() => (multi = null)),
      });
    }
    if (request.method === "GET" && path === "/api/products") {
      return send(response, 200, await listProducts(store));
    }
    if (request.method === "POST" && path === "/api/products") {
      const body = await readBody(request);
      const created = await createProduct(store, { name: body.name });
      multi = null;
      return send(response, 201, { ...created, url: `/${created.id}/` });
    }
    const match = path.match(/^\/([a-z0-9][a-z0-9-]*)(\/.*)?$/);
    if (!match) return send(response, 404, { error: "not found" });
    const [, product, rest = ""] = match;
    const book = await bookFor(product);
    if (rest === "") {
      response.writeHead(302, { Location: `/${product}/${url.search}` });
      return response.end();
    }
    if (request.method === "GET" && rest === "/api/me") return send(response, 200, { auth: Boolean(auth), user, ai: Boolean(ai) });
    if (rest.startsWith("/api/")) return apiRoute({ book, key: product, live, ai, auth, request, response, path: rest, url, user });
    if (request.method === "GET" && rest === "/") return send(response, 200, await viewerPage(`/${product}`), TYPES[".html"]);
    if (request.method === "GET" && STATIC_FILES.has(rest.slice(1))) return staticRoute(response, rest.slice(1));
    return send(response, 404, { error: "not found" });
  }

  return createServer((request, response) => {
    route(request, response).catch((error) => {
      const status = error.status ?? (/^no (screen|proposal|comment|product)|has no version/.test(error.message) ? 404 : 400);
      send(response, status, { error: error.message });
    });
  });
}
