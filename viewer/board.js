import { escapeHtml, MAC, openMenu } from "./menu.js";
import { t } from "./i18n.js";
import { BOARD_COLORS, INK_COLORS, SHAPES, STAMPS, STAMP_GLYPHS, applyOps, contentBox, defaultSize, expandOps, freshId, invertOps, itemBox, sectionMembers, sortedItems } from "./board-model.js";

const DOT_GAP = 24;
const PREVIEW_MS = 60;
const POLL_MS = 5000;
const NUDGE = 1;
const PASTE_STEP = 32;
const BOXED = new Set(["sticky", "shape", "text", "section", "screen"]);
const LINKABLE = new Set(["sticky", "shape", "text", "screen", "section", "stamp"]);
const SHAPE_PATHS = {
  rect: (w, h) => `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6"/>`,
  ellipse: (w, h) => `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 1}" ry="${h / 2 - 1}"/>`,
  diamond: (w, h) => `<path d="M${w / 2} 1 L${w - 1} ${h / 2} L${w / 2} ${h - 1} L1 ${h / 2} Z" stroke-linejoin="round"/>`,
};

const ICON = {
  move: '<path d="M5 3.5 19 10l-6.2 1.8L10 18z" stroke-linejoin="round"/>',
  hand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5V4a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.8-2.4L3.4 14a1.6 1.6 0 0 1 2.5-2l2.1 2" stroke-linecap="round" stroke-linejoin="round"/>',
  sticky: '<path d="M4 4h16v10l-6 6H4z" stroke-linejoin="round"/><path d="M14 20v-6h6" stroke-linejoin="round"/>',
  shape: '<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><circle cx="15.5" cy="15.5" r="5"/>',
  connector: '<path d="M4 19C10 19 8 6 18 6" stroke-linecap="round"/><path d="m15 3 3.5 3-3.5 3" stroke-linecap="round" stroke-linejoin="round"/>',
  text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" stroke-linecap="round" stroke-linejoin="round"/>',
  pen: '<path d="M4 20c3-1 4-4 7-7l6-6a2.1 2.1 0 0 0-3-3l-6 6c-3 3-6 4-7 7z" stroke-linejoin="round"/><path d="m13 5 3 3"/>',
  marker: '<path d="m9 15 7.5-10.5a2 2 0 0 1 3 2.5L11 17z" stroke-linejoin="round"/><path d="M9 15 7 19h4l0-2M4 21h16" stroke-linecap="round" stroke-linejoin="round"/>',
  section: '<path d="M3.5 7V5a1.5 1.5 0 0 1 1.5-1.5h5M3.5 11v9.5h17V11M20.5 7V5A1.5 1.5 0 0 0 19 3.5h-5" stroke-linecap="round"/><path d="M3.5 3.5h7v4h-7z" stroke-linejoin="round"/>',
  stamp: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9.5 9.5h.01M14.5 9.5h.01" stroke-linecap="round" stroke-width="2.2"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 20.5h8M12 17v3.5" stroke-linecap="round"/>',
  trash: '<path d="M4.5 7h15M10 4h4M6.5 7l1 13h9l1-13M10 11v5M14 11v5" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  open: '<path d="M14 4h6v6M20 4l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" stroke-linecap="round" stroke-linejoin="round"/>',
  arrow: '<path d="M4 12h15M14 7l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/>',
  line: '<path d="M4 12h16" stroke-linecap="round"/>',
};

const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${ICON[name]}</svg>`;
const shapeIcon = (kind) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${SHAPE_PATHS[kind](22, kind === "rect" ? 16 : 22).replace(/<(rect|ellipse|path) /, `<$1 transform="translate(1 ${kind === "rect" ? 4 : 1})" `)}</svg>`;

const TOOLS = [
  { id: "move", label: "Select", key: "V" },
  { id: "hand", label: "Hand", key: "H" },
  null,
  { id: "sticky", label: "Sticky note", key: "S" },
  { id: "shape", label: "Shape", key: "R" },
  { id: "connector", label: "Connector", key: "X" },
  { id: "text", label: "Text", key: "T" },
  { id: "pen", label: "Pen", key: "P" },
  { id: "marker", label: "Highlighter", key: "M" },
  { id: "section", label: "Section", key: "Shift+S" },
  { id: "stamp", label: "Stamp", key: "E" },
  { id: "screen", label: "Screen", key: "" },
];

const STAMP_NAMES = { plus1: "Plus one", heart: "Heart", check: "Check" };
const SHAPE_NAMES = { rect: "Rectangle", ellipse: "Circle", diamond: "Diamond" };

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let most = 0;
    for (let index = first + 1; index < last; index++) {
      const [px, py] = points[index];
      const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > most) {
        most = distance;
        far = index;
      }
    }
    if (most > tolerance && far > 0) {
      keep[far] = 1;
      stack.push([first, far], [far, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function smoothPath(points) {
  if (!points.length) return "";
  if (points.length < 3) return `M${points.map((point) => point.join(" ")).join(" L")}${points.length === 1 ? ` l0.1 0` : ""}`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length - 1; index++) {
    const [x, y] = points[index];
    const [nx, ny] = points[index + 1];
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = points.at(-1);
  return `${d} L${last[0]} ${last[1]}`;
}

function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const TYPE_NAMES = { sticky: "Sticky note", shape: "Shape", text: "Text", connector: "Connector", section: "Section", stamp: "Stamp", screen: "Screen" };

export function createBoard({ state, viewport, world, base, api, post, ensureName, myName, toast, liveId, openScreen, zoomTo, applyTransform, readOnly, menu, closeMenu, onSelect, onChange }) {
  const layer = document.createElement("div");
  layer.id = "board";
  layer.hidden = true;
  const wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wires.classList.add("bd-wires");
  layer.appendChild(wires);
  const overlay = document.createElement("div");
  overlay.className = "bd-overlay";
  layer.appendChild(overlay);
  world.appendChild(layer);

  const tray = document.createElement("div");
  tray.className = "fl bd-tray";
  tray.hidden = true;
  tray.innerHTML = '<div class="bd-sub" hidden></div><div class="bd-tools" role="toolbar"></div>';
  document.body.appendChild(tray);

  const bar = document.createElement("div");
  bar.className = "fl bd-bar";
  bar.hidden = true;
  document.body.appendChild(bar);

  const pop = document.createElement("div");
  pop.className = "fl bd-pop";
  pop.hidden = true;
  document.body.appendChild(pop);

  const empty = document.createElement("div");
  empty.className = "bd-empty";
  empty.hidden = true;
  empty.innerHTML = `<b>${escapeHtml(t("Empty board"))}</b><span>${escapeHtml(t("Press S for a sticky note, R for a shape, or ask the AI for a brainstorm."))}</span>`;
  document.body.appendChild(empty);

  let page = null;
  let rev = 0;
  let items = {};
  let loaded = false;
  const previews = new Map();
  const mine = new Map();
  let selection = new Set();
  let tool = "move";
  const choice = { sticky: "yellow", shape: "rect", stamp: "plus1", pen: "ink", marker: "yellow" };
  let gesture = null;
  let editing = null;
  let spaceDown = false;
  const history = { undo: [], redo: [] };
  const queue = [];
  let sending = false;
  let stale = false;
  let reloadTimer = null;
  let previewTimer = null;
  let previewSentAt = 0;
  let clipboard = null;
  let pastes = 0;
  let lastPointer = null;
  let untouched = true;
  const nodes = new Map();
  const labels = new Map();

  const toWorld = (clientX, clientY) => ({ x: (clientX - state.tx) / state.scale, y: (clientY - state.ty) / state.scale });
  const toScreen = (x, y) => ({ left: state.tx + x * state.scale, top: state.ty + y * state.scale });
  const view = (id) => {
    const base = items[id] ?? previews.get(id)?.item;
    if (!base) return null;
    const local = mine.get(id);
    const remote = previews.get(id)?.set;
    return local ? { ...base, ...remote, ...local } : remote ? { ...base, ...remote } : base;
  };
  const allIds = () => new Set([...Object.keys(items), ...[...previews.keys()].filter((id) => previews.get(id).item)]);
  const viewItems = () => Object.fromEntries([...allIds()].map((id) => [id, view(id)]).filter(([, item]) => item));
  const canEdit = () => !readOnly();

  function setToolTo(next) {
    tool = next;
    if (next !== "move") clearSelection();
    viewport.dataset.boardTool = next;
    hidePop();
    drawTray();
  }

  function drawTray() {
    const tools = tray.querySelector(".bd-tools");
    tools.innerHTML = TOOLS.map((entry) =>
      entry
        ? `<button type="button" data-bd-tool="${entry.id}" class="${tool === entry.id ? "on" : ""}" title="${escapeHtml(t(entry.label))}${entry.key ? ` (${entry.key})` : ""}" aria-label="${escapeHtml(t(entry.label))}" aria-pressed="${tool === entry.id}">${entry.id === "sticky" ? `<span class="bd-tool-sticky c-${choice.sticky}"></span>` : icon(entry.id)}</button>`
        : '<span class="bd-tools-sep"></span>',
    ).join("");
    tools.querySelectorAll("[data-bd-tool]").forEach((button) =>
      button.addEventListener("click", (event) => {
        const id = button.dataset.bdTool;
        if (id === "screen") return openScreenPicker(event);
        setToolTo(id);
      }),
    );
    const sub = tray.querySelector(".bd-sub");
    const swatches = (list, key, ink) =>
      list.map((color) => `<button type="button" class="bd-swatch ${ink ? "ink" : ""} c-${color}${choice[key] === color ? " on" : ""}" data-choice="${key}" data-value="${color}" title="${escapeHtml(t(color))}" aria-label="${escapeHtml(t(color))}"></button>`).join("");
    let html = "";
    if (tool === "sticky") html = swatches(BOARD_COLORS, "sticky");
    if (tool === "shape") html = SHAPES.map((kind) => `<button type="button" class="bd-kind${choice.shape === kind ? " on" : ""}" data-choice="shape" data-value="${kind}" title="${escapeHtml(t(SHAPE_NAMES[kind]))}" aria-label="${escapeHtml(t(SHAPE_NAMES[kind]))}">${shapeIcon(kind)}</button>`).join("");
    if (tool === "stamp") html = STAMPS.map((kind) => `<button type="button" class="bd-kind bd-stamp-pick s-${kind}${choice.stamp === kind ? " on" : ""}" data-choice="stamp" data-value="${kind}" title="${escapeHtml(t(STAMP_NAMES[kind]))}" aria-label="${escapeHtml(t(STAMP_NAMES[kind]))}"><span>${STAMP_GLYPHS[kind]}</span></button>`).join("");
    if (tool === "pen") html = swatches(INK_COLORS, "pen", true);
    if (tool === "marker") html = swatches(["yellow", "pink", "green", "blue", "violet", "orange"], "marker");
    sub.innerHTML = html;
    sub.hidden = !html;
    sub.querySelectorAll("[data-choice]").forEach((button) =>
      button.addEventListener("click", () => {
        choice[button.dataset.choice] = button.dataset.value;
        drawTray();
      }),
    );
  }

  function hidePop() {
    pop.hidden = true;
    pop.innerHTML = "";
  }

  function openScreenPicker(event) {
    if (!pop.hidden) return hidePop();
    const screens = (state.data?.screens ?? []).filter((screen) => screen.versions?.length);
    pop.innerHTML = `<input type="search" class="bd-pop-search" placeholder="${escapeHtml(t("Find a screen"))}" aria-label="${escapeHtml(t("Find a screen"))}"><div class="bd-pop-list"></div>`;
    const list = pop.querySelector(".bd-pop-list");
    const fill = (query) => {
      const words = query.trim().toLowerCase();
      const found = screens.filter((screen) => !words || `${screen.number} ${screen.name}`.toLowerCase().includes(words)).slice(0, 60);
      list.innerHTML = found.length
        ? found.map((screen) => `<button type="button" data-screen="${escapeHtml(screen.id)}"><b>${screen.number}</b><span>${escapeHtml(screen.name)}</span></button>`).join("")
        : `<p>${escapeHtml(t(screens.length ? "No screen with that name." : "This product has no screens yet."))}</p>`;
      list.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => placeScreen(button.dataset.screen)));
    };
    fill("");
    pop.hidden = false;
    const box = event.currentTarget.getBoundingClientRect();
    pop.style.left = `${Math.max(12, Math.min(box.left - 120, window.innerWidth - pop.offsetWidth - 12))}px`;
    pop.style.top = `${box.top - pop.offsetHeight - 10}px`;
    const input = pop.querySelector("input");
    input.addEventListener("input", () => fill(input.value));
    input.addEventListener("keydown", (key) => {
      key.stopPropagation();
      if (key.key === "Escape") hidePop();
      if (key.key === "Enter") list.querySelector("[data-screen]")?.click();
    });
    input.focus();
  }

  function screenVersion(screenId, version) {
    const screen = state.data?.screens.find((entry) => entry.id === screenId);
    if (!screen) return null;
    return { screen, version: version ?? screen.official ?? screen.versions.at(-1)?.v };
  }

  function placeScreen(screenId) {
    hidePop();
    const center = toWorld(viewport.clientWidth / 2, viewport.clientHeight / 2);
    const [w, h] = defaultSize("screen");
    const made = commit([{ op: "add", item: { type: "screen", screen: screenId, x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2) } }]);
    setToolTo("move");
    if (made) select([made[0].item.id]);
  }

  function anchorOn(box, toward) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (Math.abs(dx) / Math.max(1, box.w) > Math.abs(dy) / Math.max(1, box.h)) {
      const side = Math.sign(dx) || 1;
      return { x: cx + (side * box.w) / 2, y: cy, nx: side, ny: 0 };
    }
    const side = Math.sign(dy) || 1;
    return { x: cx, y: cy + (side * box.h) / 2, nx: 0, ny: side };
  }

  function wireGeometry(connector, all) {
    const target = (end) => (end.id && all[end.id] ? itemBox(all[end.id], all) : null);
    const fromBox = target(connector.from);
    const toBox = target(connector.to);
    const centerOf = (box, end) => (box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : { x: end.x, y: end.y });
    const fromCenter = centerOf(fromBox, connector.from);
    const toCenter = centerOf(toBox, connector.to);
    const a = fromBox ? anchorOn(fromBox, toCenter) : { ...fromCenter, nx: 0, ny: 0 };
    const b = toBox ? anchorOn(toBox, fromCenter) : { ...toCenter, nx: 0, ny: 0 };
    const reach = Math.max(36, Math.hypot(b.x - a.x, b.y - a.y) / 3);
    const c1 = { x: a.x + a.nx * reach, y: a.y + a.ny * reach };
    const c2 = { x: b.x + b.nx * reach, y: b.y + b.ny * reach };
    const curve = (t1) => {
      const u = 1 - t1;
      return { x: u * u * u * a.x + 3 * u * u * t1 * c1.x + 3 * u * t1 * t1 * c2.x + t1 * t1 * t1 * b.x, y: u * u * u * a.y + 3 * u * u * t1 * c1.y + 3 * u * t1 * t1 * c2.y + t1 * t1 * t1 * b.y };
    };
    const tail = b.nx || b.ny ? { x: -b.nx, y: -b.ny } : (() => {
      const near = curve(0.96);
      const length = Math.hypot(b.x - near.x, b.y - near.y) || 1;
      return { x: (b.x - near.x) / length, y: (b.y - near.y) / length };
    })();
    const size = 11;
    const tip = { x: b.x, y: b.y };
    const back = { x: tip.x - tail.x * size, y: tip.y - tail.y * size };
    const head = `M${back.x + tail.y * size * 0.55} ${back.y - tail.x * size * 0.55} L${tip.x} ${tip.y} L${back.x - tail.y * size * 0.55} ${back.y + tail.x * size * 0.55}`;
    const endAt = connector.end === "arrow" ? { x: tip.x - tail.x * 2, y: tip.y - tail.y * 2 } : b;
    const d = `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${endAt.x} ${endAt.y}`;
    return { a, b, d, head, middle: curve(0.5) };
  }

  function fitText(node, max, min) {
    const text = node.querySelector(".bd-text");
    if (!text) return;
    let size = max;
    text.style.fontSize = `${size}px`;
    while (size > min && (text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1)) {
      size -= size > 24 ? 4 : 2;
      text.style.fontSize = `${size}px`;
    }
  }

  function authorLine(item) {
    return item.by ? `<span class="bd-by">${escapeHtml(item.by)}</span>` : "";
  }

  function textHtml(item, placeholder) {
    return item.text ? escapeHtml(item.text) : `<span class="bd-placeholder">${escapeHtml(placeholder)}</span>`;
  }

  function build(item) {
    const type = item.type;
    if (type === "path") {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      node.innerHTML = '<path class="bd-ink"/>';
      return node;
    }
    const node = document.createElement("div");
    return node;
  }

  function paint(node, item, all) {
    const type = item.type;
    const key = JSON.stringify([type, item.text, item.color, item.shape, item.w, item.h, item.stamp, item.screen, item.version, item.size, item.by, item.points?.length, item.marker, item.stroke, state.data ? 1 : 0]);
    const changed = node.dataset.key !== key;
    node.dataset.key = key;
    node.dataset.bid = item.id;
    if (type === "path") {
      const box = itemBox(item, all);
      node.setAttribute("class", `bd-item bd-path${item.marker ? " marker" : ""} c-${item.color}`);
      node.setAttribute("width", Math.max(1, box.w));
      node.setAttribute("height", Math.max(1, box.h));
      node.setAttribute("viewBox", `${box.x - item.x} ${box.y - item.y} ${Math.max(1, box.w)} ${Math.max(1, box.h)}`);
      node.style.left = `${box.x}px`;
      node.style.top = `${box.y}px`;
      if (changed) {
        const path = node.firstChild;
        path.setAttribute("d", smoothPath(item.points));
        path.setAttribute("stroke-width", item.stroke);
      }
      return;
    }
    node.className = `bd-item bd-${type === "text" ? "textitem" : type}${item.color ? ` c-${item.color}` : ""}${type === "shape" ? ` shape-${item.shape}` : ""}${type === "stamp" ? ` s-${item.stamp}` : ""}`;
    node.style.left = `${item.x}px`;
    node.style.top = `${item.y}px`;
    if (type !== "stamp") node.style.width = `${item.w}px`;
    if (type !== "text" && type !== "stamp") node.style.height = `${item.h}px`;
    if (!changed || editing === item.id) return;
    if (type === "sticky") {
      node.innerHTML = `<div class="bd-text">${textHtml(item, t("Add text"))}</div>${authorLine(item)}`;
      requestAnimationFrame(() => fitText(node, 22, 10));
    } else if (type === "shape") {
      node.innerHTML = `<svg class="bd-shape-art" viewBox="0 0 ${item.w} ${item.h}" preserveAspectRatio="none">${SHAPE_PATHS[item.shape](item.w, item.h)}</svg><div class="bd-text">${item.text ? escapeHtml(item.text) : ""}</div>`;
      requestAnimationFrame(() => fitText(node, 18, 9));
    } else if (type === "text") {
      node.innerHTML = `<div class="bd-text" style="font-size:${item.size}px">${textHtml(item, t("Add text"))}</div>`;
    } else if (type === "section") {
      node.innerHTML = `<div class="bd-section-name" data-bid="${escapeHtml(item.id)}">${item.text ? escapeHtml(item.text) : `<span class="bd-placeholder">${escapeHtml(t("Untitled section"))}</span>`}</div>`;
    } else if (type === "stamp") {
      node.innerHTML = `<span>${STAMP_GLYPHS[item.stamp]}</span>`;
      node.title = t(STAMP_NAMES[item.stamp]) + (item.by ? ` · ${item.by}` : "");
    } else if (type === "screen") {
      const found = screenVersion(item.screen, item.version);
      node.innerHTML = found
        ? `<div class="bd-screen-shot"><img src="${base}/api/screens/${encodeURIComponent(item.screen)}/v${found.version}.png" alt="" draggable="false" loading="lazy" onerror="this.remove()"></div><div class="bd-screen-name"><b>${found.screen.number}</b><span>${escapeHtml(found.screen.name)}</span></div>`
        : `<div class="bd-screen-shot"></div><div class="bd-screen-name"><span>${escapeHtml(t("Screen not found"))}</span></div>`;
    }
  }

  function drawItems() {
    const all = viewItems();
    const order = sortedItems(all);
    const alive = new Set();
    order.forEach((item, index) => {
      if (item.type === "connector") return;
      alive.add(item.id);
      let node = nodes.get(item.id);
      if (node && (node.tagName.toLowerCase() === "svg") !== (item.type === "path")) {
        node.remove();
        node = null;
      }
      if (!node) {
        node = build(item);
        nodes.set(item.id, node);
        layer.insertBefore(node, wires);
      }
      paint(node, item, all);
      node.style.zIndex = item.type === "section" ? String(1 + index) : String(10000 + index);
    });
    for (const [id, node] of nodes) {
      if (alive.has(id)) continue;
      node.remove();
      nodes.delete(id);
    }
    drawWires(all);
  }

  function drawWires(all) {
    const svg = [];
    const alive = new Set();
    for (const item of Object.values(all)) {
      if (item.type !== "connector") continue;
      const geometry = wireGeometry(item, all);
      const on = selection.has(item.id) ? " on" : "";
      svg.push(`<g class="bd-wire c-${item.color}${on}" data-bid="${escapeHtml(item.id)}"><path class="bd-wire-hit" d="${geometry.d}"/><path class="bd-wire-line" d="${geometry.d}"/>${item.end === "arrow" ? `<path class="bd-wire-head" d="${geometry.head}"/>` : ""}</g>`);
      if (item.text || editing === item.id) {
        alive.add(item.id);
        let label = labels.get(item.id);
        if (!label) {
          label = document.createElement("div");
          label.className = "bd-wire-label";
          label.dataset.bid = item.id;
          label.innerHTML = '<div class="bd-text"></div>';
          labels.set(item.id, label);
          layer.appendChild(label);
        }
        label.style.left = `${geometry.middle.x}px`;
        label.style.top = `${geometry.middle.y}px`;
        if (editing !== item.id) label.firstChild.textContent = item.text;
      }
    }
    wires.innerHTML = svg.join("");
    for (const [id, label] of labels) {
      if (alive.has(id)) continue;
      label.remove();
      labels.delete(id);
    }
  }

  function selectionBox(ids = selection) {
    const all = viewItems();
    const boxes = [...ids].map((id) => all[id]).filter(Boolean).map((item) => itemBox(item, all));
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    return { x: left, y: top, w: Math.max(...boxes.map((box) => box.x + box.w)) - left, h: Math.max(...boxes.map((box) => box.y + box.h)) - top };
  }

  function drawSelection() {
    const all = viewItems();
    for (const id of [...selection]) if (!all[id]) selection.delete(id);
    const parts = [];
    const only = selection.size === 1 ? all[[...selection][0]] : null;
    for (const id of selection) {
      const item = all[id];
      if (item.type === "connector") {
        const geometry = wireGeometry(item, all);
        parts.push(`<i class="bd-end" data-end="from" data-for="${escapeHtml(id)}" style="left:${geometry.a.x}px;top:${geometry.a.y}px"></i><i class="bd-end" data-end="to" data-for="${escapeHtml(id)}" style="left:${geometry.b.x}px;top:${geometry.b.y}px"></i>`);
        continue;
      }
      const box = itemBox(item, all);
      parts.push(`<div class="bd-sel${selection.size > 1 ? " many" : ""}" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"></div>`);
    }
    if (selection.size > 1) {
      const box = selectionBox();
      if (box) parts.push(`<div class="bd-sel group" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"></div>`);
    }
    if (only && BOXED.has(only.type) && canEdit() && !editing) {
      const box = itemBox(only, all);
      for (const corner of ["nw", "ne", "sw", "se"]) {
        const x = corner.includes("w") ? box.x : box.x + box.w;
        const y = corner.includes("n") ? box.y : box.y + box.h;
        parts.push(`<i class="bd-handle ${corner}" data-handle="${corner}" style="left:${x}px;top:${y}px"></i>`);
      }
    }
    if (only && LINKABLE.has(only.type) && canEdit() && !editing && tool === "move") {
      const box = itemBox(only, all);
      const dots = [
        ["n", box.x + box.w / 2, box.y],
        ["s", box.x + box.w / 2, box.y + box.h],
        ["w", box.x, box.y + box.h / 2],
        ["e", box.x + box.w, box.y + box.h / 2],
      ];
      for (const [side, x, y] of dots) parts.push(`<i class="bd-link ${side}" data-link="${escapeHtml(only.id)}" style="left:${x}px;top:${y}px"></i>`);
    }
    if (gesture?.type === "lasso") {
      const { x, y, w, h } = gesture.rect;
      parts.push(`<div class="bd-lasso" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
    }
    if (gesture?.type === "create" && gesture.rect) {
      const { x, y, w, h } = gesture.rect;
      parts.push(`<div class="bd-ghost ${gesture.kind}${gesture.kind === "shape" ? ` shape-${choice.shape}` : ""}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
    }
    if (gesture?.type === "wire" && gesture.moved) {
      const draft = { type: "connector", from: gesture.from, to: gesture.target ? { id: gesture.target } : gesture.point, end: "arrow" };
      const geometry = wireGeometry(draft, all);
      parts.push(`<svg class="bd-draft"><path d="${geometry.d}"/><path d="${geometry.head}"/></svg>`);
      if (gesture.target && all[gesture.target]) {
        const box = itemBox(all[gesture.target], all);
        parts.push(`<div class="bd-target" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"></div>`);
      }
    }
    overlay.innerHTML = parts.join("");
    wires.querySelectorAll(".bd-wire").forEach((node) => node.classList.toggle("on", selection.has(node.dataset.bid)));
    drawBar();
    onChange?.();
  }

  function labelOf(item, all, depth = 0) {
    if (!item) return "";
    const first = String(item.text ?? "").split("\n").find((line) => line.trim())?.trim();
    if (item.type === "connector") {
      const end = (side) => (side.id && all[side.id] && depth < 1 ? labelOf(all[side.id], all, depth + 1) : "·");
      return item.text ? `${item.text}: ${end(item.from)} → ${end(item.to)}` : `${end(item.from)} → ${end(item.to)}`;
    }
    if (item.type === "path") return t(item.marker ? "Highlighter" : "Pen");
    if (item.type === "stamp") return t(STAMP_NAMES[item.stamp]);
    if (item.type === "screen") {
      const found = screenVersion(item.screen, item.version);
      return found ? `${found.screen.number} · ${found.screen.name}` : t("Screen not found");
    }
    if (first) return first.length > 60 ? `${first.slice(0, 60)}…` : first;
    return item.type === "section" ? t("Untitled section") : t(TYPE_NAMES[item.type]);
  }

  function layerRows(query) {
    const all = viewItems();
    const byPlace = (a, b) => a.y - b.y || a.x - b.x;
    const sections = Object.values(all).filter((item) => item.type === "section").sort(byPlace);
    const placed = new Set();
    const groups = sections.map((section) => {
      const members = sectionMembers(section, all).filter((item) => !placed.has(item.id)).sort(byPlace);
      members.forEach((item) => placed.add(item.id));
      return { section, members };
    });
    const loose = Object.values(all)
      .filter((item) => item.type !== "section" && !placed.has(item.id))
      .sort((a, b) => (a.type === "connector") - (b.type === "connector") || byPlace(a, b));
    const words = fold(query).split(/\s+/).filter(Boolean);
    const hit = (item) => !words.length || words.every((word) => fold(labelOf(item, all)).includes(word));
    return {
      all,
      searching: words.length > 0,
      groups: groups.map(({ section, members }) => ({ section, members: words.length && hit(section) ? members : members.filter(hit), show: hit(section) || members.some(hit) })).filter((group) => group.show),
      loose: loose.filter(hit),
    };
  }

  function layerRow(item, all, nested) {
    const mark = item.type === "connector" || item.type === "path" || item.type === "text" ? `<i class="bd-ly-mark t-line c-${item.color}"></i>` : `<i class="bd-ly-mark t-${item.type} c-${item.color ?? ""}${item.type === "shape" ? ` shape-${item.shape}` : ""}${item.type === "stamp" ? ` s-${item.stamp}` : ""}"></i>`;
    return `<button class="ly-screen bd-ly${nested ? " nested" : ""}${selection.has(item.id) ? " on" : ""}" data-board-item="${escapeHtml(item.id)}" title="${escapeHtml(t(TYPE_NAMES[item.type] ?? "Pen"))}">${mark}<span class="sb-name">${escapeHtml(labelOf(item, all))}</span></button>`;
  }

  function renderLayers(list, query = "") {
    if (!page) return;
    const { all, groups, loose, searching } = layerRows(query);
    if (!groups.length && !loose.length) {
      list.innerHTML = `<p class="sb-empty">${escapeHtml(t(searching ? "Nothing on the board by that name." : "Nothing on this board yet."))}</p>`;
      return;
    }
    const html = [
      ...groups.map(({ section, members }) => `<div class="ly-section open"><button class="ly-name bd-ly-section${selection.has(section.id) ? " on" : ""}" data-board-item="${escapeHtml(section.id)}"><i class="bd-ly-mark t-section c-${section.color}"></i><span class="sb-name">${escapeHtml(labelOf(section, all))}</span><span class="n">${members.length}</span></button></div><div class="ly-children">${members.map((item) => layerRow(item, all, true)).join("")}</div>`),
      ...loose.map((item) => layerRow(item, all, false)),
    ].join("");
    if (list.dataset.boardLayers === html) return;
    list.dataset.boardLayers = html;
    list.innerHTML = html;
    list.querySelectorAll("[data-board-item]").forEach((button) => button.addEventListener("click", () => focusItem(button.dataset.boardItem)));
    list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }

  function focusItem(id) {
    const all = viewItems();
    const item = all[id];
    if (!item) return;
    const box = itemBox(item, all);
    const pad = Math.max(80, Math.max(box.w, box.h) * 0.4);
    zoomTo({ left: box.x - pad, top: box.y - pad, right: box.x + box.w + pad, bottom: box.y + box.h + pad }, 0, 1.25);
    untouched = false;
    select([id]);
  }

  function drawBar() {
    const all = viewItems();
    const chosen = [...selection].map((id) => all[id]).filter(Boolean);
    if (!chosen.length || !canEdit() || gesture?.moved || editing || !page) {
      bar.hidden = true;
      return;
    }
    const types = new Set(chosen.map((item) => item.type));
    const pieces = [];
    const colorful = chosen.filter((item) => ["sticky", "shape", "section"].includes(item.type));
    const inked = chosen.filter((item) => ["text", "connector", "path"].includes(item.type) && !(item.type === "path" && item.marker));
    if (colorful.length && colorful.length === chosen.length) pieces.push(BOARD_COLORS.map((color) => `<button type="button" class="bd-swatch c-${color}${colorful.every((item) => item.color === color) ? " on" : ""}" data-set-color="${color}" title="${escapeHtml(t(color))}" aria-label="${escapeHtml(t(color))}"></button>`).join(""));
    if (inked.length && inked.length === chosen.length) pieces.push(INK_COLORS.map((color) => `<button type="button" class="bd-swatch ink c-${color}${inked.every((item) => item.color === color) ? " on" : ""}" data-set-color="${color}" title="${escapeHtml(t(color))}" aria-label="${escapeHtml(t(color))}"></button>`).join(""));
    if (types.size === 1 && types.has("shape")) pieces.push(SHAPES.map((kind) => `<button type="button" class="bd-kind${chosen.every((item) => item.shape === kind) ? " on" : ""}" data-set-shape="${kind}" title="${escapeHtml(t(SHAPE_NAMES[kind]))}" aria-label="${escapeHtml(t(SHAPE_NAMES[kind]))}">${shapeIcon(kind)}</button>`).join(""));
    if (types.size === 1 && types.has("text")) pieces.push([["Small", 14], ["Medium", 18], ["Large", 32]].map(([label, size]) => `<button type="button" class="bd-size${chosen.every((item) => item.size === size) ? " on" : ""}" data-set-size="${size}" title="${escapeHtml(t(label))}">${label[0]}</button>`).join(""));
    if (types.size === 1 && types.has("connector")) pieces.push(`<button type="button" class="bd-kind${chosen.every((item) => item.end === "arrow") ? " on" : ""}" data-set-end="arrow" title="${escapeHtml(t("Arrow"))}" aria-label="${escapeHtml(t("Arrow"))}">${icon("arrow")}</button><button type="button" class="bd-kind${chosen.every((item) => item.end === "none") ? " on" : ""}" data-set-end="none" title="${escapeHtml(t("No arrow"))}" aria-label="${escapeHtml(t("No arrow"))}">${icon("line")}</button>`);
    if (chosen.length === 1 && chosen[0].type === "screen" && screenVersion(chosen[0].screen, chosen[0].version)) pieces.push(`<button type="button" class="bd-kind wide" data-open-screen title="${escapeHtml(t("Open screen"))}">${icon("open")}<span>${escapeHtml(t("Open screen"))}</span></button>`);
    pieces.push(`<button type="button" class="bd-kind" data-duplicate title="${escapeHtml(t("Duplicate"))} (${MAC ? "⌘" : "Ctrl+"}D)" aria-label="${escapeHtml(t("Duplicate"))}">${icon("copy")}</button><button type="button" class="bd-kind" data-remove title="${escapeHtml(t("Delete"))}" aria-label="${escapeHtml(t("Delete"))}">${icon("trash")}</button>`);
    bar.innerHTML = pieces.map((piece) => `<div class="bd-bar-group">${piece}</div>`).join('<span class="bd-bar-sep"></span>');
    bar.hidden = false;
    placeBar();
    const ids = chosen.map((item) => item.id);
    bar.querySelectorAll("[data-set-color]").forEach((button) => button.addEventListener("click", () => commit(ids.map((id) => ({ op: "update", id, set: { color: button.dataset.setColor } })))));
    bar.querySelectorAll("[data-set-shape]").forEach((button) => button.addEventListener("click", () => commit(ids.map((id) => ({ op: "update", id, set: { shape: button.dataset.setShape } })))));
    bar.querySelectorAll("[data-set-size]").forEach((button) => button.addEventListener("click", () => commit(ids.map((id) => ({ op: "update", id, set: { size: Number(button.dataset.setSize) } })))));
    bar.querySelectorAll("[data-set-end]").forEach((button) => button.addEventListener("click", () => commit(ids.map((id) => ({ op: "update", id, set: { end: button.dataset.setEnd } })))));
    bar.querySelector("[data-open-screen]")?.addEventListener("click", () => openCard(chosen[0]));
    bar.querySelector("[data-duplicate]").addEventListener("click", () => duplicateSelection());
    bar.querySelector("[data-remove]").addEventListener("click", () => removeSelection());
  }

  function placeBar() {
    if (bar.hidden) return;
    const box = selectionBox();
    if (!box) return;
    const top = toScreen(box.x + box.w / 2, box.y);
    const bottom = toScreen(box.x, box.y + box.h);
    const width = bar.offsetWidth;
    let y = top.top - bar.offsetHeight - 40;
    if (y < 56) y = bottom.top + 40;
    bar.style.left = `${Math.max(12, Math.min(top.left - width / 2, window.innerWidth - width - 12))}px`;
    bar.style.top = `${Math.min(window.innerHeight - bar.offsetHeight - 80, y)}px`;
  }

  function render() {
    if (!page) return;
    drawItems();
    drawSelection();
    onChange?.();
    empty.hidden = !loaded || allIds().size > 0 || Boolean(gesture);
  }

  function select(ids, add = false) {
    selection = new Set(add ? [...selection, ...ids] : ids);
    drawSelection();
    onSelect?.([...selection]);
  }

  function clearSelection() {
    if (!selection.size) return;
    selection = new Set();
    drawSelection();
    onSelect?.([]);
  }

  function commit(ops, { record = true, mergeLast = false } = {}) {
    if (!canEdit() || !page || !ops.length) return null;
    const before = items;
    let expanded;
    try {
      expanded = expandOps({ rev, items }, ops, { by: myName() ?? "", makeId: freshId });
    } catch (error) {
      toast(t("Could not save: {error}", { error: error.message }));
      return null;
    }
    if (!expanded.ops.length) return null;
    const inverse = invertOps(before, expanded.ops);
    items = expanded.items;
    if (record) {
      const last = history.undo.at(-1);
      if (mergeLast && last) {
        last.redo = [...last.redo, ...expanded.ops];
        last.undo = [...inverse, ...last.undo];
      } else history.undo.push({ undo: inverse, redo: expanded.ops });
      if (history.undo.length > 200) history.undo.shift();
      history.redo = [];
    }
    queue.push(...expanded.ops);
    flush();
    render();
    return expanded.ops;
  }

  async function flush() {
    if (sending || !queue.length) return;
    const by = await ensureName();
    if (!by) {
      queue.length = 0;
      stale = true;
      return reload();
    }
    sending = true;
    const target = page;
    while (queue.length && target === page) {
      const batch = queue.splice(0, 300);
      try {
        const result = await post(`${base}/api/boards/${encodeURIComponent(target)}`, { ops: batch, client: liveId, by });
        if (result.rev > rev) {
          clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => result.rev > rev && reload(), 2500);
        }
      } catch (error) {
        toast(t("Could not save: {error}", { error: error.message }));
        stale = true;
      }
    }
    sending = false;
    if (stale) reload();
  }

  async function reload() {
    if (!page) return;
    if (sending || queue.length || gesture || editing) {
      stale = true;
      return;
    }
    stale = false;
    const target = page;
    const board = await api(`${base}/api/boards/${encodeURIComponent(target)}`).catch(() => null);
    if (!board || target !== page || sending || queue.length) return;
    items = board.items ?? {};
    rev = board.rev ?? 0;
    loaded = true;
    render();
  }

  async function poll() {
    if (!page || document.hidden || sending || queue.length || gesture || editing) return;
    const target = page;
    const answer = await api(`${base}/api/boards/${encodeURIComponent(target)}?since=${rev}`).catch(() => null);
    if (!answer || answer.same || target !== page || sending || queue.length || gesture || editing) return;
    items = answer.items ?? {};
    rev = answer.rev ?? 0;
    render();
  }

  function received(data) {
    if (!page || data.page !== page) return;
    if (data.rev <= rev) return;
    if (data.rev !== rev + 1) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reload, 150);
      return;
    }
    rev = data.rev;
    const ops = data.client === liveId ? data.ops.filter((op) => op.op === "delete") : data.ops;
    items = applyOps(items, ops);
    for (const op of ops) {
      const id = op.item?.id ?? op.id;
      if (previews.has(id) && data.client !== liveId) previews.delete(id);
    }
    if (editing && !items[editing]) editing = null;
    render();
    if (untouched && !gesture && !editing && ops.some((op) => op.op !== "delete") && !allInView()) fit();
  }

  function allInView() {
    const box = contentBox(viewItems());
    if (!box) return true;
    const topLeft = toScreen(box.left, box.top);
    const bottomRight = toScreen(box.right, box.bottom);
    return topLeft.left >= 0 && topLeft.top >= 40 && bottomRight.left <= viewport.clientWidth && bottomRight.top <= viewport.clientHeight - 80;
  }

  function previewed(data) {
    if (!page || data.page !== page || data.client === liveId) return;
    for (const [id, entry] of previews) if (entry.client === data.client) previews.delete(id);
    if (!data.done) {
      for (const raw of data.items) {
        const { id, ...set } = raw;
        if (items[id]) previews.set(id, { client: data.client, set });
        else if (raw.type) previews.set(id, { client: data.client, item: raw });
      }
    }
    render();
  }

  function sendPreview(done = false) {
    clearTimeout(previewTimer);
    previewTimer = null;
    if (!page) return;
    const list = done ? [] : [...mine].map(([id, set]) => ({ id, ...set }));
    if (gesture?.type === "draw" && gesture.item && !done) list.push(gesture.item);
    previewSentAt = Date.now();
    fetch(`${base}/api/boards/${encodeURIComponent(page)}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: liveId, items: list, done }) }).catch(() => {});
  }

  function schedulePreview() {
    if (previewTimer) return;
    previewTimer = setTimeout(() => sendPreview(false), Math.max(0, PREVIEW_MS - (Date.now() - previewSentAt)));
  }

  function hitId(event) {
    const node = event.target.closest?.("[data-bid]");
    if (!node || !layer.contains(node)) return null;
    return node.dataset.bid;
  }

  function targetAt(clientX, clientY, skip) {
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      if (!layer.contains(node)) continue;
      const owner = node.closest("[data-bid]");
      const id = owner?.dataset.bid;
      if (!id || id === skip) continue;
      const item = view(id);
      if (item && LINKABLE.has(item.type)) return id;
    }
    const point = toWorld(clientX, clientY);
    const all = viewItems();
    const sections = Object.values(all).filter((item) => item.type === "section" && item.id !== skip);
    const found = sections.reverse().find((item) => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h);
    return found?.id ?? null;
  }

  function movingIds(ids) {
    const all = viewItems();
    const out = new Set(ids);
    for (const id of ids) {
      const item = all[id];
      if (item?.type === "section") for (const member of sectionMembers(item, all)) out.add(member.id);
    }
    return [...out].filter((id) => all[id] && (all[id].type !== "connector" || all[id].from.id === undefined || all[id].to.id === undefined));
  }

  function startMove(event, id) {
    if (event.altKey && canEdit()) {
      const copied = duplicate([...selection], 0);
      if (copied) {
        select(copied);
        id = copied[0];
      }
    }
    const ids = movingIds([...selection]);
    const all = viewItems();
    gesture = {
      type: "move",
      start: toWorld(event.clientX, event.clientY),
      origin: new Map(ids.map((key) => [key, all[key].type === "connector" ? { from: all[key].from, to: all[key].to } : { x: all[key].x, y: all[key].y }])),
      moved: false,
      merge: event.altKey,
      clicked: id,
    };
  }

  function updateMove(event) {
    const point = toWorld(event.clientX, event.clientY);
    let dx = point.x - gesture.start.x;
    let dy = point.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) * state.scale < 3) return;
    if (event.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    gesture.moved = true;
    for (const [id, origin] of gesture.origin) {
      if (origin.from) {
        const shift = (end) => (end.id ? end : { x: Math.round(end.x + dx), y: Math.round(end.y + dy) });
        mine.set(id, { from: shift(origin.from), to: shift(origin.to) });
      } else mine.set(id, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
    }
    render();
    schedulePreview();
  }

  function finishLocal(record = {}) {
    const ops = [...mine].map(([id, set]) => ({ op: "update", id, set }));
    mine.clear();
    sendPreview(true);
    if (ops.length) commit(ops, record);
    else render();
  }

  function startResize(event, corner) {
    const id = [...selection][0];
    const item = view(id);
    gesture = { type: "resize", id, corner, start: toWorld(event.clientX, event.clientY), box: { x: item.x, y: item.y, w: item.w, h: item.h ?? item.w }, ratio: item.w / (item.h || 1), moved: false, kind: item.type };
  }

  function updateResize(event) {
    const point = toWorld(event.clientX, event.clientY);
    const { box, corner, ratio, kind } = gesture;
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    gesture.moved = true;
    const min = kind === "stamp" ? 24 : 40;
    let left = box.x;
    let top = box.y;
    let right = box.x + box.w;
    let bottom = box.y + box.h;
    if (corner.includes("w")) left = Math.min(right - min, box.x + dx);
    else right = Math.max(left + min, box.x + box.w + dx);
    if (corner.includes("n")) top = Math.min(bottom - min, box.y + dy);
    else bottom = Math.max(top + min, box.y + box.h + dy);
    let w = right - left;
    let h = bottom - top;
    if (event.shiftKey || kind === "screen") {
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
      if (corner.includes("w")) left = right - w;
      if (corner.includes("n")) top = bottom - h;
    }
    const set = kind === "text" ? { x: Math.round(left), w: Math.round(w) } : { x: Math.round(left), y: Math.round(top), w: Math.round(w), h: Math.round(h) };
    mine.set(gesture.id, set);
    render();
    schedulePreview();
  }

  function startLasso(event) {
    const start = toWorld(event.clientX, event.clientY);
    gesture = { type: "lasso", start, rect: { x: start.x, y: start.y, w: 0, h: 0 }, add: event.shiftKey, before: new Set(selection), moved: false };
  }

  function updateLasso(event) {
    const point = toWorld(event.clientX, event.clientY);
    const { start } = gesture;
    gesture.rect = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y) };
    if (gesture.rect.w * state.scale > 3 || gesture.rect.h * state.scale > 3) gesture.moved = true;
    const { x, y, w, h } = gesture.rect;
    const all = viewItems();
    const hits = Object.values(all)
      .filter((item) => {
        const box = itemBox(item, all);
        if (item.type === "section") return box.x >= x && box.y >= y && box.x + box.w <= x + w && box.y + box.h <= y + h;
        return box.x < x + w && box.x + box.w > x && box.y < y + h && box.y + box.h > y;
      })
      .map((item) => item.id);
    selection = new Set(gesture.add ? [...gesture.before, ...hits] : hits);
    drawSelection();
  }

  function startCreate(event, kind) {
    const start = toWorld(event.clientX, event.clientY);
    gesture = { type: "create", kind, start, rect: null, moved: false };
  }

  function updateCreate(event) {
    const point = toWorld(event.clientX, event.clientY);
    const { start } = gesture;
    if (!gesture.moved && Math.hypot(point.x - start.x, point.y - start.y) * state.scale < 4) return;
    gesture.moved = true;
    let w = Math.abs(point.x - start.x);
    let h = Math.abs(point.y - start.y);
    if (event.shiftKey) w = h = Math.max(w, h);
    gesture.rect = { x: point.x < start.x ? start.x - w : start.x, y: point.y < start.y ? start.y - h : start.y, w, h };
    drawSelection();
  }

  function finishCreate() {
    const { kind, start, rect, moved } = gesture;
    gesture = null;
    const [dw, dh] = defaultSize(kind);
    const box = moved && rect && rect.w > 8 && rect.h > 8 ? rect : { x: start.x - dw / 2, y: start.y - dh / 2, w: dw, h: dh };
    const round = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
    const item = kind === "shape" ? { type: "shape", shape: choice.shape, ...round } : { type: "section", ...round };
    const made = commit([{ op: "add", item }]);
    setToolTo("move");
    if (!made) return;
    select([made[0].item.id]);
    editText(made[0].item.id);
  }

  function startDraw(event, marker) {
    const start = toWorld(event.clientX, event.clientY);
    const id = freshId();
    gesture = {
      type: "draw",
      origin: start,
      points: [[0, 0]],
      item: { id, type: "path", x: Math.round(start.x), y: Math.round(start.y), points: [[0, 0]], color: marker ? choice.marker : choice.pen, marker, stroke: marker ? 18 : 3, z: 0 },
      moved: false,
    };
    previews.set(id, { client: liveId, item: gesture.item });
  }

  function updateDraw(event) {
    const point = toWorld(event.clientX, event.clientY);
    const relative = [Math.round((point.x - gesture.origin.x) * 10) / 10, Math.round((point.y - gesture.origin.y) * 10) / 10];
    const last = gesture.points.at(-1);
    if (Math.hypot(relative[0] - last[0], relative[1] - last[1]) * state.scale < 2) return;
    gesture.moved = true;
    if (gesture.points.length >= 1400) return;
    gesture.points.push(relative);
    gesture.item = { ...gesture.item, points: gesture.points };
    previews.set(gesture.item.id, { client: liveId, item: gesture.item });
    render();
    schedulePreview();
  }

  function finishDraw() {
    const { item, points } = gesture;
    gesture = null;
    previews.delete(item.id);
    sendPreview(true);
    const clean = simplify(points, 0.8 / state.scale);
    const { z, ...rest } = item;
    commit([{ op: "add", item: { ...rest, points: clean.length === 1 ? [...clean, [0.5, 0.5]] : clean } }]);
  }

  function startWire(event, from) {
    const start = toWorld(event.clientX, event.clientY);
    gesture = { type: "wire", from: from ? { id: from } : { x: Math.round(start.x), y: Math.round(start.y) }, point: start, target: null, moved: false, origin: start };
  }

  function updateWire(event) {
    const point = toWorld(event.clientX, event.clientY);
    if (!gesture.moved && Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y) * state.scale < 4) return;
    gesture.moved = true;
    gesture.point = { x: Math.round(point.x), y: Math.round(point.y) };
    gesture.target = targetAt(event.clientX, event.clientY, gesture.from.id);
    drawSelection();
  }

  function finishWire() {
    const { from, point, target, moved } = gesture;
    gesture = null;
    if (!moved) return drawSelection();
    const made = commit([{ op: "add", item: { type: "connector", from, to: target ? { id: target } : point, end: "arrow", color: "ink" } }]);
    setToolTo("move");
    if (made) select([made[0].item.id]);
  }

  function startEnd(event, id, end) {
    gesture = { type: "end", id, end, moved: false };
  }

  function updateEnd(event) {
    gesture.moved = true;
    const item = view(gesture.id);
    const other = gesture.end === "from" ? item.to.id : item.from.id;
    const target = targetAt(event.clientX, event.clientY, other);
    const point = toWorld(event.clientX, event.clientY);
    mine.set(gesture.id, { [gesture.end]: target && target !== gesture.id ? { id: target } : { x: Math.round(point.x), y: Math.round(point.y) } });
    render();
    schedulePreview();
  }

  function placeAt(event, kind) {
    const point = toWorld(event.clientX, event.clientY);
    if (kind === "sticky") {
      const [w, h] = defaultSize("sticky");
      const made = commit([{ op: "add", item: { type: "sticky", x: Math.round(point.x - w / 2), y: Math.round(point.y - h / 2), color: choice.sticky } }]);
      setToolTo("move");
      if (made) {
        select([made[0].item.id]);
        editText(made[0].item.id);
      }
    } else if (kind === "text") {
      const made = commit([{ op: "add", item: { type: "text", x: Math.round(point.x), y: Math.round(point.y - 14), w: 240, h: 40, size: 18 } }]);
      setToolTo("move");
      if (made) {
        select([made[0].item.id]);
        editText(made[0].item.id, { dropEmpty: true });
      }
    } else if (kind === "stamp") {
      commit([{ op: "add", item: { type: "stamp", stamp: choice.stamp, x: Math.round(point.x - 22), y: Math.round(point.y - 22) } }]);
    }
  }

  function editText(id, { dropEmpty = false } = {}) {
    if (!canEdit()) return;
    const item = view(id);
    if (!item || !["sticky", "shape", "text", "section", "connector"].includes(item.type)) return;
    editing = id;
    if (item.type === "connector") drawWires(viewItems());
    const holder = item.type === "connector" ? labels.get(id) : nodes.get(id);
    if (!holder) {
      editing = null;
      return;
    }
    holder.classList.add("editing");
    const field = holder.querySelector(item.type === "section" ? ".bd-section-name" : ".bd-text");
    field.textContent = item.text;
    field.contentEditable = "plaintext-only";
    if (field.contentEditable !== "plaintext-only") field.contentEditable = "true";
    field.spellcheck = false;
    field.dataset.placeholder = item.type === "section" ? t("Section name") : item.type === "connector" ? t("Label") : t("Add text");
    drawSelection();
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const stop = (event) => event.stopPropagation();
    field.addEventListener("pointerdown", stop);
    field.addEventListener("dblclick", stop);
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey || item.type === "section" || item.type === "connector"))) {
        event.preventDefault();
        field.blur();
      }
    });
    field.addEventListener("input", () => {
      if (item.type === "sticky") fitText(holder, 22, 10);
      if (item.type === "shape") fitText(holder, 18, 9);
    });
    field.addEventListener(
      "blur",
      () => {
        const text = field.innerText.replace(/\n$/, "").slice(0, item.type === "section" ? 120 : 4000);
        field.contentEditable = "false";
        holder.classList.remove("editing");
        editing = null;
        holder.dataset.key = "";
        if (item.type === "text" && dropEmpty && !text.trim()) {
          commit([{ op: "delete", id }], { mergeLast: true });
          return;
        }
        if (item.type === "text" && !text.trim()) {
          commit([{ op: "delete", id }]);
          return;
        }
        const set = { text };
        if (item.type === "text") set.h = Math.max(24, Math.round(field.offsetHeight));
        if (text !== item.text) commit([{ op: "update", id, set }], { mergeLast: dropEmpty || isFresh(id) });
        else render();
        if (stale) reload();
      },
      { once: true },
    );
  }

  function isFresh(id) {
    const last = history.undo.at(-1);
    return Boolean(last?.redo.length === 1 && last.redo[0].op === "add" && last.redo[0].item.id === id);
  }

  function duplicate(ids, offset = 24) {
    const all = viewItems();
    const chosen = ids.map((id) => all[id]).filter(Boolean);
    if (!chosen.length) return null;
    const map = new Map(chosen.map((item) => [item.id, freshId()]));
    for (const item of Object.values(all)) {
      if (item.type === "connector" && !map.has(item.id) && map.has(item.from.id) && map.has(item.to.id)) map.set(item.id, freshId());
    }
    const ops = [];
    for (const [oldId, newId] of map) {
      const item = all[oldId];
      const copy = structuredClone(item);
      copy.id = newId;
      delete copy.z;
      delete copy.by;
      if (item.type === "connector") {
        const remap = (end) => (end.id ? { id: map.get(end.id) ?? end.id } : { x: end.x + offset, y: end.y + offset });
        copy.from = remap(item.from);
        copy.to = remap(item.to);
      } else {
        copy.x += offset;
        copy.y += offset;
      }
      ops.push({ op: "add", item: copy });
    }
    const sorted = ops.sort((a, b) => (a.item.type === "connector") - (b.item.type === "connector"));
    const made = commit(sorted);
    return made ? made.filter((op) => op.op === "add").map((op) => op.item.id).filter((id) => [...map.values()].includes(id)) : null;
  }

  function duplicateSelection() {
    const made = duplicate([...selection]);
    if (made) select(made);
  }

  function removeSelection() {
    if (!selection.size) return;
    commit([...selection].map((id) => ({ op: "delete", id })));
    clearSelection();
  }

  function copySelection() {
    const all = viewItems();
    const ids = new Set(selection);
    for (const item of Object.values(all)) if (item.type === "connector" && ids.has(item.from.id) && ids.has(item.to.id)) ids.add(item.id);
    clipboard = [...ids].map((id) => structuredClone(all[id])).filter(Boolean);
    pastes = 0;
  }

  function paste() {
    if (!clipboard?.length) return;
    pastes += 1;
    const map = new Map(clipboard.map((item) => [item.id, freshId()]));
    const shift = PASTE_STEP * pastes;
    const ops = clipboard
      .map((item) => {
        const copy = structuredClone(item);
        copy.id = map.get(item.id);
        delete copy.z;
        delete copy.by;
        if (copy.type === "connector") {
          const remap = (end) => (end.id ? { id: map.get(end.id) ?? end.id } : { x: end.x + shift, y: end.y + shift });
          copy.from = remap(item.from);
          copy.to = remap(item.to);
        } else {
          copy.x += shift;
          copy.y += shift;
        }
        return { op: "add", item: copy };
      })
      .sort((a, b) => (a.item.type === "connector") - (b.item.type === "connector"));
    const made = commit(ops);
    if (made) select(made.filter((op) => op.op === "add").map((op) => op.item.id));
  }

  function undo(redo = false) {
    const from = redo ? history.redo : history.undo;
    const entry = from.pop();
    if (!entry) return;
    commit(redo ? entry.redo : entry.undo, { record: false });
    (redo ? history.undo : history.redo).push(entry);
    for (const id of [...selection]) if (!items[id]) selection.delete(id);
    drawSelection();
  }

  function openCard(item) {
    const found = screenVersion(item.screen, item.version);
    if (found) openScreen(found.screen.id, found.version);
  }

  function itemMenu(event, id) {
    if (!selection.has(id)) select([id]);
    const item = view(id);
    const entries = [];
    if (["sticky", "shape", "text", "section", "connector"].includes(item.type)) entries.push({ label: t("Edit text"), run: () => editText(id) });
    if (item.type === "screen") entries.push({ label: t("Open screen"), run: () => openCard(item) });
    if (entries.length) entries.push(null);
    entries.push(
      { label: t("Duplicate"), keys: "Mod+D", run: duplicateSelection },
      { label: t("Bring to front"), run: () => commit([...selection].map((key) => ({ op: "front", id: key }))) },
      { label: t("Send to back"), run: () => commit([...selection].map((key) => ({ op: "back", id: key }))) },
      null,
      { label: t("Delete"), keys: "⌫", run: removeSelection },
    );
    openMenu({ menu, close: closeMenu, event, title: "", entries });
  }

  for (const type of ["pointerdown", "wheel"]) viewport.addEventListener(type, () => (untouched = false), { capture: true, passive: true });

  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (!page) return;
      hidePop();
      if (editing && !event.target.closest?.("[contenteditable]")) document.activeElement?.blur?.();
      const panning = spaceDown || tool === "hand" || event.button === 1;
      if (panning || event.button !== 0 || !canEdit()) {
        if (!canEdit() && event.button === 0 && !panning) {
          const id = hitId(event);
          if (id && view(id)?.type === "screen") {
            event.stopImmediatePropagation();
            openCard(view(id));
          }
        }
        return;
      }
      const handle = event.target.closest?.("[data-handle]");
      const link = event.target.closest?.("[data-link]");
      const end = event.target.closest?.("[data-end]");
      const id = hitId(event);
      if (tool === "move" && event.pointerType === "touch" && !id && !handle && !link && !end) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      lastPointer = { x: event.clientX, y: event.clientY };
      if (handle) return startResize(event, handle.dataset.handle);
      if (end) return startEnd(event, end.dataset.for, end.dataset.end);
      if (link) return startWire(event, link.dataset.link);
      if (tool === "pen" || tool === "marker") return startDraw(event, tool === "marker");
      if (tool === "connector") return startWire(event, id && LINKABLE.has(view(id)?.type) ? id : targetAt(event.clientX, event.clientY));
      if (tool === "shape" || tool === "section") return startCreate(event, tool);
      if (tool === "sticky" || tool === "text" || tool === "stamp") {
        gesture = { type: "place", kind: tool };
        return;
      }
      if (id) {
        if (event.shiftKey) {
          const next = new Set(selection);
          next.has(id) ? next.delete(id) : next.add(id);
          select([...next]);
          if (!next.has(id)) return;
        } else if (!selection.has(id)) select([id]);
        return startMove(event, id);
      }
      startLasso(event);
    },
    true,
  );

  window.addEventListener("pointermove", (event) => {
    if (!page) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (!gesture) return;
    if (gesture.type === "move") updateMove(event);
    else if (gesture.type === "resize") updateResize(event);
    else if (gesture.type === "lasso") updateLasso(event);
    else if (gesture.type === "create") updateCreate(event);
    else if (gesture.type === "draw") updateDraw(event);
    else if (gesture.type === "wire") updateWire(event);
    else if (gesture.type === "end") updateEnd(event);
  });

  window.addEventListener("pointerup", (event) => {
    if (!page || !gesture) return;
    const done = gesture;
    if (done.type === "move") {
      gesture = null;
      if (done.moved) finishLocal({ mergeLast: done.merge });
      else if (!event.shiftKey && selection.size > 1 && done.clicked) select([done.clicked]);
      else drawSelection();
    } else if (done.type === "resize" || done.type === "end") {
      gesture = null;
      finishLocal();
    } else if (done.type === "lasso") {
      gesture = null;
      if (!done.moved && !done.add) clearSelection();
      drawSelection();
      onSelect?.([...selection]);
    } else if (done.type === "create") finishCreate();
    else if (done.type === "draw") finishDraw();
    else if (done.type === "wire") finishWire();
    else if (done.type === "place") {
      gesture = null;
      placeAt(event, done.kind);
    }
    if (stale && !gesture) reload();
  });

  viewport.addEventListener(
    "dblclick",
    (event) => {
      if (!page || !canEdit()) return;
      const id = hitId(event);
      event.stopImmediatePropagation();
      if (!id) {
        if (tool !== "move") return;
        const point = toWorld(event.clientX, event.clientY);
        const [w, h] = defaultSize("sticky");
        const made = commit([{ op: "add", item: { type: "sticky", x: Math.round(point.x - w / 2), y: Math.round(point.y - h / 2), color: choice.sticky } }]);
        if (made) {
          select([made[0].item.id]);
          editText(made[0].item.id);
        }
        return;
      }
      const item = view(id);
      if (item.type === "screen") return openCard(item);
      select([id]);
      editText(id);
    },
    true,
  );

  viewport.addEventListener(
    "contextmenu",
    (event) => {
      if (!page || !canEdit()) return;
      const id = hitId(event);
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      itemMenu(event, id);
    },
    true,
  );

  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spaceDown = false;
      viewport.classList.remove("bd-panning");
    }
  });

  function handleKey(event) {
    if (!page) return false;
    if (event.target.closest?.("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")) return false;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.code === "Space" && !mod) {
      spaceDown = true;
      viewport.classList.add("bd-panning");
      event.preventDefault();
      return true;
    }
    if (!canEdit()) return false;
    if (mod && key === "z") {
      event.preventDefault();
      undo(event.shiftKey);
      return true;
    }
    if (mod && key === "y") {
      event.preventDefault();
      undo(true);
      return true;
    }
    if (mod && key === "d") {
      event.preventDefault();
      duplicateSelection();
      return true;
    }
    if (mod && key === "a") {
      event.preventDefault();
      select(Object.keys(items));
      return true;
    }
    if (mod && key === "c" && selection.size) {
      copySelection();
      return true;
    }
    if (mod && key === "x" && selection.size) {
      copySelection();
      removeSelection();
      return true;
    }
    if (mod && key === "v" && clipboard) {
      event.preventDefault();
      paste();
      return true;
    }
    if (mod || event.altKey) return false;
    if ((event.key === "Backspace" || event.key === "Delete") && selection.size) {
      event.preventDefault();
      removeSelection();
      return true;
    }
    if (event.key === "Escape") {
      if (!pop.hidden) hidePop();
      else if (gesture) {
        mine.clear();
        if (gesture.type === "draw") previews.delete(gesture.item.id);
        gesture = null;
        sendPreview(true);
        render();
      } else if (selection.size) clearSelection();
      else if (tool !== "move") setToolTo("move");
      else return false;
      return true;
    }
    if (event.key === "Enter" && selection.size === 1) {
      event.preventDefault();
      editText([...selection][0]);
      return true;
    }
    if (event.key.startsWith("Arrow") && selection.size) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : NUDGE;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      commit(movingIds([...selection]).filter((id) => view(id).type !== "connector").map((id) => ({ op: "move", id, dx, dy })));
      return true;
    }
    const shortcuts = { v: "move", h: "hand", s: event.shiftKey ? "section" : "sticky", n: "sticky", r: "shape", x: "connector", t: "text", p: "pen", m: "marker", e: "stamp" };
    if (shortcuts[key]) {
      setToolTo(shortcuts[key]);
      return true;
    }
    return false;
  }

  function onTransform() {
    if (!page) return;
    const gap = DOT_GAP * state.scale;
    const step = gap < 10 ? gap * Math.ceil(10 / gap) : gap;
    viewport.style.backgroundSize = `${step}px ${step}px`;
    viewport.style.backgroundPosition = `${state.tx}px ${state.ty}px`;
    placeBar();
  }

  function fit() {
    const box = contentBox(viewItems());
    if (!box) {
      state.manual = true;
      state.scale = 1;
      state.tx = viewport.clientWidth / 2;
      state.ty = viewport.clientHeight / 2;
      applyTransform();
      return;
    }
    zoomTo({ left: box.left - 80, top: box.top - 80, right: box.right + 80, bottom: box.bottom + 80 }, 0, 1);
  }

  function zoomToSelection() {
    const box = selectionBox();
    if (box) zoomTo({ left: box.x - 80, top: box.y - 80, right: box.x + box.w + 80, bottom: box.y + box.h + 80 }, 0, 1.5);
  }

  async function enter(pageId) {
    if (page === pageId) return;
    leave();
    page = pageId;
    state.boardPage = true;
    rev = 0;
    items = {};
    loaded = false;
    untouched = true;
    history.undo = [];
    history.redo = [];
    layer.hidden = false;
    tray.hidden = !canEdit();
    document.body.classList.add("board-on");
    setToolTo("move");
    await reload();
    if (page === pageId) fit();
  }

  function leave() {
    if (!page) return;
    if (editing) document.activeElement?.blur?.();
    page = null;
    state.boardPage = false;
    items = {};
    previews.clear();
    mine.clear();
    gesture = null;
    selection = new Set();
    for (const node of nodes.values()) node.remove();
    nodes.clear();
    for (const label of labels.values()) label.remove();
    labels.clear();
    wires.innerHTML = "";
    overlay.innerHTML = "";
    layer.hidden = true;
    tray.hidden = true;
    bar.hidden = true;
    empty.hidden = true;
    hidePop();
    document.body.classList.remove("board-on");
    viewport.style.backgroundSize = "";
    viewport.style.backgroundPosition = "";
    delete viewport.dataset.boardTool;
    onSelect?.([]);
  }

  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });

  return {
    enter,
    leave,
    render,
    fit,
    zoomToSelection,
    handleKey,
    onTransform,
    received,
    previewed,
    reconnected: () => reload(),
    renderLayers,
    focusItem,
    active: () => Boolean(page),
    selected: () => [...selection],
    debug: () => ({ page, rev, items, selection: [...selection], tool }),
  };
}
