import { createInspector } from "./inspect.js";
import { createEditing } from "./edit.js";
import { createHistory } from "./history.js";
import { createPresenter, playVersion } from "./present.js";
import { fetchBlob, fileName, saveBlob } from "./export.js";
import { clientId, startLive } from "./live.js";
import { createBoard } from "./board.js";
import { isBoard } from "./pages.js";
import { closedLabel, closedVersion, isClosed, pinnedVersions } from "./proposal.js";
import { annotationPreview, isAnnotation, splitAnnotations } from "./annotations.js";
import { arrange } from "./arrange.js";
import { createTabs } from "./tabs.js";
import { createLayers } from "./layers.js";
import { createZoom } from "./zoom.js";
import { createPalette } from "./palette.js";
import { createStickies } from "./stickies.js";
import { startAi } from "./ai.js";
import { lang, t, translateDom } from "./i18n.js";

translateDom(document.body);
document.documentElement.lang = lang;

let aiPanel = null;

const FRAME_WIDTH = 320;
const FRAME_GAP = 64;
const MAX_PER_ROW = 18;
const ROW_GAP = 70;
const VARIANT_GAP = 48;
const TALL_FRAME = FRAME_WIDTH * 3;
const PHONE_MAX_WIDTH = 600;
const SECTION_PAD = 72;
const SECTION_GAP = 260;
const ANNO_GAP = 40;
const ANNO_WIDTH = 210;
const ANNO_SPACE = ANNO_GAP + ANNO_WIDTH;
const POLL_MS = 4000;
const BASE = document.querySelector('meta[name="screenbook-base"]')?.content ?? "";
const HANDLE = (new URLSearchParams(location.search).get("handle") ?? "claude").toLowerCase();

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const $ = (selector) => document.querySelector(selector);
const phone = () => matchMedia("(max-width: 760px)").matches;
const viewport = $("#viewport");
const world = $("#world");
const edges = $("#edges");
world.appendChild(edges);

const state = {
  data: null,
  signature: "",
  focus: null,
  tool: "move",
  note: null,
  boxes: {},
  sections: [],
  view: "canvas",
  scale: 1,
  tx: 0,
  ty: 0,
  fitted: false,
  manual: false,
  placed: [],
  selected: null,
  overlay: null,
  annotation: null,
  showAnnotations: true,
  archivedOpen: false,
  device: "all",
};

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatAnnotation(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

function withMentions(text) {
  return escapeHtml(text).replace(/(^|[^\w@])@([a-z][\w-]*)/gi, '$1<span class="mention">@$2</span>');
}

function authorTag(message) {
  if (message.kind === "agent") return ' <span class="tag plain">chat</span>';
  if (message.kind === "guest") return ` <span class="tag plain">${t("via link")}</span>`;
  return "";
}

function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
}

function timeAgo(iso) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso)) / 1000));
  if (seconds < 60) return t("just now");
  if (seconds < 3600) return t("{n} min ago", { n: Math.round(seconds / 60) });
  if (seconds < 86400) return t("{n}h ago", { n: Math.round(seconds / 3600) });
  return t("{n}d ago", { n: Math.round(seconds / 86400) });
}

function toast(message, action) {
  const element = $("#toast");
  element.textContent = t(message);
  if (action) {
    const button = document.createElement("button");
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      element.hidden = true;
      action.run();
    });
    element.appendChild(button);
  }
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (element.hidden = true), action ? 12000 : 3200);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? t("error {status}", { status: response.status }));
  return body;
}

function post(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

let signedIn = null;
let shared = null;

function myName() {
  return signedIn?.name ?? storageGet("screenbook.name");
}

function askName() {
  if (signedIn) {
    location.href = "/auth/logout";
    return Promise.resolve(null);
  }
  const dialog = $("#name-dialog");
  const input = $("#name-input");
  input.value = myName() ?? "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const name = input.value.trim();
        if (name) {
          storageSet("screenbook.name", name);
          renderMe();
        }
        resolve(myName());
      },
      { once: true },
    );
  });
}

async function ensureName() {
  return myName() ?? (await askName());
}

function renderMe() {
  const name = myName();
  if (signedIn) {
    $("#me").title = t("Sign out");
    $("#me").innerHTML = `${signedIn.avatar ? `<img class="avatar" src="${escapeHtml(signedIn.avatar)}" alt="">` : `<span class="avatar">${escapeHtml(initials(name))}</span>`}${escapeHtml(name)}`;
    return;
  }
  $("#me").innerHTML = name ? `<span class="avatar">${escapeHtml(initials(name))}</span>${escapeHtml(name)}` : t("Sign in with your name");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme").innerHTML = theme === "dark" ? SUN : MOON;
  storageSet("screenbook.theme", theme);
}

function versionEntry(screen, version) {
  return screen.versions.find((entry) => entry.v === version);
}

function deviceOf(item) {
  const entry = versionEntry(item.screen, item.version);
  return entry && entry.width <= PHONE_MAX_WIDTH ? "mobile" : "desktop";
}

function showsDevice(item) {
  return state.device === "all" || deviceOf(item) === state.device;
}

function availableDevices() {
  const found = new Set();
  for (const screen of state.data?.screens ?? []) {
    if (!tabs.visible(screen.section)) continue;
    for (const item of itemsFor(screen)) found.add(deviceOf(item));
  }
  return found;
}

function renderDeviceFilter() {
  const found = availableDevices();
  if (state.device !== "all" && !found.has(state.device)) state.device = "all";
  const both = found.size > 1;
  document.querySelectorAll("#device-filter [data-device]").forEach((button) => {
    const device = button.dataset.device;
    const on = device === state.device;
    button.classList.toggle("on", on);
    button.setAttribute("aria-checked", String(on));
    button.disabled = device !== "all" && !both;
    button.title = button.disabled
      ? t(found.has(device) ? "Every screen here is already this size" : device === "mobile" ? "No phone screens here" : "No desktop screens here")
      : t(device === "all" ? "All screens" : device === "mobile" ? "Phone screens only" : "Desktop screens only");
  });
}

function setDevice(device) {
  if (device === state.device) return;
  state.device = device;
  render();
  fit();
}

function screenById(id) {
  return state.data.screens.find((screen) => screen.id === id);
}

function openProposals() {
  return state.data.proposals.filter((proposal) => proposal.status === "open");
}

function proposalById(id) {
  return state.data.proposals.find((proposal) => proposal.id === id) ?? null;
}

function frozen(item) {
  return item.kind === "proposal" && isClosed(item.proposal);
}

function placedOfProposal(proposal) {
  return state.placed.filter((entry) => proposal.screens[entry.item.screen.id] === entry.item.version);
}

function proposalOfVersion(screenId, version) {
  return state.data.proposals.find((proposal) => proposal.screens[screenId] === version);
}

function previousVersion(screen, version) {
  return screen.versions.filter((entry) => entry.v < version).at(-1)?.v ?? null;
}

function compareBase(screen, version) {
  if (screen.official && screen.official !== version) return { version: screen.official, official: true };
  const previous = previousVersion(screen, version);
  return previous ? { version: previous, official: false } : null;
}

function compareLabel(base) {
  return base.official ? t("Compare with official") : t("See previous version · v{version}", { version: base.version });
}

async function openCompare(item) {
  await openOverlay(item.screen.id, item.version);
  state.overlay.compare = true;
  renderOverlay();
}

function focusedProposals() {
  if (state.focus === "all") return openProposals();
  const proposal = proposalById(state.focus);
  return proposal ? [proposal] : [];
}

function itemsFor(screen) {
  const items = [];
  if (screen.official) {
    items.push({ screen, version: screen.official, kind: "official" });
  }
  if (state.focus) {
    for (const proposal of focusedProposals()) {
      const version = proposal.screens[screen.id];
      if (version && version !== screen.official) items.push({ screen, version, kind: "proposal", proposal });
    }
  }
  return items;
}

const loadedShots = new Map();
const latestShotOfScreen = new Map();
let screensPainted = null;

function reusableShot(key) {
  const shot = loadedShots.get(key);
  if (!shot || shot.tagName !== "IMG") return null;
  return shot.isConnected ? shot.cloneNode() : shot;
}

function attachShot(item, entry, box) {
  const key = `${item.screen.id}/v${item.version}`;
  const ready = reusableShot(key);
  if (ready) {
    box.prepend(ready);
    return;
  }
  const shownBefore = latestShotOfScreen.get(item.screen.id);
  const changed = shownBefore ? shownBefore !== key : screensPainted !== null && !screensPainted.has(item.screen.id);
  box.classList.add(changed ? "dreaming" : "loading");
  const previous = changed ? reusableShot(shownBefore) : null;
  if (previous) {
    previous.classList.add("ghost");
    box.prepend(previous);
  }
  const reveal = (shot) => {
    loadedShots.set(key, shot);
    latestShotOfScreen.set(item.screen.id, key);
    box.classList.remove("loading");
    if (!box.classList.contains("dreaming")) return;
    box.classList.remove("dreaming");
    box.classList.add("revealed");
    previous?.remove();
    previous?.classList.remove("ghost");
    shot.addEventListener("animationend", () => box.classList.remove("revealed"), { once: true });
  };
  const image = new Image();
  image.alt = item.screen.name;
  image.loading = "lazy";
  image.className = "shot-img";
  image.addEventListener("load", () => reveal(image), { once: true });
  image.addEventListener("error", () => {
    const frame = document.createElement("iframe");
    frame.src = `${BASE}/api/screens/${item.screen.id}/v${item.version}.html`;
    frame.loading = "lazy";
    frame.tabIndex = -1;
    frame.className = "shot-img";
    frame.style.width = `${entry.width}px`;
    frame.style.height = `${entry.height}px`;
    frame.style.transform = `scale(${FRAME_WIDTH / entry.width})`;
    frame.addEventListener("load", () => reveal(frame), { once: true });
    image.replaceWith(frame);
  }, { once: true });
  image.src = `${BASE}/api/screens/${item.screen.id}/v${item.version}.png`;
  box.prepend(image);
}

function frameHeight(item) {
  const entry = versionEntry(item.screen, item.version);
  return Math.round((FRAME_WIDTH * entry.height) / entry.width);
}

function frameElement(item, x, y) {
  const entry = versionEntry(item.screen, item.version);
  const height = frameHeight(item);
  const element = document.createElement("div");
  element.className = `frame ${item.kind}`;
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  const label = item.screen.name;
  const hint = item.kind === "official"
    ? t("Screen {number} · official · v{version}", { number: item.screen.number, version: item.version })
    : t("Screen {number} · {title}{closed} · v{version}", { number: item.screen.number, title: item.proposal.title, closed: frozen(item) ? ` · ${closedLabel(item.proposal).toLowerCase()}` : "", version: item.version });
  const base = compareBase(item.screen, item.version);
  const caption = `<span class="num ${item.kind === "official" ? "live" : "prop"}">${item.screen.number}</span><span class="cap-text" title="${escapeHtml(hint)}">${escapeHtml(label)}</span>`;
  element.innerHTML = `<div class="cap">${caption}</div><div class="shot"><div class="box" style="width:${FRAME_WIDTH}px;height:${height}px"></div><div class="pins"></div><div class="annos"></div>${
    base ? `<button type="button" class="prev-btn">${escapeHtml(compareLabel(base))}</button>` : ""
  }</div>`;
  const box = element.querySelector(".box");
  const previousButton = element.querySelector(".prev-btn");
  previousButton?.addEventListener("pointerdown", (event) => event.stopPropagation());
  previousButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openCompare(item);
  });
  attachShot(item, entry, box);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (phone() && moved) return;
    if (state.tool === "comment") return startDraft(item, box, event);
    if (state.tool === "edit" && !frozen(item)) return openEditor(item.screen.id, item.version, []);
    if (phone()) return openOverlay(item.screen.id, item.version);
    select(item);
  });
  box.addEventListener("mousemove", (event) => hoverPiece(item, box, event));
  box.addEventListener("mouseleave", () => hoverPiece(item, box, null));
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openFrameMenu(item, event);
  });
  element.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    openOverlay(item.screen.id, item.version);
  });
  return { element, height };
}

function renderCanvas() {
  world.querySelectorAll(".frame, .section").forEach((node) => node.remove());
  edges.innerHTML = "";
  state.placed = [];
  state.sections = [];
  const { project, screens } = state.data;
  let y = 0;
  for (const { section, groups } of arrange(project.sections, screens)) {
    if (!tabs.visible(section.id)) continue;
    const columns = groups
      .map((group) => [group.screen, ...group.variants].map((screen) => itemsFor(screen).filter(showsDevice)).filter((row) => row.length))
      .filter((rows) => rows.length)
      .map((rows) => (rows.flat().some((item) => frameHeight(item) > TALL_FRAME) ? [rows.flat()] : rows));
    const items = columns.flat(2);
    if (!items.length) continue;
    const official = new Set(items.filter((item) => item.kind === "official").map((item) => item.screen.id)).size;
    const proposed = items.filter((item) => item.kind === "proposal").length;
    const frame = document.createElement("div");
    frame.className = "section";
    if (section.id) frame.dataset.section = section.id;
    frame.style.left = "0px";
    frame.style.top = `${y}px`;
    frame.innerHTML = `<div class="section-head"><span class="section-name">${escapeHtml(section.name)}</span><span class="section-meta"><i class="dot live"></i>${official}${
      proposed ? `<i class="dot prop"></i>${proposed}` : ""
    }</span></div>`;
    frame.querySelector(".section-head").title = `${t(official === 1 ? "{n} official screen" : "{n} official screens", { n: official })}${proposed ? ` · ${t("{n} in proposals", { n: proposed })}` : ""}`;
    world.appendChild(frame);
    const annotated = annotatedItems(items);
    const perRow = Math.ceil(columns.length / Math.ceil(columns.length / MAX_PER_ROW));
    let rowTop = y + SECTION_PAD;
    let rowHeight = 0;
    let x = SECTION_PAD;
    let right = 0;
    columns.forEach((rows, index) => {
      if (index && index % perRow === 0) {
        rowTop += rowHeight + ROW_GAP;
        rowHeight = 0;
        x = SECTION_PAD;
      }
      let top = rowTop;
      let columnRight = x;
      rows.forEach((row, depth) => {
        if (depth) top += VARIANT_GAP;
        let left = x;
        let height = 0;
        for (const item of row) {
          const extra = annotated.has(item) ? ANNO_SPACE : 0;
          const placed = frameElement(item, left, top);
          if (extra) placed.element.dataset.annos = "";
          world.appendChild(placed.element);
          state.placed.push({ item, element: placed.element, x: left, y: top + 26, width: FRAME_WIDTH, height: placed.height, reach: FRAME_WIDTH + extra });
          height = Math.max(height, placed.height + 26);
          columnRight = Math.max(columnRight, left + FRAME_WIDTH + extra);
          left += FRAME_WIDTH + extra + FRAME_GAP;
        }
        top += height;
      });
      rowHeight = Math.max(rowHeight, top - rowTop);
      right = Math.max(right, columnRight);
      x = columnRight + FRAME_GAP;
    });
    const bottom = rowTop + rowHeight + SECTION_PAD;
    frame.style.width = `${right + SECTION_PAD}px`;
    frame.style.height = `${bottom - y}px`;
    state.sections.push({ id: section.id, name: section.name, count: items.length, box: { left: 0, top: y, right: right + SECTION_PAD, bottom } });
    y = bottom + SECTION_GAP;
  }
}

function renderFlow() {
  world.querySelectorAll(".frame, .section").forEach((node) => node.remove());
  edges.innerHTML = "";
  state.placed = [];
  const screens = state.data.screens.filter((screen) => screen.versions.length && tabs.visible(screen.section) && showsDevice({ screen, version: screen.official ?? screen.versions.at(-1).v }));
  const flows = state.data.flows.filter((flow) => screenById(flow.from) && screenById(flow.to));
  const depth = new Map();
  const incoming = new Set(flows.map((flow) => flow.to));
  const queue = screens.filter((screen) => !incoming.has(screen.id)).map((screen) => screen.id);
  if (!queue.length && screens.length) queue.push(screens[0].id);
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length) {
    const id = queue.shift();
    for (const flow of flows.filter((item) => item.from === id)) {
      if (!depth.has(flow.to)) {
        depth.set(flow.to, depth.get(id) + 1);
        queue.push(flow.to);
      }
    }
  }
  for (const screen of screens) if (!depth.has(screen.id)) depth.set(screen.id, 0);
  const spread = state.showAnnotations && annotationThreads().length ? ANNO_SPACE : 0;
  const columns = new Map();
  const positions = new Map();
  for (const screen of screens) {
    const column = depth.get(screen.id);
    const row = columns.get(column) ?? 0;
    columns.set(column, row + 1);
    const focused = focusedProposals().map((proposal) => proposal.screens[screen.id]).find(Boolean);
    const version = focused ?? (state.focus === "all" ? screen.versions.at(-1).v : screen.official ?? screen.versions.at(-1).v);
    const item = { screen, version, kind: screen.official === version ? "official" : "proposal", proposal: proposalOfVersion(screen.id, version) ?? { title: t("draft") } };
    const x = column * (FRAME_WIDTH + 160 + spread);
    const y = row * 300;
    const { element, height } = frameElement(item, x, y);
    const extra = annotatedItems([item]).has(item) ? ANNO_SPACE : 0;
    if (extra) element.dataset.annos = "";
    world.appendChild(element);
    positions.set(screen.id, { x, y: y + 26, height });
    state.placed.push({ item, element, x, y: y + 26, width: FRAME_WIDTH, height, reach: FRAME_WIDTH + extra });
  }
  const ns = "http://www.w3.org/2000/svg";
  for (const flow of flows) {
    const from = positions.get(flow.from);
    const to = positions.get(flow.to);
    const x1 = from.x + FRAME_WIDTH;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const bend = Math.max(40, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("class", "link-path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    edges.appendChild(path);
    const label = flow.label ?? flow.el;
    if (label) {
      const text = document.createElementNS(ns, "text");
      text.setAttribute("class", "flow-label");
      text.setAttribute("x", (x1 + x2) / 2);
      text.setAttribute("y", (y1 + y2) / 2 - 8);
      text.setAttribute("text-anchor", "middle");
      text.textContent = label;
      edges.appendChild(text);
    }
  }
}

function render() {
  const { project, screens, proposals, waiting } = state.data;
  $("#project-name").textContent = project.name;
  document.title = `${project.name} · Screenbook`;
  const waitingElement = $("#waiting");
  waitingElement.hidden = !waiting.length;
  waitingElement.textContent = t(waiting.length === 1 ? "{n} mention waiting for a chat" : "{n} mentions waiting for a chat", { n: waiting.length });
  renderAnnotationToggle();
  renderDeviceFilter();
  $("#empty").hidden = screens.length > 0;
  tabs.render();
  const onBoard = isBoard(tabs.current());
  if (onBoard) {
    world.querySelectorAll(".frame, .section").forEach((node) => node.remove());
    edges.innerHTML = "";
    state.placed = [];
    state.sections = [];
    board.enter(tabs.current().id);
    board.render();
  } else {
    board.leave();
    if (state.view === "flow") renderFlow();
    else renderCanvas();
  }
  $("#empty").hidden = onBoard || screens.length > 0;
  $("#page-empty").hidden = onBoard || !screens.length || state.placed.length > 0;
  screensPainted = new Set(screens.map((screen) => screen.id));
  stickies.render();
  renderSidebar();
  if (state.selected) {
    const still = state.placed.find((entry) => entry.item.screen.id === state.selected.screen.id && entry.item.version === state.selected.version);
    if (still) select(still.item, true);
    else deselect();
  }
  renderPins();
  zoom.update();
  if (!state.fitted && state.placed.length) {
    state.fitted = true;
    fit();
  }
  live?.rerender();
}

const PIN_COLORS = { waiting: "var(--agent)", human: "var(--human)" };

function noteThreads() {
  return threadsOf(splitAnnotations(withPending(state.data.notes)).comments).filter((thread) => !thread.root.resolved);
}

function targetOf(root, items) {
  const candidates = items.filter((item) => item.screen.id === root.screen);
  return candidates.find((item) => item.version === root.version) ?? candidates.find((item) => item.kind === "official") ?? candidates[0];
}

function placedFor(root) {
  const item = targetOf(root, state.placed.map((entry) => entry.item));
  return item ? state.placed.find((entry) => entry.item === item) : undefined;
}

function annotationThreads(notes = state.data?.notes ?? []) {
  const { annotations } = splitAnnotations(notes);
  return annotations.filter(isAnnotation).map((root) => ({ root, replies: annotations.filter((entry) => entry.replyTo === root.id) }));
}

function annotatedItems(items) {
  if (!state.showAnnotations) return new Set();
  return new Set(annotationThreads().map((thread) => targetOf(thread.root, items)).filter(Boolean));
}

function renderAnnotationToggle() {
  const button = $("#annotations-toggle");
  const count = annotationThreads().length;
  button.hidden = !count;
  button.setAttribute("aria-pressed", String(state.showAnnotations));
  button.title = state.showAnnotations ? t("Hide the AI notes") : t("Show the AI notes");
  button.querySelector("b").textContent = String(count);
}

function setAnnotationsShown(shown) {
  state.showAnnotations = shown;
  state.annotation = null;
  storageSet("screenbook.annotations", shown ? "shown" : "hidden");
  render();
  if (!state.manual) fit();
}

function annotationAnchor(root, placed) {
  const piece = piecesOfRoot(root)[0] ?? null;
  const key = `${placed.item.screen.id}/v${placed.item.version}`;
  if (piece && !(key in state.boxes)) loadBoxes(placed.item.screen.id, placed.item.version);
  const box = piece && state.boxes[key]?.[piece];
  if (box) return { x: Math.min(1, box.left + box.width) * placed.width, y: Math.min(1, box.top + box.height / 2) * placed.height, piece, found: true };
  return { x: placed.width, y: root.point ? root.point.y * placed.height : 18, piece, found: false };
}

function lightPiece(placed, piece, on) {
  const layer = placed.element.querySelector(".pins");
  layer.querySelectorAll(".piece-hl.anno-hover").forEach((mark) => mark.remove());
  if (on && piece) highlight(layer, placed.item, [piece], "anno anno-hover");
}

function annotationCard(thread, placed, anchor) {
  const { root, replies } = thread;
  const open = state.annotation === root.id;
  const card = document.createElement("div");
  card.className = `anno${open ? " open" : ""}`;
  card.dataset.anno = root.id;
  if (open) {
    card.innerHTML = `<div class="anno-head"><span class="anno-chip">${escapeHtml(root.category || t("AI note"))}</span>${
      anchor.piece ? `<span class="anno-piece">${escapeHtml(prettyPiece(anchor.piece))}</span>` : ""
    }<span class="grow"></span><button type="button" class="anno-close" aria-label="${t("Close note")}">×</button></div>
      <div class="anno-text">${formatAnnotation(root.text)}</div>${
        replies.length
          ? `<div class="anno-replies">${replies.map((reply) => `<div><b>${escapeHtml(reply.author)}</b> ${withMentions(reply.text)}</div>`).join("")}</div>`
          : ""
      }<div class="anno-foot">${escapeHtml(root.author)} · ${timeAgo(root.at)}${root.version ? ` · v${root.version}` : ""}</div>`;
  } else {
    card.innerHTML = `<button type="button" class="anno-pill" aria-expanded="false" title="${escapeHtml(root.text)}"><i class="anno-mark" aria-hidden="true">✦</i><span>${escapeHtml(annotationPreview(root.text))}</span></button>`;
  }
  card.addEventListener("pointerdown", (event) => event.stopPropagation());
  card.addEventListener("dblclick", (event) => event.stopPropagation());
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    if (open && !event.target.closest(".anno-close")) return;
    state.annotation = open ? null : root.id;
    renderAnnotations();
  });
  card.addEventListener("mouseenter", () => {
    lightPiece(placed, anchor.piece, true);
    placed.element.querySelector(`.anno-line[data-anno="${CSS.escape(root.id)}"]`)?.classList.add("hot");
  });
  card.addEventListener("mouseleave", () => {
    lightPiece(placed, anchor.piece, false);
    placed.element.querySelector(`.anno-line[data-anno="${CSS.escape(root.id)}"]`)?.classList.remove("hot");
  });
  return card;
}

function layoutAnnotations(placed, threads) {
  const layer = placed.element.querySelector(".annos");
  const ns = "http://www.w3.org/2000/svg";
  const lines = document.createElementNS(ns, "svg");
  lines.setAttribute("class", "anno-lines");
  layer.appendChild(lines);
  const column = placed.width + ANNO_GAP;
  const rows = threads.map((thread) => ({ thread, anchor: annotationAnchor(thread.root, placed) })).sort((first, second) => first.anchor.y - second.anchor.y);
  let floor = 0;
  for (const { thread, anchor } of rows) {
    const card = annotationCard(thread, placed, anchor);
    card.style.left = `${column}px`;
    layer.appendChild(card);
    const top = Math.max(floor, anchor.y - 13);
    card.style.top = `${top}px`;
    floor = top + card.offsetHeight + 8;
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", "anno-line");
    group.dataset.anno = thread.root.id;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", `M ${anchor.x} ${anchor.y} L ${column} ${top + 13}`);
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", anchor.x);
    dot.setAttribute("cy", anchor.y);
    dot.setAttribute("r", 3);
    group.append(path, dot);
    lines.appendChild(group);
    if (state.annotation === thread.root.id) {
      placed.element.classList.add("anno-open");
      group.classList.add("hot");
      if (anchor.piece) highlight(placed.element.querySelector(".pins"), placed.item, [anchor.piece], "anno");
    }
  }
}

function renderAnnotations() {
  world.querySelectorAll(".annos").forEach((layer) => (layer.innerHTML = ""));
  world.querySelectorAll(".pins .piece-hl.anno").forEach((mark) => mark.remove());
  world.querySelectorAll(".frame.anno-open").forEach((frame) => frame.classList.remove("anno-open"));
  if (!state.data || !state.showAnnotations) return;
  const groups = new Map();
  for (const thread of annotationThreads()) {
    const placed = placedFor(thread.root);
    if (!placed) continue;
    if (!groups.has(placed)) groups.set(placed, []);
    groups.get(placed).push(thread);
  }
  if (state.annotation && ![...groups.values()].flat().some((thread) => thread.root.id === state.annotation)) state.annotation = null;
  for (const [placed, threads] of groups) layoutAnnotations(placed, threads);
}

function prettyPiece(name) {
  const text = String(name).replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function piecesOfRoot(root) {
  return root.els ?? (root.el ? [root.el] : []);
}

function pointFor(root, version) {
  const boxes = state.boxes[`${root.screen}/v${version}`];
  const first = piecesOfRoot(root)[0];
  if (first && !boxes) {
    loadBoxes(root.screen, version);
    return root.point ?? null;
  }
  const box = first && boxes?.[first];
  if (box) return { x: Math.min(0.97, box.left + box.width), y: Math.min(0.97, box.top) };
  return root.point ?? { x: 1, y: 0 };
}

function pieceAt(item, point) {
  const boxes = state.boxes[`${item.screen.id}/v${item.version}`];
  if (!boxes) return null;
  let best = null;
  for (const [name, box] of Object.entries(boxes)) {
    const inside = point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height;
    if (inside && (!best || box.width * box.height < best.area)) best = { name, area: box.width * box.height };
  }
  return best?.name ?? null;
}

function highlight(layer, item, names, kind) {
  const boxes = state.boxes[`${item.screen.id}/v${item.version}`];
  if (!boxes) return;
  names.forEach((name, index) => {
    const box = boxes[name];
    if (!box) return;
    const mark = document.createElement("div");
    mark.className = `piece-hl ${kind}`;
    mark.style.left = `${box.left * 100}%`;
    mark.style.top = `${box.top * 100}%`;
    mark.style.width = `${box.width * 100}%`;
    mark.style.height = `${box.height * 100}%`;
    mark.innerHTML = `<span>${names.length > 1 ? `${index + 1} · ` : ""}${escapeHtml(prettyPiece(name))}</span>`;
    layer.appendChild(mark);
  });
}

function pointIn(box, event) {
  const rect = box.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}

function hoverPiece(item, box, event) {
  const layer = box.parentElement.querySelector(".pins");
  layer.querySelectorAll(".piece-hl.hover").forEach((mark) => mark.remove());
  if (state.tool !== "comment" || !event) return;
  const key = `${item.screen.id}/v${item.version}`;
  if (!(key in state.boxes)) return loadBoxes(item.screen.id, item.version);
  const name = pieceAt(item, pointIn(box, event));
  const draft = state.note?.draft;
  const taken = draft && draft.item.screen.id === item.screen.id && draft.item.version === item.version ? draft.els : [];
  if (name && !taken.includes(name)) highlight(layer, item, [name], "hover");
}

async function loadBoxes(screen, version) {
  const key = `${screen}/v${version}`;
  if (key in state.boxes) return;
  state.boxes[key] = undefined;
  const answer = await askProbe(screen, version, { type: "boxes" });
  state.boxes[key] = answer?.boxes ?? {};
  renderPins();
}

function renderPins() {
  world.querySelectorAll(".pins").forEach((layer) => (layer.innerHTML = ""));
  if (!state.data) return;
  for (const thread of noteThreads()) {
    const placed = placedFor(thread.root);
    if (!placed) continue;
    const point = pointFor(thread.root, placed.item.version);
    if (!point) continue;
    const pin = document.createElement("button");
    pin.className = `pin${state.note?.root === thread.root.id ? " open" : ""}`;
    pin.dataset.root = thread.root.id;
    pin.style.left = `${point.x * 100}%`;
    pin.style.top = `${point.y * 100}%`;
    pin.style.setProperty("--c", thread.waiting ? PIN_COLORS.waiting : PIN_COLORS.human);
    pin.title = `${thread.root.author}: ${thread.root.text}`;
    pin.setAttribute("aria-label", t("Comment by {author}", { author: thread.root.author }));
    pin.innerHTML = `<span>${escapeHtml(initials(thread.root.author))}</span>${thread.messages.length > 1 ? `<em>${thread.messages.length}</em>` : ""}`;
    pin.addEventListener("pointerdown", (event) => event.stopPropagation());
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      openThread(thread.root.id);
    });
    placed.element.querySelector(".pins").appendChild(pin);
  }
  const openRoot = state.note?.root && noteThreads().find((thread) => thread.root.id === state.note.root)?.root;
  if (openRoot) {
    const placed = placedFor(openRoot);
    if (placed) highlight(placed.element.querySelector(".pins"), placed.item, piecesOfRoot(openRoot), "picked");
  }
  const draft = state.note?.draft;
  if (draft) {
    const placed = state.placed.find((entry) => entry.item.screen.id === draft.item.screen.id && entry.item.version === draft.item.version);
    if (placed) highlight(placed.element.querySelector(".pins"), placed.item, draft.els, "picked");
    if (placed) {
      const pin = document.createElement("span");
      pin.className = "pin draft";
      pin.style.left = `${draft.point.x * 100}%`;
      pin.style.top = `${draft.point.y * 100}%`;
      pin.style.setProperty("--c", "var(--prop)");
      pin.innerHTML = `<span>${escapeHtml(initials(myName() || "?"))}</span>`;
      placed.element.querySelector(".pins").appendChild(pin);
    }
  }
  renderAnnotations();
  placeNote();
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll("#tools [data-tool]").forEach((button) => button.classList.toggle("on", button.dataset.tool === tool));
  viewport.classList.toggle("commenting", tool === "comment");
  viewport.classList.toggle("editing", tool === "edit");
  viewport.classList.toggle("noting", tool === "sticky");
  if (tool === "comment") deselect();
}

function startDraft(item, box, event) {
  const point = pointIn(box, event);
  const piece = pieceAt(item, point);
  const current = state.note?.draft;
  const sameFrame = current && current.item.screen.id === item.screen.id && current.item.version === item.version;
  if (event.shiftKey && sameFrame && piece) {
    const text = $("#note-text")?.value ?? "";
    current.els = current.els.includes(piece) ? current.els.filter((name) => name !== piece) : [...current.els, piece];
    renderPins();
    renderNote(text);
    return;
  }
  state.note = { draft: { item, point, els: piece ? [piece] : [] } };
  renderPins();
  renderNote();
  loadBoxes(item.screen.id, item.version);
}

function openThread(rootId) {
  state.note = { root: rootId };
  renderPins();
  renderNote();
}

function closeNote() {
  if (!state.note) return;
  state.note = null;
  $("#note").hidden = true;
  renderPins();
}

function noteAnchor() {
  if (!state.note) return null;
  if (state.note.root) return world.querySelector(`.pin[data-root="${CSS.escape(state.note.root)}"]`);
  return world.querySelector(".pin.draft");
}

function placeNote() {
  const note = $("#note");
  if (!state.note || note.hidden) return;
  const anchor = noteAnchor();
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = note.offsetWidth;
  const height = note.offsetHeight;
  let left = rect.right + 10;
  if (left + width > window.innerWidth - 12) left = rect.left - width - 10;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(rect.top - 8, window.innerHeight - height - 12));
  note.style.left = `${left}px`;
  note.style.top = `${top}px`;
}

function renderNote(keepText = "") {
  const note = $("#note");
  if (!state.note) {
    note.hidden = true;
    return;
  }
  if (state.note.draft) {
    const { els } = state.note.draft;
    const chips = els.length
      ? els.map((name, index) => `<span class="tag prop">${els.length > 1 ? `${index + 1} · ` : ""}${escapeHtml(prettyPiece(name))}</span>`).join("")
      : `<span class="tag plain">${t("point on screen")}</span>`;
    note.innerHTML = `<div class="note-about"><span class="muted">${t("On")}</span>${chips}<span class="grow"></span><span class="muted note-tip">${t("⇧ click adds another")}</span></div>
      ${
        shared
          ? ""
          : `<div class="note-actions"><button type="button" class="btn sm" data-action="ask">${t("✦ Ask @{handle}", { handle: HANDLE })}</button>${
              els.length ? `<button type="button" class="btn sm" data-action="edit">${t("✎ Edit")}</button>` : ""
            }</div>`
      }
      <form class="note-form" id="note-form">
      <textarea id="note-text" rows="3" placeholder="${shared ? t("Write a comment") : t("Write a comment, and tag @{handle} to ask the chat", { handle: HANDLE })}" required></textarea>
      <div class="row"><span class="muted grow">${t("Enter sends · Esc cancels")}</span><button class="btn primary sm">${t("Comment")}</button></div>
    </form>`;
  } else {
    const thread = noteThreads().find((entry) => entry.root.id === state.note.root);
    if (!thread) return closeNote();
    note.innerHTML = `<div class="note-head"><b>${screenById(thread.root.screen)?.number ?? ""} · ${escapeHtml(screenById(thread.root.screen)?.name ?? thread.root.screen)}</b>${shared ? "" : `<button class="icon-btn" data-action="edit-thread" title="${t("Edit these pieces")}" aria-label="${t("Edit these pieces")}">✎</button>`}${
      shared || thread.root.pending ? "" : `<button class="icon-btn" data-action="resolve" title="${t("Resolve thread")}" aria-label="${t("Resolve thread")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>`
    }<button class="icon-btn" data-action="expand" title="${t("Open screen at full size")}" aria-label="${t("Open screen at full size")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button><button class="icon-btn" data-action="close" aria-label="${t("Close")}">✕</button></div>
      <div class="note-msgs">${thread.messages
        .map(
          (message) => `<div class="msg${message.pending ? " pending" : ""}"><span class="avatar ${message.kind === "agent" ? "agent" : ""}">${escapeHtml(initials(message.author))}</span><div class="bd"><div class="nm">${escapeHtml(message.author)}${
            authorTag(message)
          }<span class="t">${messageTime(message)}</span></div>${withMentions(message.text)}</div></div>`,
        )
        .join("")}${thread.waiting ? `<div class="waiting-line"><i class="dot" style="background:var(--agent)"></i>${t("waiting for a chat to reply")}</div>` : ""}</div>
      <form class="note-form" id="note-form"><textarea id="note-text" rows="1" placeholder="${t("Reply")}" required></textarea><div class="row end"><button class="btn primary sm">${t("Reply")}</button></div></form>`;
    note.querySelector('[data-action="close"]').addEventListener("click", closeNote);
    note.querySelector('[data-action="resolve"]')?.addEventListener("click", () => resolveThread(thread.root.id));
    note.querySelector('[data-action="edit-thread"]')?.addEventListener("click", () => {
      const placed = placedFor(thread.root);
      closeNote();
      openEditor(thread.root.screen, placed?.item.version ?? thread.root.version, piecesOfRoot(thread.root));
    });
    note.querySelector('[data-action="expand"]').addEventListener("click", () => {
      const placed = placedFor(thread.root);
      closeNote();
      openOverlay(thread.root.screen, placed?.item.version ?? thread.root.version);
    });
  }
  note.hidden = false;
  const text = $("#note-text");
  if (keepText) text.value = keepText;
  note.querySelector('[data-action="ask"]')?.addEventListener("click", () => {
    if (!new RegExp(`@${HANDLE}\\b`, "i").test(text.value)) text.value = `@${HANDLE} ${text.value}`.trimEnd() + " ";
    text.focus();
  });
  note.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
    const { item, els } = state.note.draft;
    closeNote();
    openEditor(item.screen.id, item.version, els);
  });
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("#note-form").requestSubmit();
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      closeNote();
    }
  });
  $("#note-form").addEventListener("submit", submitNote);
  placeNote();
  text.focus();
}

async function submitNote(event) {
  event.preventDefault();
  const text = $("#note-text").value.trim();
  if (!text || !state.note) return;
  if (state.note.draft) {
    const { item, point, els } = state.note.draft;
    const el = els.length ? els[0] : askProbe(item.screen.id, item.version, { type: "probe", ...point }, 800).then((probed) => probed?.el ?? null);
    const sent = await sendComment({ screen: item.screen.id, el, els: els.length ? els : null, point, version: item.version, text });
    if (!sent) return;
    state.note = { root: sent.id };
    if (/@[a-z]/i.test(text)) toast(t("Sent to @{handle}. It reaches whichever chat is listening.", { handle: HANDLE }));
  } else {
    const root = noteThreads().find((entry) => entry.root.id === state.note.root)?.root;
    if (!root) return;
    const sent = await sendComment({ screen: root.screen, el: root.el, els: root.els, point: root.point, version: root.version, text, replyTo: root.id });
    if (!sent) return;
  }
  renderPins();
  renderNote();
}

const probes = new Map();

function probeFrame(screen, version) {
  const key = `${screen}/v${version}`;
  if (probes.has(key)) return probes.get(key);
  const entry = versionEntry(screenById(screen), version);
  const frame = document.createElement("iframe");
  frame.className = "probe";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.width = `${entry?.width ?? 1280}px`;
  frame.style.height = `${entry?.height ?? 800}px`;
  const probe = { frame, waiters: new Map() };
  probe.ready = new Promise((resolve) => (probe.markReady = resolve));
  frame.src = frameUrl(screen, version);
  document.body.appendChild(frame);
  probes.set(key, probe);
  return probe;
}

function askProbe(screen, version, message, timeout = 2500) {
  const probe = probeFrame(screen, version);
  const asked = probe.ready.then(
    () =>
      new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        probe.waiters.set(id, resolve);
        probe.frame.contentWindow?.postMessage({ ...message, id }, "*");
      }),
  );
  return Promise.race([asked, new Promise((resolve) => setTimeout(() => resolve(null), timeout))]);
}

window.addEventListener("message", (event) => {
  for (const probe of probes.values()) {
    if (probe.frame.contentWindow !== event.source) continue;
    const data = event.data ?? {};
    if (data.type === "ready") probe.markReady();
    if (data.id && probe.waiters.has(data.id)) {
      probe.waiters.get(data.id)(data);
      probe.waiters.delete(data.id);
    }
  }
});

function openFrameMenu(item, event) {
  closeNote();
  const menu = $("#frame-menu");
  const base = compareBase(item.screen, item.version);
  const entries = [
    ["open", t("Open at full size")],
    ["play", t("Present from here")],
    ["comment", t("Comment on this screen")],
    ...(shared || frozen(item)
      ? []
      : [
          ["edit", t("Edit pieces")],
          null,
          ["duplicate", item.kind === "proposal" ? t("Duplicate in this proposal") : t("Duplicate in a new proposal")],
          ...(item.kind === "proposal" ? [["duplicate-fresh", t("Duplicate in a new proposal")]] : []),
        ]),
    ...(base ? [["compare", compareLabel(base)]] : []),
    ["inspect", t("Inspect")],
    ["history", t("Version history")],
    null,
    ["link", t("Copy screen link")],
  ];
  menu.innerHTML = `<div class="fm-title"><span class="num ${item.kind === "official" ? "live" : "prop"}">${item.screen.number}</span>${escapeHtml(item.screen.name)} · v${item.version}</div>${entries
    .map((entry) => (entry ? `<button class="fm-item" data-menu="${entry[0]}">${entry[1]}</button>` : '<div class="fm-sep"></div>'))
    .join("")}`;
  menu.hidden = false;
  const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 12);
  const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 12);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const actions = {
    open: () => openOverlay(item.screen.id, item.version),
    play: () => startPresenting(item.screen.id, item.version),
    inspect: () => openOverlayOn(item, "inspect"),
    history: () => openOverlayOn(item, "history"),
    comment: () => setTool("comment"),
    edit: () => openEditor(item.screen.id, item.version, []),
    duplicate: () => duplicateScreen(item, false),
    "duplicate-fresh": () => duplicateScreen(item, true),
    compare: () => openCompare(item),
    link: async () => {
      const url = `${location.origin}${location.pathname}${location.search}#${item.screen.id}/v${item.version}`;
      try {
        await navigator.clipboard.writeText(url);
        toast(t("Link to screen {number} copied.", { number: item.screen.number }));
      } catch {
        prompt(t("Screen link"), url);
      }
    },
  };
  menu.querySelectorAll("[data-menu]").forEach((button) =>
    button.addEventListener("click", () => {
      closeFrameMenu();
      actions[button.dataset.menu]();
    }),
  );
}

async function openOverlayOn(item, panel) {
  await openOverlay(item.screen.id, item.version);
  if (state.overlay) setPanel(panel);
}

function closeFrameMenu() {
  $("#frame-menu").hidden = true;
}

async function duplicateScreen(item, fresh) {
  const name = await ensureName();
  if (!name) return;
  const made = await post(`${BASE}/api/screens/${item.screen.id}/duplicate`, { version: item.version, fresh, by: name });
  await refresh(true);
  focusOn(made.proposal);
  const copy = state.placed.find((entry) => entry.item.screen.id === made.screen && entry.item.version === made.version);
  if (copy) select(copy.item, true);
  toast(t("Screen {number} created, a copy of screen {source}. Change it with the pencil.", { number: screenById(made.screen)?.number ?? "", source: item.screen.number }));
}

const colorProbe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

function toHex(color) {
  colorProbe.clearRect(0, 0, 1, 1);
  colorProbe.fillStyle = "#ffffff";
  colorProbe.fillRect(0, 0, 1, 1);
  colorProbe.fillStyle = String(color);
  colorProbe.fillRect(0, 0, 1, 1);
  const [red, green, blue] = colorProbe.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function editedHtml(source, changes) {
  const applyTo = (root) => {
    for (const [name, change] of Object.entries(changes)) {
      const node = root.querySelector(`[data-el="${CSS.escape(name)}"]`);
      if (!node) continue;
      if (change.text !== undefined) node.textContent = change.text;
      for (const [prop, value] of Object.entries(change.style ?? {})) node.style.setProperty(prop, value);
    }
  };
  if (/<html[\s>]/i.test(source)) {
    const doc = new DOMParser().parseFromString(source, "text/html");
    applyTo(doc);
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  }
  const template = document.createElement("template");
  template.innerHTML = source;
  applyTo(template.content);
  return template.innerHTML;
}

function editorTarget(screen, version) {
  const entry = versionEntry(screen, version);
  const proposal = state.data.proposals.find((record) => record.id === entry?.proposal);
  if (screen.official !== version && proposal?.status === "open") return t('Saving makes it v{version} of the proposal "{title}".', { version: screen.versions.at(-1).v + 1, title: proposal.title });
  return t('Saving makes a new proposal, "Tweak to screen {number}". The official one stays the same.', { number: screen.number });
}

async function openEditor(screenId, version, els) {
  const screen = screenById(screenId);
  const entry = versionEntry(screen, version);
  if (!entry) return;
  if (closedVersion(screen, version, state.data.proposals)) {
    toast(t("This version belongs to a closed proposal and is read-only. Edit the official version."));
    return;
  }
  deselect();
  setTool("move");
  const source = await fetch(`${BASE}/api/screens/${screenId}/v${version}.source`).then((response) => response.text());
  state.editor = { screenId, version, source, changes: {}, picked: [], info: null, palette: [], preselect: els ?? [] };
  $("#editor").hidden = false;
  $("#ed-name").textContent = `${screen.number} · ${screen.name} · v${version}`;
  $("#ed-meta").textContent = editorTarget(screen, version);
  const stage = $("#ed-stage");
  const available = stage.clientWidth - 56;
  const scale = Math.min(1, available / entry.width);
  stage.innerHTML = `<div class="ov-frame editing" style="width:${Math.round(entry.width * scale)}px;height:${Math.round(entry.height * scale)}px"><iframe src="${frameUrl(screenId, version)}" style="position:absolute;left:0;top:0;width:${entry.width}px;height:${entry.height}px;transform:scale(${scale});transform-origin:0 0"></iframe></div>`;
  updateEditorCount();
  renderEditorSide();
}

function editorFrame() {
  return $("#ed-stage iframe")?.contentWindow;
}

function updateEditorCount() {
  const count = Object.keys(state.editor?.changes ?? {}).length;
  $("#ed-count").textContent = count ? t(count === 1 ? "{n} piece changed" : "{n} pieces changed", { n: count }) : "";
  $("#ed-save").disabled = !count;
}

function applyEdit(prop, value) {
  const editor = state.editor;
  if (!editor?.picked.length) return;
  for (const name of editor.picked) {
    const change = (editor.changes[name] ??= { style: {} });
    if (prop === "text") change.text = value;
    else change.style[prop] = value;
  }
  editorFrame()?.postMessage({ type: "edit-apply", els: editor.picked, prop, value }, "*");
  updateEditorCount();
}

function renderEditorSide() {
  const editor = state.editor;
  const side = $("#ed-side");
  if (!editor) return;
  if (!editor.picked.length || !editor.info) {
    side.innerHTML = `<div class="head"><b>${t("Edit")}</b></div><p class="hint">${t("Click a piece of the screen to change its text, colors, size and corners. Shift + click adds another piece and changes both together.")}</p><p class="hint">${t("Nothing changes in the official version: saving creates a new version in a proposal, which someone approves later.")}</p>`;
    return;
  }
  const info = editor.info;
  const swatches = (kind) =>
    editor.palette.map((color) => `<button class="swatch" style="background:${escapeHtml(color)}" data-swatch="${kind}" data-color="${escapeHtml(toHex(color))}" title="${escapeHtml(toHex(color))}"></button>`).join("");
  const single = editor.picked.length === 1;
  side.innerHTML = `
    <div class="head"><b>${single ? escapeHtml(prettyPiece(editor.picked[0])) : t("{n} pieces", { n: editor.picked.length })}</b>${single ? "" : `<span class="tag plain">${t("change together")}</span>`}</div>
    <div class="ed-props">
      ${single && info.text !== null ? `<label class="ed-group"><span class="ed-label">${t("Text")}</span><textarea id="ed-text" rows="2">${escapeHtml(info.text)}</textarea></label>` : ""}
      <div class="ed-group"><span class="ed-label">${t("Colors")}</span>
        <label class="ed-row"><input type="color" id="ed-bg" value="${toHex(info.background)}"><span class="mono">${toHex(info.background)}</span><span class="muted grow">${t("Background")}</span></label>
        <div class="ed-swatches">${swatches("background-color")}</div>
        <label class="ed-row"><input type="color" id="ed-color" value="${toHex(info.color)}"><span class="mono">${toHex(info.color)}</span><span class="muted grow">${t("Text")}</span></label>
        <div class="ed-swatches">${swatches("color")}</div>
        <p class="ed-note">${t("Suggested colors are the ones the screen already uses.")}</p>
      </div>
      <div class="ed-group"><span class="ed-label">${t("Size and spacing")}</span>
        <div class="ed-grid">
          <label class="ed-field">${t("Font")}<input type="number" id="ed-size" min="6" max="120" value="${Math.round(info.fontSize)}"></label>
          <label class="ed-field">${t("Weight")}<select id="ed-weight">${["400", "500", "600", "700"].map((weight) => `<option ${String(info.fontWeight) === weight ? "selected" : ""}>${weight}</option>`).join("")}</select></label>
          <label class="ed-field">${t("Spacing")}<input type="number" id="ed-padding" min="0" max="200" value="${Math.round(info.padding)}"></label>
          <label class="ed-field">${t("Corners")}<input type="number" id="ed-radius" min="0" max="999" value="${Math.round(info.radius)}"></label>
        </div>
        <label class="ed-row"><input type="checkbox" id="ed-hidden" ${info.hidden ? "checked" : ""}><span>${t("Hide")}</span></label>
      </div>
    </div>
    <form class="composer" id="ed-ask"><span class="ed-label">${t("Change too big to make here?")}</span><textarea id="ed-ask-text" placeholder="${t("Describe it and @{handle} redraws it. E.g.: swap it for a progress bar", { handle: HANDLE })}" required></textarea><div class="row end"><button class="btn primary sm">${t("Ask @{handle}", { handle: HANDLE })}</button></div></form>`;
  $("#ed-text")?.addEventListener("input", (event) => applyEdit("text", event.target.value));
  $("#ed-bg").addEventListener("input", (event) => applyEdit("background-color", event.target.value));
  $("#ed-color").addEventListener("input", (event) => applyEdit("color", event.target.value));
  $("#ed-size").addEventListener("input", (event) => applyEdit("font-size", `${event.target.value}px`));
  $("#ed-weight").addEventListener("change", (event) => applyEdit("font-weight", event.target.value));
  $("#ed-padding").addEventListener("input", (event) => applyEdit("padding", `${event.target.value}px`));
  $("#ed-radius").addEventListener("input", (event) => applyEdit("border-radius", `${event.target.value}px`));
  $("#ed-hidden").addEventListener("change", (event) => applyEdit("display", event.target.checked ? "none" : ""));
  side.querySelectorAll("[data-swatch]").forEach((button) =>
    button.addEventListener("click", () => {
      applyEdit(button.dataset.swatch, button.dataset.color);
      const input = button.dataset.swatch === "color" ? $("#ed-color") : $("#ed-bg");
      input.value = button.dataset.color;
      input.nextElementSibling.textContent = button.dataset.color;
    }),
  );
  $("#ed-ask").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("#ed-ask-text").value.trim();
    if (!text) return;
    const sent = await sendComment({ screen: editor.screenId, el: editor.picked[0], els: editor.picked, version: editor.version, text: `@${HANDLE} ${text}` });
    if (!sent) return;
    $("#ed-ask-text").value = "";
    toast(t("Sent to @{handle}. It reaches whichever chat is listening.", { handle: HANDLE }));
  });
}

function closeEditor(force = false) {
  if (!state.editor) return;
  if (!force && Object.keys(state.editor.changes).length && !confirm(t("Discard your changes?"))) return;
  state.editor = null;
  $("#editor").hidden = true;
  $("#ed-stage").innerHTML = "";
}

async function saveEditor() {
  const editor = state.editor;
  if (!editor || !Object.keys(editor.changes).length) return;
  const name = await ensureName();
  if (!name) return;
  $("#ed-save").disabled = true;
  try {
    const saved = await post(`${BASE}/api/screens/${editor.screenId}/edit`, { version: editor.version, html: editedHtml(editor.source, editor.changes), by: name });
    closeEditor(true);
    await refresh(true);
    focusOn(saved.proposal);
    const placed = state.placed.find((entry) => entry.item.screen.id === saved.screen && entry.item.version === saved.version);
    if (placed) select(placed.item, true);
    const proposal = state.data.proposals.find((record) => record.id === saved.proposal);
    toast(t('Screen {number}, v{version}, saved in "{title}". Still needs approval.', { number: screenById(saved.screen)?.number ?? "", version: saved.version, title: proposal?.title ?? saved.proposal }));
  } finally {
    updateEditorCount();
  }
}

window.addEventListener("message", (event) => {
  const editor = state.editor;
  if (!editor || event.source !== editorFrame()) return;
  const data = event.data ?? {};
  if (data.type === "ready") {
    editorFrame().postMessage({ type: "mode", edit: true }, "*");
    if (editor.preselect.length) editorFrame().postMessage({ type: "edit-select", els: editor.preselect }, "*");
  }
  if (data.type === "edit-ready") {
    editor.palette = Array.isArray(data.palette) ? data.palette.filter((color) => typeof color === "string").slice(0, 12) : [];
    renderEditorSide();
  }
  if (data.type === "edit-pick") {
    editor.picked = Array.isArray(data.els) ? data.els.filter((name) => typeof name === "string") : [];
    editor.info = data.info ?? null;
    renderEditorSide();
  }
  if (data.type === "edit-info") editor.info = data.info ?? editor.info;
});

function renderSidebar() {
  layers.render();
  const focused = proposalById(state.focus);
  const proposals = isClosed(focused) && focused.status !== "archived" ? [...openProposals(), focused] : openProposals();
  const all = $("#all-proposals");
  all.hidden = proposals.length < 2;
  all.textContent = state.focus === "all" ? t("hide") : t("see all");
  const proposalList = $("#proposal-list");
  proposalList.innerHTML = proposals.length
    ? proposals
        .map((proposal) => {
          const screens = liveScreens(proposal).length;
          const pending = pendingScreens(proposal).length;
          const on = state.focus === "all" || state.focus === proposal.id;
          const count = isClosed(proposal)
            ? t("{label} · read-only", { label: closedLabel(proposal) })
            : pending === screens ? t(screens === 1 ? "{n} screen" : "{n} screens", { n: screens }) : t("{approved} of {total} approved", { approved: screens - pending, total: screens });
          const item = `<button class="sb-item proposal${on ? " on" : ""}" data-proposal="${escapeHtml(proposal.id)}" aria-pressed="${on}"><i class="dot prop"></i><span class="sb-text"><span class="sb-name">${escapeHtml(proposal.title)}</span><span class="sb-meta">${count} · ${timeAgo(proposal.createdAt)}</span></span></button>`;
          if (shared || isClosed(proposal) || state.focus !== proposal.id) return item;
          const approveAll = pending > 1 ? `<button class="btn sm approve" data-approve-all="${escapeHtml(proposal.id)}">${t("Approve all {n} screens", { n: pending })}</button>` : "";
          const links = state.data.shares
            .filter((entry) => entry.proposal === proposal.id)
            .map(
              (entry) =>
                `<div class="sb-share"><span>${t("Public link until {date}", { date: new Date(entry.expiresAt).toLocaleDateString(lang, { day: "2-digit", month: "2-digit" }) })}</span><button class="sb-link" data-copy-share="${escapeHtml(entry.token)}">${t("copy")}</button><button class="sb-link" data-revoke-share="${escapeHtml(entry.token)}">${t("revoke")}</button></div>`,
            )
            .join("");
          return `${item}<div class="sb-actions">${approveAll}<button class="btn sm" data-share="${escapeHtml(proposal.id)}">${t("Share public link")}</button>${links}<button class="btn sm" data-archive="${escapeHtml(proposal.id)}">${t("Archive proposal")}</button></div>`;
        })
        .join("")
    : `<p class="sb-empty">${t("Nothing waiting for approval.")}</p>`;
  renderReaderPill();
  proposalList.querySelectorAll("[data-share]").forEach((button) => button.addEventListener("click", () => shareProposal(button.dataset.share)));
  proposalList.querySelectorAll("[data-copy-share]").forEach((button) => button.addEventListener("click", () => copyShare(button.dataset.copyShare)));
  proposalList.querySelectorAll("[data-revoke-share]").forEach((button) => button.addEventListener("click", () => revokeShare(button.dataset.revokeShare)));
  proposalList.querySelectorAll("[data-archive]").forEach((button) => button.addEventListener("click", () => archiveProposal(button.dataset.archive)));
  proposalList.querySelectorAll("[data-approve-all]").forEach((button) => {
    button.addEventListener("click", () => approveAll(openProposals().find((proposal) => proposal.id === button.dataset.approveAll)));
  });
  proposalList.querySelectorAll("[data-proposal]").forEach((button) => {
    button.addEventListener("click", () => {
      collapseOnPhone();
      const id = button.dataset.proposal;
      if (phone()) {
        focusOn(id);
        return openProposalReader(id);
      }
      focusOn(state.focus === id ? null : id);
    });
  });
  renderArchived();
}

function archivedProposals() {
  return state.data.proposals
    .filter((proposal) => proposal.status === "archived")
    .sort((first, second) => String(second.archived?.at ?? "").localeCompare(String(first.archived?.at ?? "")));
}

function archivedMeta(stamp) {
  if (!stamp?.at) return t("archived");
  return stamp.by ? t("archived {time} by {name}", { time: timeAgo(stamp.at), name: stamp.by }) : t("archived {time}", { time: timeAgo(stamp.at) });
}

function archivedReason(stamp) {
  return stamp?.reason ? `<span class="sb-reason">${escapeHtml(stamp.reason)}</span>` : "";
}

function renderArchived() {
  const group = $("#archived-group");
  const proposals = shared ? [] : archivedProposals();
  const screens = shared ? [] : state.data.archived ?? [];
  const count = proposals.length + screens.length;
  group.hidden = !count;
  if (!count) return;
  if (proposalById(state.focus)?.status === "archived") state.archivedOpen = true;
  const open = Boolean(state.archivedOpen);
  $("#archived-title").textContent = t("Archived ({n})", { n: count });
  $("#archived-toggle").setAttribute("aria-expanded", String(open));
  const list = $("#archived-list");
  list.hidden = !open;
  if (!open) return;
  const proposalItems = proposals.map((proposal) => {
    const on = state.focus === proposal.id;
    return `<button class="sb-item proposal${on ? " on" : ""}" data-archived-proposal="${escapeHtml(proposal.id)}" aria-pressed="${on}"><i class="dot archived"></i><span class="sb-text"><span class="sb-name">${escapeHtml(proposal.title)}</span><span class="sb-meta">${escapeHtml(archivedMeta(proposal.archived))}</span>${archivedReason(proposal.archived)}</span></button><div class="sb-row-actions"><button class="sb-link" data-restore-proposal="${escapeHtml(proposal.id)}">${t("Restore")}</button></div>`;
  });
  const screenItems = screens.map((screen) => {
    const link = screen.version ? `<a class="sb-link" href="${BASE}/api/screens/${encodeURIComponent(screen.id)}/v${Number(screen.version)}.html" target="_blank" rel="noopener">${t("Open screen")}</a>` : "";
    return `<div class="sb-item"><i class="dot archived"></i><span class="sb-text"><span class="sb-name">${t("Screen {number} · {name}", { number: escapeHtml(String(screen.number ?? "")), name: escapeHtml(screen.name) })}</span><span class="sb-meta">${escapeHtml(archivedMeta(screen))}</span>${archivedReason(screen)}</span></div><div class="sb-row-actions">${link}<button class="sb-link" data-restore-screen="${escapeHtml(screen.id)}">${t("Restore")}</button></div>`;
  });
  list.innerHTML = proposalItems.join("") + screenItems.join("");
  list.querySelectorAll("[data-archived-proposal]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.archivedProposal;
      if (!readerItemsOfProposal(proposalById(id)).length) return toast(t("This proposal has no screens here."));
      collapseOnPhone();
      if (phone()) {
        focusOn(id);
        return openProposalReader(id);
      }
      if (state.focus === id) return focusOn(null);
      focusOn(id);
      toast(t("Archived: this proposal opens read-only, with the versions it pinned."));
    });
  });
  list.querySelectorAll("[data-restore-proposal]").forEach((button) => button.addEventListener("click", () => restoreProposal(button.dataset.restoreProposal)));
  list.querySelectorAll("[data-restore-screen]").forEach((button) => button.addEventListener("click", () => restoreScreen(button.dataset.restoreScreen)));
}

function confirmArchive(proposal) {
  const dialog = $("#archive-dialog");
  const reason = $("#archive-reason");
  $("#archive-title").textContent = t('Archive "{title}"?', { title: proposal.title });
  reason.value = "";
  dialog.returnValue = "";
  dialog.showModal();
  reason.focus();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "archive" ? { reason: reason.value.trim() } : null), { once: true }));
}

async function archiveProposal(id) {
  const proposal = proposalById(id);
  if (!proposal) return;
  const name = await ensureName();
  if (!name) return;
  const answer = await confirmArchive(proposal);
  if (!answer) return;
  try {
    await post(`${BASE}/api/proposals/${id}/archive`, { by: name, reason: answer.reason });
  } catch (error) {
    return toast(error.message);
  }
  if (state.focus === id) state.focus = null;
  await refresh(true);
  fit();
  toast(t('"{title}" moved to Archived.', { title: proposal.title }), { label: t("Undo"), run: () => restoreProposal(id) });
}

async function restoreProposal(id) {
  const name = await ensureName();
  if (!name) return;
  try {
    await post(`${BASE}/api/proposals/${id}/restore`, { by: name });
  } catch (error) {
    return toast(error.message);
  }
  await refresh(true);
  toast(t('"{title}" is back in open proposals.', { title: proposalById(id)?.title ?? id }));
}

async function restoreScreen(id) {
  const name = await ensureName();
  if (!name) return;
  try {
    await post(`${BASE}/api/screens/${id}/restore`, { by: name });
  } catch (error) {
    return toast(error.message);
  }
  await refresh(true);
  toast(t("Screen {number} is back on the canvas.", { number: screenById(id)?.number ?? "" }));
}

function renderReaderPill() {
  const pill = $("#reader-pill");
  const proposal = state.focus && state.focus !== "all" ? proposalById(state.focus) : null;
  const count = readerItemsOfProposal(proposal).length;
  pill.hidden = !count;
  if (count) pill.textContent = count === 1 ? t("See the proposal's screen") : t("See the proposal's {n} screens", { n: count });
}

function shareUrl(token) {
  return `${location.origin}${BASE}/s/${token}/`;
}

async function copyShare(token) {
  try {
    await navigator.clipboard.writeText(shareUrl(token));
    toast(t("Public link copied. Anyone with the link can see and comment on this proposal, no sign-in needed."));
  } catch {
    prompt(t("Public link"), shareUrl(token));
  }
}

async function shareProposal(id) {
  const name = await ensureName();
  if (!name) return;
  const entry = await post(`${BASE}/api/proposals/${id}/share`, { by: name }).catch((error) => toast(error.message));
  if (!entry?.token) return;
  await refresh(true);
  await copyShare(entry.token);
}

async function revokeShare(token) {
  const name = await ensureName();
  if (!name) return;
  await post(`${BASE}/api/shares/${token}/revoke`, { by: name });
  await refresh(true);
  toast(t("Link revoked. Anyone who opens it now sees it no longer works."));
}

function collapseOnPhone() {
  if (phone()) setSidebarCollapsed(true);
}

function openProposalReader(id) {
  const first = readerItemsOfProposal(state.data.proposals.find((proposal) => proposal.id === id))[0];
  if (first) openOverlay(first.screenId, first.version);
}

function focusOn(focus, reserveRight = 0) {
  state.focus = focus;
  const target = proposalById(focus);
  if (target && !Object.keys(target.screens).some((id) => tabs.visible(screenById(id)?.section))) tabs.showFor(screenById(Object.keys(target.screens)[0])?.section);
  deselect();
  render();
  if (!focus || focus === "all") return fit();
  const proposal = proposalById(focus);
  const members = proposal ? placedOfProposal(proposal) : [];
  if (!members.length) return fit();
  const right = Math.max(...members.map((entry) => entry.x + (entry.reach ?? entry.width)));
  const room = viewport.clientWidth - 2 * canvasMargin().side - sidebarInset() - reserveRight;
  zoomTo(
    {
      left: room / right >= 0.6 ? 0 : Math.min(...members.map((entry) => entry.x)),
      top: Math.min(...members.map((entry) => entry.y)) - 160,
      right,
      bottom: Math.max(...members.map((entry) => entry.y + entry.height)),
    },
    reserveRight,
  );
}

function panelInset() {
  if (viewport.clientWidth <= 760) return 0;
  return ["#inspector", "#ai-panel"].map((id) => $(id)).filter((node) => node && !node.hidden && !node.classList.contains("docked")).reduce((most, node) => Math.max(most, node.offsetWidth), 0);
}

function sidebarInset() {
  const sidebar = $("#sidebar");
  return viewport.clientWidth > 760 && !sidebar.classList.contains("collapsed") ? sidebar.offsetWidth + 16 : 0;
}

function canvasMargin() {
  return phone() ? { side: 16, top: 72, below: 72 } : { side: 60, top: 90, below: 130 };
}

function zoomTo(box, reserveRight = 0, cap = 1) {
  reserveRight = Math.max(reserveRight, panelInset());
  const inset = sidebarInset();
  const margin = canvasMargin();
  const width = viewport.clientWidth - 2 * margin.side - inset - reserveRight;
  const height = viewport.clientHeight - margin.top - margin.below;
  state.manual = true;
  state.scale = Math.min(cap, width / (box.right - box.left), height / (box.bottom - box.top));
  state.tx = inset + margin.side + (width - (box.right - box.left) * state.scale) / 2 - box.left * state.scale;
  state.ty = margin.top + (height - (box.bottom - box.top) * state.scale) / 2 - box.top * state.scale;
  applyTransform();
}

function applyTransform() {
  const transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  world.style.transform = transform;
  world.style.setProperty("--inv", String(1 / state.scale));
  placeNote();
  $("#zoom-pct").textContent = `${Math.round(state.scale * 100)}%`;
  placeInspector();
  live?.reposition();
  zoom.update();
  board?.onTransform();
}

function fit() {
  if (board?.active()) return board.fit();
  if (!state.placed.length || viewport.clientWidth < 200) return;
  state.manual = false;
  const nodes = [...world.querySelectorAll(".frame, .section")];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.offsetLeft);
    top = Math.min(top, node.offsetTop);
    right = Math.max(right, node.offsetLeft + node.offsetWidth + ("annos" in node.dataset ? ANNO_SPACE : 0));
    bottom = Math.max(bottom, node.offsetTop + node.offsetHeight);
  }
  const inset = sidebarInset();
  const margin = canvasMargin();
  const width = viewport.clientWidth - 2 * margin.side - inset;
  const height = viewport.clientHeight - margin.top - (phone() ? margin.below : 110);
  state.scale = Math.min(1.2, Math.max(0.1, Math.min(width / (right - left), height / (bottom - top))));
  state.tx = inset + margin.side + (width - (right - left) * state.scale) / 2 - left * state.scale;
  state.ty = margin.top + (height - (bottom - top) * state.scale) / 2 - top * state.scale;
  applyTransform();
}

function zoomAt(factor, cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2) {
  state.manual = true;
  const next = Math.min(3, Math.max(0.05, state.scale * factor));
  state.tx = cx - (cx - state.tx) * (next / state.scale);
  state.ty = cy - (cy - state.ty) * (next / state.scale);
  state.scale = next;
  applyTransform();
}

function approvalsOf(proposal) {
  if (proposal.approved) return proposal.approved;
  if (proposal.status !== "approved") return {};
  return Object.fromEntries(Object.keys(proposal.screens).map((screenId) => [screenId, { by: proposal.approvedBy, at: proposal.approvedAt }]));
}

function liveScreens(proposal) {
  const archived = new Set((state.data.archived ?? []).map((screen) => screen.id));
  return Object.keys(proposal.screens).filter((screenId) => !archived.has(screenId));
}

function pendingScreens(proposal) {
  const approved = approvalsOf(proposal);
  return liveScreens(proposal).filter((screenId) => !approved[screenId]);
}

function decisionFor(item) {
  if (frozen(item)) return null;
  if (item.kind === "proposal") return { action: "approve", proposal: item.proposal };
  const proposal = state.data.proposals.find((record) => record.screens[item.screen.id] === item.version && approvalsOf(record)[item.screen.id]);
  return proposal ? { action: "undo", proposal, approval: approvalsOf(proposal)[item.screen.id] } : null;
}

function select(item, silent = false) {
  state.selected = item;
  world.querySelectorAll(".frame.selected").forEach((node) => node.classList.remove("selected"));
  const placed = state.placed.find((entry) => entry.item.screen.id === item.screen.id && entry.item.version === item.version);
  placed?.element.classList.add("selected");
  const entry = versionEntry(item.screen, item.version);
  const decision = decisionFor(item);
  const proposal = decision?.proposal ?? proposalOfVersion(item.screen.id, item.version);
  const inspector = $("#inspector");
  inspector.innerHTML = `
    <div class="row"><span class="num ${item.kind === "official" ? "live" : "prop"}">${item.screen.number}</span><h3 class="grow">${escapeHtml(item.screen.name)}</h3>${
      item.kind === "official" ? `<span class="tag live">${t("Official")}</span>` : `<span class="tag prop">${frozen(item) ? t("Proposal {state}", { state: closedLabel(item.proposal).toLowerCase() }) : t("Proposal")}</span>`
    }</div>
    <dl class="kv">
      ${item.screen.route ? `<dt>${t("Route")}</dt><dd class="mono">${escapeHtml(item.screen.route)}</dd>` : ""}
      <dt>${t("Version")}</dt><dd>v${item.version} · ${escapeHtml(entry.by)} · ${timeAgo(entry.at)}</dd>
      ${proposal ? `<dt>${t("Proposal")}</dt><dd>${escapeHtml(proposal.title)}</dd>` : ""}
      ${decision?.action === "undo" ? `<dt>${t("Approved")}</dt><dd>${escapeHtml(decision.approval.by ?? t("someone"))} · ${timeAgo(decision.approval.at)}</dd>` : ""}
      <dt>${t("Comments")}</dt><dd>${state.data.comments[item.screen.id] ?? 0}</dd>
      ${state.data.annotations?.[item.screen.id] ? `<dt>${t("AI notes")}</dt><dd>${state.data.annotations[item.screen.id]}</dd>` : ""}
    </dl>
    <nav class="sel-open" aria-label="${t("Open the screen in")}">
      <button data-open="talk"><span>${t("Conversation")}</span><b>${state.data.comments[item.screen.id] ?? 0}</b></button>
      <button data-open="inspect"><span>${t("Inspect")}</span></button>
      <button data-open="history"><span>${t("History")}</span><b>${item.screen.versions?.length ?? ""}</b></button>
    </nav>`;
  inspector.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => openOverlayOn(item, button.dataset.open)));
  inspector.hidden = false;
  renderFrameBar();
  $("#askbar").hidden = Boolean(shared);
  $("#ask-input").placeholder = aiPanel ? t("Ask the AI about screen {number}…", { number: item.screen.number }) : t("Ask @{handle} about screen {number}…", { handle: HANDLE, number: item.screen.number });
  placeInspector();
  if (!silent) $("#ask-input").blur();
  layers.render();
}

function renderFrameBar() {
  const bar = $("#frame-bar");
  const item = state.selected;
  if (!item) {
    bar.hidden = true;
    return;
  }
  const decision = shared ? null : decisionFor(item);
  const base = compareBase(item.screen, item.version);
  bar.innerHTML = `${
    decision?.action === "approve" ? `<button class="btn sm approve" data-bar="approve">${t("✓ Approve this screen")}</button>` : ""
  }${decision?.action === "undo" ? `<button class="btn sm" data-bar="undo">${t("Undo approval")}</button>` : ""}${
    base ? `<button class="btn sm" data-bar="compare">${escapeHtml(compareLabel(base))}</button>` : ""
  }<button class="btn sm" data-bar="play" title="${t("Present from this screen")}">${t("▶ Present")}</button><button class="btn sm" data-bar="open">${t("Open")}</button>`;
  bar.querySelector('[data-bar="approve"]')?.addEventListener("click", () => approveScreen(decision.proposal, item.screen));
  bar.querySelector('[data-bar="undo"]')?.addEventListener("click", () => reopenScreen(decision.proposal, item.screen));
  bar.querySelector('[data-bar="compare"]')?.addEventListener("click", () => openCompare(item));
  bar.querySelector('[data-bar="open"]').addEventListener("click", () => openOverlay(item.screen.id, item.version));
  bar.querySelector('[data-bar="play"]').addEventListener("click", () => startPresenting(item.screen.id, item.version));
  bar.hidden = false;
  placeInspector();
}

function deselect() {
  state.selected = null;
  world.querySelectorAll(".frame.selected").forEach((node) => node.classList.remove("selected"));
  $("#inspector").hidden = true;
  $("#frame-bar").hidden = true;
  $("#askbar").hidden = true;
}

function placeInspector() {
  const bar = $("#frame-bar");
  if (!state.selected || bar.hidden) return;
  const placed = state.placed.find((entry) => entry.item.screen.id === state.selected.screen.id && entry.item.version === state.selected.version);
  const box = placed?.element.querySelector(".box");
  if (!box) return;
  const rect = box.getBoundingClientRect();
  const width = bar.offsetWidth;
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  const below = rect.bottom + 12;
  const top = below + bar.offsetHeight > window.innerHeight - 80 ? Math.max(12, rect.top - bar.offsetHeight - 12) : below;
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
}

function confirmApproval(proposal, screens) {
  const names = screens.map((id) => t("screen {number} ({name})", { number: screenById(id)?.number ?? "?", name: screenById(id)?.name ?? id }));
  const dialog = $("#approve-dialog");
  $("#approve-title").textContent = t(names.length === 1 ? "Approve {n} screen as official?" : "Approve {n} screens as official?", { n: names.length });
  $("#approve-text").textContent = t('From "{title}", these become official: {names}. You can undo it later.', { title: proposal.title, names: names.join(", ") });
  dialog.returnValue = "";
  dialog.showModal();
  $("#approve-cancel").focus();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "approve"), { once: true }));
}

async function approveScreen(proposal, screen) {
  const name = await ensureName();
  if (!name) return;
  await post(`${BASE}/api/proposals/${proposal.id}/approve`, { by: name, screen: screen.id });
  await refresh(true);
  const official = state.placed.find((entry) => entry.item.screen.id === screen.id && entry.item.kind === "official");
  if (official) select(official.item, true);
  toast(t("Screen {number} is now official.", { number: screen.number }), { label: t("Undo"), run: () => reopenScreen(proposal, screen, true) });
}

async function approveAll(proposal) {
  if (!proposal) return;
  const name = await ensureName();
  if (!name) return;
  const pending = pendingScreens(proposal);
  if (!(await confirmApproval(proposal, pending))) return;
  await post(`${BASE}/api/proposals/${proposal.id}/approve`, { by: name });
  await refresh(true);
  toast(t(pending.length === 1 ? "{n} screen is now official." : "{n} screens are now official.", { n: pending.length }), { label: t("Undo"), run: () => reopen(proposal, true) });
}

async function reopenScreen(proposal, screen, fromToast = false) {
  const name = await ensureName();
  if (!name) return;
  if (!fromToast && !confirm(t("Undo the approval of screen {number}? It goes back to being a proposal.", { number: screen.number }))) return;
  await post(`${BASE}/api/proposals/${proposal.id}/reopen`, { by: name, screen: screen.id });
  await refresh(true);
  toast(t("Screen {number} is a proposal again.", { number: screen.number }));
}

async function reopen(proposal, fromToast = false) {
  const name = await ensureName();
  if (!name) return;
  if (!fromToast && !confirm(t('Undo the approval of "{title}"? Its screens go back to being a proposal.', { title: proposal.title }))) return;
  await post(`${BASE}/api/proposals/${proposal.id}/reopen`, { by: name });
  await refresh(true);
  toast(t('Approval of "{title}" undone.', { title: proposal.title }));
}

const pendingComments = new Map();
const SETTLED_KEEP_MS = 30000;

function withPending(list = [], screen = null) {
  const known = new Set(list.map((entry) => entry.id));
  for (const [id, entry] of pendingComments) if (entry.settledAt && (known.has(id) || Date.now() - entry.settledAt > SETTLED_KEEP_MS)) pendingComments.delete(id);
  const all = [...list, ...[...pendingComments.values()].filter((entry) => (!screen || entry.screen === screen) && !known.has(entry.id))];
  return resolving.size ? all.map((entry) => (resolving.has(entry.id) ? { ...entry, resolved: resolving.get(entry.id) } : entry)) : all;
}

const resolving = new Map();

async function resolveThread(root, reopen = false) {
  const name = await ensureName();
  if (!name) return;
  resolving.set(root, reopen ? null : { by: name, at: new Date().toISOString() });
  if (!reopen && state.note?.root === root) closeNote();
  rerenderComments();
  try {
    await post(`${BASE}/api/comments/${root}/resolve`, { by: name, reopen });
    await refresh(true).catch(() => {});
  } catch (error) {
    toast(t(reopen ? "Couldn't reopen the thread: {error}" : "Couldn't resolve the thread: {error}", { error: error.message }), { label: t("Try again"), run: () => resolveThread(root, reopen) });
  } finally {
    resolving.delete(root);
    rerenderComments();
  }
}

function rerenderComments() {
  if (!state.data) return;
  renderPins();
  if (state.note?.root && !$("#note-text")?.value) renderNote();
  if (state.overlay) renderSide();
}

function settleComment(entry, saved) {
  pendingComments.delete(entry.id);
  pendingComments.set(saved.id, { ...saved, settledAt: Date.now() });
  for (const child of pendingComments.values()) if (child.replyTo === entry.id) child.replyTo = saved.id;
  if (state.note?.root === entry.id) state.note.root = saved.id;
  rerenderComments();
}

function dropComment(entry, retry) {
  const lost = [entry.id];
  for (const child of pendingComments.values()) if (lost.includes(child.replyTo)) lost.push(child.id);
  lost.forEach((id) => pendingComments.delete(id));
  if (lost.includes(state.note?.root)) closeNote();
  rerenderComments();
  if (retry) toast(t("Couldn't send the comment."), { label: t("Try again"), run: retry });
}

async function sendComment({ screen, el, els, point, version, text, replyTo }) {
  const name = await ensureName();
  if (!name) return null;
  const entry = {
    id: `pending-${Math.random().toString(36).slice(2)}`,
    screen,
    el: (el instanceof Promise ? null : el) ?? els?.[0] ?? null,
    els: els ?? null,
    point: point ?? null,
    version: version ?? null,
    author: name,
    kind: "human",
    text,
    replyTo: replyTo ?? null,
    at: new Date().toISOString(),
    pending: true,
  };
  const parent = pendingComments.get(replyTo)?.saved ? pendingComments.get(replyTo) : null;
  pendingComments.set(entry.id, entry);
  entry.saved = (async () => {
    const root = parent ? (await parent.saved).id : replyTo;
    return post(`${BASE}/api/comments`, { screen, el: await el, els, point, version, text, author: name, replyTo: root ?? null });
  })();
  entry.saved.then(
    (saved) => settleComment(entry, saved),
    () => dropComment(entry, parent ? null : () => sendComment({ screen, el, els, point, version, text, replyTo })),
  );
  return entry;
}

function messageTime(message) {
  return message.pending ? t("sending…") : timeAgo(message.at);
}

function threadsOf(comments) {
  const roots = comments.filter((entry) => !entry.replyTo);
  return roots.map((root) => {
    const messages = [root, ...comments.filter((entry) => entry.replyTo === root.id)];
    const lastHuman = messages.findLastIndex((entry) => entry.kind === "human" && /@[a-z]/i.test(entry.text));
    const lastAgent = messages.findLastIndex((entry) => entry.kind === "agent");
    return { root, messages, waiting: lastHuman > lastAgent ? messages[lastHuman] : null };
  });
}

async function openOverlay(screenId, version) {
  if (state.overlay && (state.overlay.screenId !== screenId || state.overlay.version !== version) && !editing.leave()) return;
  const screen = screenById(screenId);
  const keep = state.overlay ?? {};
  state.overlay = { screenId, version, compare: false, commenting: false, focusEl: null, comments: [], split: 50, zoom: 1, panel: keep.panel ?? "talk", compareMode: keep.compareMode ?? "slide", compareWith: null };
  const opened = state.overlay;
  $("#overlay").hidden = false;
  document.body.style.overflow = "hidden";
  history.replaceState(null, "", `#${screen.id}/v${version}`);
  await loadOverlayComments();
  if (state.overlay !== opened) return;
  renderOverlay();
  live?.look(screenId, version);
}

function closeOverlay() {
  if (!editing.leave()) return;
  inspector.setOn(false);
  closeExportMenu();
  state.overlay = null;
  $("#overlay").hidden = true;
  editing.renderBar();
  live?.look(null);
  history.replaceState(null, "", location.pathname + location.search);
}

async function loadOverlayComments() {
  const overlay = state.overlay;
  if (!overlay) return;
  overlay.comments = await api(`${BASE}/api/comments/${overlay.screenId}`);
}

function readerItemsOfProposal(proposal) {
  return pinnedVersions(proposal, state.data.screens);
}

function readerItems() {
  const { screenId, version } = state.overlay;
  const proposal = proposalOfVersion(screenId, version);
  const focused = proposalById(state.focus);
  const ofProposal = readerItemsOfProposal(focused?.screens[screenId] === version ? focused : proposal?.status === "open" ? proposal : null);
  if (ofProposal.some((item) => item.screenId === screenId && item.version === version)) return ofProposal;
  return state.placed.map((entry) => ({ screenId: entry.item.screen.id, version: entry.item.version }));
}

function stepReader(delta) {
  if (!state.overlay) return;
  const items = readerItems();
  const index = items.findIndex((item) => item.screenId === state.overlay.screenId && item.version === state.overlay.version);
  const next = items[index + delta];
  if (index >= 0 && next) openOverlay(next.screenId, next.version);
}

function renderReaderNav() {
  const items = readerItems();
  const index = items.findIndex((item) => item.screenId === state.overlay.screenId && item.version === state.overlay.version);
  const nav = $("#ov-nav");
  nav.hidden = items.length < 2 || index < 0;
  $("#ov-pos").textContent = t("{n} of {total}", { n: index + 1, total: items.length });
  $("#ov-prev").disabled = index <= 0;
  $("#ov-next").disabled = index >= items.length - 1;
}

function overlayFit(entry) {
  const stage = $("#ov-stage");
  return Math.min(1, (stage.clientWidth - (phone() ? 24 : 56)) / entry.width);
}

function sizeOverlayFrame() {
  const overlay = state.overlay;
  const entry = versionEntry(screenById(overlay.screenId), overlay.version);
  const scale = overlayFit(entry) * overlay.zoom;
  const frame = $("#ov-stage .ov-frame");
  if (!frame) return scale;
  frame.style.width = `${Math.round(entry.width * scale)}px`;
  frame.style.height = `${Math.round(entry.height * scale)}px`;
  frame.querySelectorAll("iframe").forEach((iframe) => (iframe.style.transform = `scale(${scale})`));
  frame.classList.toggle("zoomed", overlay.zoom > 1);
  syncZoomButtons();
  return scale;
}

function syncZoomButtons() {
  const overlay = state.overlay;
  const zoomable = Boolean(overlay) && !overlay.compare && !overlay.commenting;
  $("#ov-zoom").hidden = !zoomable;
  if (!zoomable) return;
  const fit = overlayFit(versionEntry(screenById(overlay.screenId), overlay.version));
  $("#ov-zoom-out").disabled = overlay.zoom <= 1;
  $("#ov-zoom-fit").disabled = overlay.zoom <= 1;
  $("#ov-zoom-in").disabled = overlay.zoom >= 1.5 / fit - 0.01;
}

function fitStageToPhone() {
  const stage = $("#ov-stage");
  if (!phone()) {
    stage.style.maxHeight = "";
    return;
  }
  stage.style.maxHeight = `${Math.max(240, window.innerHeight - $("#overlay .ov-top").offsetHeight - 72)}px`;
}

function zoomOverlay(zoom, clientX, clientY) {
  const overlay = state.overlay;
  const stage = $("#ov-stage");
  const frame = stage.querySelector(".ov-frame");
  if (!frame) return;
  const entry = versionEntry(screenById(overlay.screenId), overlay.version);
  const fit = overlayFit(entry);
  const next = Math.max(1, Math.min(1.5 / fit, zoom));
  const rect = stage.getBoundingClientRect();
  const before = fit * overlay.zoom;
  const pointX = (stage.scrollLeft + clientX - rect.left - frame.offsetLeft) / before;
  const pointY = (stage.scrollTop + clientY - rect.top - frame.offsetTop) / before;
  overlay.zoom = next;
  const after = sizeOverlayFrame();
  stage.scrollLeft = pointX * after + frame.offsetLeft - (clientX - rect.left);
  stage.scrollTop = pointY * after + frame.offsetTop - (clientY - rect.top);
}

function watchReaderGestures(surface) {
  const overlay = state.overlay;
  let pinch = null;
  let swipe = null;
  let lastTap = 0;
  const spread = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const middle = (touches) => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });
  surface.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        swipe = null;
        pinch = { distance: spread(event.touches), zoom: overlay.zoom };
      } else if (event.touches.length === 1) {
        swipe = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
      }
    },
    { passive: false },
  );
  surface.addEventListener(
    "touchmove",
    (event) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const center = middle(event.touches);
      zoomOverlay(pinch.zoom * (spread(event.touches) / pinch.distance), center.x, center.y);
    },
    { passive: false },
  );
  surface.addEventListener("touchend", (event) => {
    if (pinch) {
      if (event.touches.length < 2) pinch = null;
      return;
    }
    if (!swipe || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    const quick = Date.now() - swipe.at < 600;
    swipe = null;
    if (overlay.zoom === 1 && quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      lastTap = 0;
      return stepReader(dx < 0 ? 1 : -1);
    }
    if (Math.abs(dx) + Math.abs(dy) > 10) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      event.preventDefault();
      zoomOverlay(overlay.zoom > 1 ? 1 : 3, touch.clientX, touch.clientY);
      return;
    }
    lastTap = now;
  });
}

function frameUrl(screenId, version) {
  return `${BASE}/api/screens/${screenId}/v${version}.html`;
}

function renderOverlay() {
  const overlay = state.overlay;
  const screen = screenById(overlay.screenId);
  const entry = versionEntry(screen, overlay.version);
  const proposal = proposalOfVersion(screen.id, overlay.version);
  $("#ov-name").textContent = `${screen.number} · ${screen.name}`;
  $("#ov-meta").textContent = `${screen.route ?? ""}${screen.route ? " · " : ""}v${overlay.version} · ${entry.by} · ${timeAgo(entry.at)}${
    screen.official === overlay.version ? ` · ${t("Official")}` : proposal ? ` · ${t("proposal {title}", { title: proposal.title })}` : ""
  }`;
  const versions = $("#ov-versions");
  versions.classList.toggle("single", screen.versions.length < 2);
  versions.innerHTML = screen.versions
    .slice(-6)
    .map(
      (item) =>
        `<button data-v="${item.v}" class="${item.v === overlay.version ? "on" : ""}">${
          item.v === screen.official ? '<i class="dot live"></i>' : ""
        }v${item.v}</button>`,
    )
    .join("");
  versions.querySelectorAll("button").forEach((button) =>
    button.addEventListener("click", () => {
      if (Number(button.dataset.v) !== overlay.version && !editing.leave()) return;
      overlay.version = Number(button.dataset.v);
      overlay.compare = false;
      overlay.compareWith = null;
      renderOverlay();
    }),
  );
  const base = overlayCompareBase(screen, overlay);
  const compareButton = $("#ov-compare");
  compareButton.hidden = !base;
  if (base) compareButton.textContent = compareLabel(base);
  compareButton.classList.toggle("on", overlay.compare);
  $("#ov-comment").classList.toggle("on", overlay.commenting);
  $("#ov-comment").textContent = overlay.commenting ? t("Commenting: click a piece") : t("Comment");
  const approveButton = $("#ov-approve");
  approveButton.hidden = Boolean(shared) || !(proposal && !isClosed(proposal) && pendingScreens(proposal).includes(screen.id) && screen.official !== overlay.version);
  approveButton.onclick = async () => {
    await approveScreen(proposal, screen);
    renderOverlay();
  };

  renderReaderNav();
  const stage = $("#ov-stage");
  fitStageToPhone();
  if (overlay.compare || overlay.commenting) overlay.zoom = 1;
  const scale = overlayFit(entry) * overlay.zoom;
  const width = Math.round(entry.width * scale);
  const height = Math.round(entry.height * scale);
  const sized = (src, extra = "") =>
    `<iframe src="${src}" style="width:${entry.width}px;height:${entry.height}px;transform:scale(${scale});transform-origin:0 0;${extra}"></iframe>`;
  if (overlay.compare && base) {
    const sideFit = Math.min(1, (stage.clientWidth - (phone() ? 24 : 76)) / (phone() ? 1 : 2) / entry.width);
    versionHistory.renderCompare(stage, { screen, entry, before: base, overlay, fit: scale, sideFit }).forEach((button) =>
      button.addEventListener("click", () => {
        overlay.compareMode = button.dataset.mode;
        renderOverlay();
      }),
    );
  } else {
    const touch = phone() && !overlay.commenting;
    stage.innerHTML = `<div class="ov-frame ${overlay.commenting ? "commenting" : ""}${overlay.zoom > 1 ? " zoomed" : ""}" style="width:${width}px;height:${height}px">${sized(
      frameUrl(screen.id, overlay.version),
      "position:absolute;left:0;top:0",
    )}${touch ? '<div class="ov-touch"></div>' : ""}</div>`;
    if (touch) watchReaderGestures(stage.querySelector(".ov-touch"));
  }
  syncZoomButtons();
  renderSide();
  renderPanel();
  editing.renderBar();
}

function overlayCompareBase(screen, overlay) {
  if (overlay.compareWith && overlay.compareWith !== overlay.version && versionEntry(screen, overlay.compareWith)) {
    return { version: overlay.compareWith, official: screen.official === overlay.compareWith };
  }
  return compareBase(screen, overlay.version);
}

const editing = createEditing({
  base: BASE,
  frames: () => [...document.querySelectorAll("#ov-stage iframe")],
  current: () => (state.overlay && !state.overlay.compare ? { screenId: state.overlay.screenId, version: state.overlay.version } : null),
  canEdit: () => {
    const overlay = state.overlay;
    const screen = overlay && screenById(overlay.screenId);
    return Boolean(screen && !shared && !overlay.compare && !closedVersion(screen, overlay.version, state.data.proposals));
  },
  lockedReason: () => {
    const overlay = state.overlay;
    const screen = overlay && screenById(overlay.screenId);
    if (!screen || shared || !closedVersion(screen, overlay.version, state.data.proposals)) return null;
    return t("This version belongs to a closed proposal and is read-only. To change it, open the official version.");
  },
  escapeHtml,
  toast,
  post,
  ensureName,
  targetText: (screenId, version) => editorTarget(screenById(screenId), version),
  onSaved: async (saved) => {
    await refresh(true);
    focusOn(saved.proposal);
    await openOverlay(saved.screen, saved.version);
    const proposal = state.data.proposals.find((record) => record.id === saved.proposal);
    toast(t('Screen {number}, v{version}, saved in "{title}". Still needs approval.', { number: screenById(saved.screen)?.number ?? "", version: saved.version, title: proposal?.title ?? saved.proposal }));
  },
  onAskAi: (info) => askAiAbout(info),
  rerender: () => {
    if (state.overlay?.panel === "inspect") inspector.render();
  },
});

function askAiAbout(info) {
  const overlay = state.overlay;
  if (!overlay) return;
  overlay.focusEl = info?.piece ?? null;
  if (editing.dirty) toast(t("The AI starts from the saved version. Save first if you want it to see your changes."));
  if (aiPanel) {
    aiPanel.toggle(true);
    return;
  }
  setPanel("talk");
  renderSide();
  const text = $("#composer-text");
  if (!text) return;
  text.value = `@${HANDLE} `;
  text.focus();
}

const inspector = createInspector({
  frames: () => [...document.querySelectorAll("#ov-stage iframe")],
  current: () => (state.overlay && !state.overlay.compare ? { screenId: state.overlay.screenId, version: state.overlay.version } : null),
  base: BASE,
  escapeHtml,
  toast,
  onEscape: () => closeOverlay(),
  editing,
});

const versionHistory = createHistory({ base: BASE, escapeHtml, timeAgo, frameUrl, shared: () => Boolean(shared) });

const presenter = createPresenter({ data: () => state.data, frameUrl, escapeHtml });

function startPresenting(screenId, version) {
  const proposal = proposalOfVersion(screenId, version) ?? proposalById(state.focus);
  presenter.start(screenId, { proposal: proposal && playVersion(screenById(screenId), proposal) === version ? proposal : null });
}

function setPanel(panel, toggle = false) {
  const overlay = state.overlay;
  if (!overlay) return;
  overlay.panel = toggle && overlay.panel === panel ? "talk" : panel;
  const stageChanges = overlay.panel === "inspect" && (overlay.commenting || overlay.compare);
  if (overlay.panel === "inspect") {
    overlay.commenting = false;
    overlay.compare = false;
  }
  if (overlay.panel !== "history") overlay.compareWith = null;
  if (stageChanges) return renderOverlay();
  renderPanel();
}

function renderPanel() {
  const overlay = state.overlay;
  if (!overlay) return;
  const panel = overlay.panel ?? "talk";
  document.querySelectorAll("#ov-tabs [data-panel]").forEach((button) => {
    button.classList.toggle("on", button.dataset.panel === panel);
    button.setAttribute("aria-selected", String(button.dataset.panel === panel));
  });
  $("#ov-side").hidden = panel !== "talk";
  $("#ov-dev").hidden = panel === "talk";
  inspector.setOn(panel === "inspect" && !overlay.compare);
  if (panel === "inspect") inspector.render($("#ov-dev"));
  if (panel === "history") {
    versionHistory.render($("#ov-dev"), {
      screen: screenById(overlay.screenId),
      proposals: state.data.proposals,
      version: overlay.version,
      compareWith: overlay.compare ? overlayCompareBase(screenById(overlay.screenId), overlay)?.version : null,
      onOpen: (version) => {
        if (version !== overlay.version && !editing.leave()) return;
        overlay.version = version;
        overlay.compare = false;
        overlay.compareWith = null;
        renderOverlay();
      },
      onCompare: (version) => {
        overlay.compareWith = version;
        overlay.compare = Boolean(version);
        overlay.commenting = false;
        renderOverlay();
      },
      onRestore: restoreVersion,
    });
  }
}

async function restoreVersion(version) {
  const overlay = state.overlay;
  const name = await ensureName();
  if (!name || !overlay) return renderPanel();
  try {
    const restored = await post(`${BASE}/api/screens/${overlay.screenId}/revert`, { version, by: name });
    await refresh(true);
    await openOverlay(restored.screen, restored.version);
    toast(t("v{version} is back as v{restored}, in a new proposal. Still needs approval.", { version, restored: restored.version }));
  } catch (error) {
    toast(t("Couldn't restore: {error}", { error: error.message }));
    renderPanel();
  }
}

function closeExportMenu() {
  document.querySelector(".export-menu")?.remove();
}

function openExportMenu() {
  if (document.querySelector(".export-menu")) return closeExportMenu();
  const overlay = state.overlay;
  const screen = screenById(overlay.screenId);
  const version = overlay.version;
  const menu = document.createElement("div");
  menu.className = "fl frame-menu export-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<div class="fm-title">${t("Export v{version}", { version })}</div><button class="fm-item" data-export="png" role="menuitem">${t("Screen PNG")}</button><button class="fm-item" data-export="html" role="menuitem">${t("Screen HTML")}</button>${
    shared ? "" : `<button class="fm-item" data-export="piece" role="menuitem">${t("PNG of a piece…")}</button>`
  }`;
  document.body.appendChild(menu);
  const anchor = $("#ov-export").getBoundingClientRect();
  menu.style.top = `${anchor.bottom + 6}px`;
  menu.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.zIndex = 70;
  const actions = {
    png: async () => {
      const blob = await fetchBlob(`${BASE}/api/screens/${screen.id}/v${version}.png`);
      if (!blob) return toast(t("This version has no image yet. Ask the chat to take a screenshot of the screen."));
      saveBlob(blob, fileName(screen.id, version));
    },
    html: async () => {
      const blob = await fetchBlob(`${BASE}/api/screens/${screen.id}/v${version}.export.html`);
      if (!blob) return toast(t("Couldn't download the HTML."));
      saveBlob(blob, fileName(screen.id, version, "", "html"));
    },
    piece: () => {
      setPanel("inspect");
      toast(t("Click the piece and use the piece PNG in the panel."));
    },
  };
  menu.querySelectorAll("[data-export]").forEach((button) =>
    button.addEventListener("click", () => {
      closeExportMenu();
      actions[button.dataset.export]();
    }),
  );
  setTimeout(() => document.addEventListener("pointerdown", (event) => !event.target.closest(".export-menu, #ov-export") && closeExportMenu(), { once: true }));
}

function pinsFor(comments) {
  return threadsOf(splitAnnotations(comments).comments)
    .filter((thread) => thread.root.el && !thread.root.resolved)
    .reduce((pins, thread) => {
      const existing = pins.find((pin) => pin.el === thread.root.el);
      if (existing) existing.count += thread.messages.length;
      else pins.push({ el: thread.root.el, count: thread.messages.length, color: thread.waiting ? "#FF6363" : "#8728E6" });
      return pins;
    }, []);
}

function postToFrames(message) {
  document.querySelectorAll("#ov-stage iframe").forEach((frame) => frame.contentWindow?.postMessage(message, "*"));
}

function renderSide() {
  const overlay = state.overlay;
  const side = $("#ov-side");
  const all = threadsOf(splitAnnotations(withPending(overlay.comments, overlay.screenId)).comments);
  const threads = all.filter((thread) => !thread.root.resolved);
  const closed = all.filter((thread) => thread.root.resolved);
  const notes = state.showAnnotations ? annotationThreads(overlay.comments) : [];
  side.innerHTML = `
    <div class="head"><b>${t("Conversation")}</b><span class="tag plain">${threads.length}</span></div>
    <div class="threads">${
      notes.length
        ? `<div class="ov-annos">${notes
            .map(
              ({ root }) => `<div class="anno open static"><div class="anno-head"><span class="anno-chip">${escapeHtml(root.category || t("AI note"))}</span>${
                root.el ? `<span class="anno-piece">${escapeHtml(prettyPiece(root.el))}</span>` : ""
              }</div><div class="anno-text">${formatAnnotation(root.text)}</div></div>`,
            )
            .join("")}</div>`
        : ""
    }${
      threads.length
        ? threads
            .map(
              (thread) => `<div class="thread ${overlay.focusEl && thread.root.el === overlay.focusEl ? "focus" : ""}" data-root="${thread.root.id}" data-el="${escapeHtml(thread.root.el ?? "")}">
          <div class="thread-head">${thread.root.el ? `<span class="anchor">${escapeHtml(thread.root.el)}</span>` : `<span class="anchor">${t("whole screen")}</span>`}${
            shared || thread.root.pending ? "" : `<button type="button" class="icon-btn" data-action="resolve" title="${t("Resolve thread")}" aria-label="${t("Resolve thread")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>`
          }</div>
          ${thread.messages
            .map(
              (message) => `<div class="msg${message.pending ? " pending" : ""}"><span class="avatar ${message.kind === "agent" ? "agent" : ""}">${escapeHtml(initials(message.author))}</span><div class="bd"><div class="nm">${escapeHtml(
                message.author,
              )}${authorTag(message)}<span class="t">${messageTime(message)}${
                message.version ? ` · v${message.version}` : ""
              }</span></div>${withMentions(message.text)}</div></div>`,
            )
            .join("")}
          ${thread.waiting ? `<div class="waiting-line"><i class="dot" style="background:var(--agent)"></i>${t("waiting for a chat to reply")}</div>` : ""}
          <form class="reply"><input placeholder="${t("Reply")}" required><button class="btn sm">${t("Send")}</button></form>
        </div>`,
            )
            .join("")
        : `<p class="muted">${closed.length ? t("No open threads.") : t("No comments yet. Click Comment, then a piece of the screen.")}</p>`
    }${
      closed.length
        ? `<details class="resolved-group"${overlay.showResolved ? " open" : ""}><summary>${t("Resolved ({n})", { n: closed.length })}</summary>${closed
            .map(
              (thread) => `<div class="thread resolved" data-root="${thread.root.id}">
          <div class="thread-head">${thread.root.el ? `<span class="anchor">${escapeHtml(thread.root.el)}</span>` : `<span class="anchor">${t("whole screen")}</span>`}<span class="muted resolved-by">${t("resolved by {name}", { name: escapeHtml(thread.root.resolved.by ?? t("someone")) })}</span>${shared ? "" : `<button type="button" class="btn sm" data-action="reopen">${t("Reopen")}</button>`}</div>
          ${thread.messages
            .map(
              (message) => `<div class="msg"><span class="avatar ${message.kind === "agent" ? "agent" : ""}">${escapeHtml(initials(message.author))}</span><div class="bd"><div class="nm">${escapeHtml(
                message.author,
              )}${authorTag(message)}<span class="t">${messageTime(message)}</span></div>${withMentions(message.text)}</div></div>`,
            )
            .join("")}
        </div>`,
            )
            .join("")}</details>`
        : ""
    }</div>
    <form class="composer" id="composer">
      <div class="row"><label class="anchor-pick"><span class="muted">${t("On")}</span><select id="composer-el" aria-label="${t("Screen piece")}">
        <option value="">${t("whole screen")}</option>
        ${[...new Set([...(overlay.els ?? []), ...(overlay.focusEl ? [overlay.focusEl] : [])])]
          .map((name) => `<option value="${escapeHtml(name)}" ${name === overlay.focusEl ? "selected" : ""}>${escapeHtml(name)}</option>`)
          .join("")}
      </select></label><div class="grow"></div></div>
      <textarea id="composer-text" placeholder="${t("Write, and tag @{handle} to call the open chat", { handle: HANDLE })}" required></textarea>
      <div class="row end"><button class="btn primary sm">${t("Comment")}</button></div>
    </form>`;
  side.querySelectorAll('.thread [data-action="resolve"]').forEach((button) => button.addEventListener("click", () => resolveThread(button.closest(".thread").dataset.root)));
  side.querySelectorAll('.thread [data-action="reopen"]').forEach((button) => button.addEventListener("click", () => resolveThread(button.closest(".thread").dataset.root, true)));
  side.querySelector(".resolved-group")?.addEventListener("toggle", (event) => (overlay.showResolved = event.target.open));
  side.querySelectorAll(".thread form.reply").forEach((form) =>
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const root = form.closest(".thread").dataset.root;
      const text = form.querySelector("input").value.trim();
      const original = withPending(overlay.comments, overlay.screenId).find((entry) => entry.id === root);
      if (!text) return;
      const sent = await sendComment({ screen: overlay.screenId, el: original.el, version: overlay.version, text, replyTo: root });
      if (sent) renderSide();
    }),
  );
  $("#composer-el").addEventListener("change", (event) => {
    overlay.focusEl = event.target.value || null;
    side.querySelectorAll(".thread").forEach((thread) => thread.classList.toggle("focus", Boolean(overlay.focusEl) && thread.dataset.el === overlay.focusEl));
    $("#composer-text").focus();
  });
  $("#composer").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("#composer-text").value.trim();
    if (!text) return;
    const sent = await sendComment({ screen: overlay.screenId, el: overlay.focusEl, version: overlay.version, text });
    if (!sent) return;
    if (/@[a-z]/i.test(text)) toast(t("Sent. It reaches whichever chat is listening."));
    overlay.commenting = false;
    $("#ov-comment").classList.remove("on");
    $("#ov-comment").textContent = t("Comment");
    document.querySelector("#ov-stage .ov-frame")?.classList.remove("commenting");
    if (phone()) return renderOverlay();
    renderSide();
  });
  postToFrames({ type: "pins", pins: pinsFor(withPending(overlay.comments, overlay.screenId)) });
  postToFrames({ type: "mode", comment: overlay.commenting });
}

window.addEventListener("message", (event) => {
  const data = event.data ?? {};
  if (!state.overlay) return;
  const fromScreen = [...document.querySelectorAll("#ov-stage iframe")].some((frame) => frame.contentWindow === event.source);
  if (!fromScreen) return;
  if (data.type === "ready") {
    const names = Array.isArray(data.els) ? data.els.filter((name) => typeof name === "string").slice(0, 300) : [];
    if (names.join("|") !== (state.overlay.els ?? []).join("|")) {
      state.overlay.els = names;
      renderSide();
    }
    postToFrames({ type: "pins", pins: pinsFor(withPending(state.overlay.comments, state.overlay.screenId)) });
    postToFrames({ type: "mode", comment: state.overlay.commenting });
  }
  if (data.type === "pick") {
    state.overlay.focusEl = data.el;
    state.overlay.commenting = false;
    renderSide();
    $("#ov-comment").classList.remove("on");
    $("#ov-comment").textContent = t("Comment");
    $("#composer-text")?.focus();
    if (phone()) $("#composer")?.scrollIntoView({ block: "end", behavior: "smooth" });
  }
  if (data.type === "open") {
    state.overlay.focusEl = data.el;
    renderSide();
    document.querySelector(".thread.focus")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
});

async function refresh(force = false) {
  const data = await api(`${BASE}/api/overview?handle=${encodeURIComponent(HANDLE)}`);
  const signature = JSON.stringify(data);
  if (!force && signature === state.signature) return;
  state.signature = signature;
  state.data = data;
  render();
  if (state.note?.root && !$("#note-text")?.value) renderNote();
  if (state.overlay) {
    await loadOverlayComments();
    renderSide();
  }
}

let live = null;

const tabs = createTabs({
  base: BASE,
  state,
  bar: $("#tabbar"),
  menu: $("#frame-menu"),
  closeMenu: closeFrameMenu,
  api,
  post,
  ensureName,
  refresh,
  toast,
  readOnly: () => Boolean(shared),
  onChange: ({ fit: refit }) => {
    deselect();
    render();
    if (refit) fit();
  },
});
const layers = createLayers({
  state,
  list: $("#section-list"),
  search: $("#layer-search"),
  tabs,
  focusSection: (section) => zoomTo(section.box),
  focusPlaced: (placed) => {
    zoomTo({ left: placed.x - 60, top: placed.y - 110, right: placed.x + (placed.reach ?? placed.width) + 60, bottom: placed.y + placed.height + 60 });
    select(placed.item);
  },
  focusProposal: (id) => focusOn(id),
  onPick: collapseOnPhone,
  board: () => {
    try {
      return board;
    } catch {
      return null;
    }
  },
});
const zoom = createZoom({ state, viewport, menu: $("#frame-menu"), closeMenu: closeFrameMenu, pct: $("#zoom-pct"), fit, zoomAt, zoomTo, applyTransform });
const palette = createPalette({
  state,
  tabs,
  layers,
  zoom,
  fit,
  zoomAt,
  focusProposal: (id) => focusOn(id),
  commands: () => [
    { label: t("Fit all"), keys: "Shift+1", run: fit },
    { label: t("Fit selection"), keys: "Shift+2", run: zoom.fitSelection },
    { label: t("Zoom to 100%"), keys: "Shift+0", run: zoom.zoomTo100 },
    { label: zoom.minimapOn() ? t("Hide minimap") : t("Show minimap"), run: zoom.toggleMinimap },
    { label: state.view === "flow" ? t("View as canvas") : t("View as flow"), run: () => document.querySelector(`#views [data-view="${state.view === "flow" ? "canvas" : "flow"}"]`)?.click() },
    ...(shared ? [] : [{ label: t("New page"), run: () => tabs.createPage("screens") }, { label: t("New board"), run: () => tabs.createPage("board") }, { label: t("Rename this page"), run: tabs.renameCurrent }]),
    { label: t("Comment"), keys: "C", run: () => setTool("comment") },
    ...(shared ? [] : [{ label: t("Sticky note"), keys: "N", run: () => setTool("sticky") }]),
    ...(shared ? [] : [{ label: t("Edit pieces"), keys: "E", run: () => setTool("edit") }]),
    { label: state.showAnnotations ? t("Hide AI notes") : t("Show AI notes"), run: () => setAnnotationsShown(!state.showAnnotations) },
    ...(state.selected ? [{ label: t("Present from {name}", { name: state.selected.screen.name }), run: () => startPresenting(state.selected.screen.id, state.selected.version) }] : []),
    ...(state.overlay ? [{ label: t("Inspect the screen"), keys: "I", run: () => setPanel("inspect") }, { label: t("Version history"), keys: "H", run: () => setPanel("history") }] : []),
    { label: t("Toggle light or dark theme"), run: () => $("#theme").click() },
    { label: t("Show or hide the list"), run: () => $("#sidebar-toggle").click() },
    { label: t("Keyboard shortcuts"), keys: "?", run: () => palette.shortcuts() },
  ],
});
const board = createBoard({
  state,
  viewport,
  world,
  base: BASE,
  api,
  post,
  ensureName,
  myName,
  toast,
  liveId: clientId(),
  openScreen: (screenId, version) => openOverlay(screenId, version),
  zoomTo,
  applyTransform: () => applyTransform(),
  readOnly: () => Boolean(shared),
  menu: $("#frame-menu"),
  closeMenu: closeFrameMenu,
  onChange: () => layers.render(),
  onSelect: (ids) => {
    state.boardSelection = ids;
    aiPanel?.refreshContext?.();
  },
});
document.addEventListener(
  "keydown",
  (event) => {
    if (state.overlay || state.editor || presenter.playing) return;
    if (board.handleKey(event)) event.stopImmediatePropagation();
  },
  true,
);
const stickies = createStickies({
  state,
  world,
  viewport,
  tabs,
  base: BASE,
  post,
  ensureName,
  refresh,
  toast,
  readOnly: () => Boolean(shared),
  setTool,
  menu: $("#frame-menu"),
  closeMenu: closeFrameMenu,
});
world.addEventListener("contextmenu", (event) => {
  const head = event.target.closest(".section-head");
  if (head) tabs.sectionMenu(event, head.parentElement.dataset.section);
});

async function agentDrew(activity) {
  await refresh(true).catch(() => {});
  const placed = state.placed.find((entry) => entry.item.screen.id === activity.screen && entry.item.version === activity.version);
  if (!placed) return;
  placed.element.classList.remove("arrived");
  void placed.element.offsetWidth;
  placed.element.classList.add("arrived");
}

let pointers = new Map();
let dragging = false;
let lastX = 0;
let lastY = 0;
let moved = false;
let pinch = null;

function pinchOf() {
  const [first, second] = [...pointers.values()];
  return { distance: Math.hypot(first.x - second.x, first.y - second.y), x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    pinch = pinchOf();
    moved = true;
  }
  if (pointers.size > 1) return;
  dragging = true;
  moved = false;
  lastX = event.clientX;
  lastY = event.clientY;
  viewport.classList.add("dragging");
});
window.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size === 2) {
    const next = pinchOf();
    zoomAt(next.distance / pinch.distance, next.x, next.y);
    state.tx += next.x - pinch.x;
    state.ty += next.y - pinch.y;
    applyTransform();
    pinch = next;
    return;
  }
  if (!pointers.has(event.pointerId) && pointers.size) return;
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
  state.tx += dx;
  state.ty += dy;
  state.manual = true;
  lastX = event.clientX;
  lastY = event.clientY;
  applyTransform();
});
function releasePointer(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 1) {
    const [rest] = pointers.values();
    lastX = rest.x;
    lastY = rest.y;
    return true;
  }
  return false;
}
window.addEventListener("pointercancel", (event) => {
  if (releasePointer(event)) return;
  dragging = false;
  viewport.classList.remove("dragging");
});
window.addEventListener("pointerup", (event) => {
  if (releasePointer(event)) return;
  if (event.button === 0 && !event.target.closest?.("#frame-menu")) closeFrameMenu();
  if (dragging && !moved && event.target === viewport) {
    deselect();
    closeNote();
    if (state.annotation) {
      state.annotation = null;
      renderAnnotations();
    }
  }
  dragging = false;
  viewport.classList.remove("dragging");
});
viewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    else {
      state.tx -= event.deltaX;
      state.ty -= event.deltaY;
      state.manual = true;
      applyTransform();
    }
  },
  { passive: false },
);

$("#zoom-in").addEventListener("click", () => zoomAt(1.25));
$("#zoom-out").addEventListener("click", () => zoomAt(0.8));
$("#zoom-fit").addEventListener("click", fit);
$("#shortcuts-open").addEventListener("click", () => palette.shortcuts());
$("#annotations-toggle").addEventListener("click", () => setAnnotationsShown(!state.showAnnotations));
state.showAnnotations = storageGet("screenbook.annotations") !== "hidden";
$("#theme").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#me").addEventListener("click", askName);
$("#ov-close").addEventListener("click", closeOverlay);
$("#reader-pill").addEventListener("click", () => openProposalReader(state.focus));
function zoomOverlayStep(factor) {
  if (!state.overlay || state.overlay.compare || state.overlay.commenting) return;
  const rect = $("#ov-stage").getBoundingClientRect();
  zoomOverlay(factor ? state.overlay.zoom * factor : 1, rect.left + rect.width / 2, rect.top + Math.min(rect.height, window.innerHeight - rect.top) / 2);
}
$("#ov-zoom-in").addEventListener("click", () => zoomOverlayStep(1.6));
$("#ov-zoom-out").addEventListener("click", () => zoomOverlayStep(1 / 1.6));
$("#ov-zoom-fit").addEventListener("click", () => zoomOverlayStep(0));
$("#ov-prev").addEventListener("click", () => stepReader(-1));
$("#ov-next").addEventListener("click", () => stepReader(1));
$("#ed-close").addEventListener("click", () => closeEditor());
$("#ed-discard").addEventListener("click", () => closeEditor());
$("#ed-save").addEventListener("click", saveEditor);
$("#ov-compare").addEventListener("click", () => {
  state.overlay.compare = !state.overlay.compare;
  if (!state.overlay.compare) state.overlay.compareWith = null;
  state.overlay.commenting = false;
  renderOverlay();
});
$("#ov-comment").addEventListener("click", () => {
  state.overlay.commenting = !state.overlay.commenting;
  if (state.overlay.commenting) {
    state.overlay.compare = false;
    state.overlay.panel = "talk";
  }
  renderOverlay();
});
document.querySelectorAll("#ov-tabs [data-panel]").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
$("#ov-play").addEventListener("click", () => startPresenting(state.overlay.screenId, state.overlay.version));
$("#ov-export").addEventListener("click", openExportMenu);

document.querySelectorAll("#tools [data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
document.querySelectorAll("#device-filter [data-device]").forEach((button) => button.addEventListener("click", () => setDevice(button.dataset.device)));

$("#all-proposals").addEventListener("click", () => focusOn(state.focus === "all" ? null : "all"));
$("#archived-toggle").addEventListener("click", () => {
  state.archivedOpen = !state.archivedOpen;
  renderArchived();
});
$("#archive-reason").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  $("#archive-dialog").close("archive");
});

function setSidebarCollapsed(collapsed, remember = true) {
  $("#sidebar").classList.toggle("collapsed", collapsed);
  $("#sidebar-toggle").setAttribute("aria-expanded", String(!collapsed));
  if (remember && !matchMedia("(max-width: 760px)").matches) storageSet("screenbook.sidebar", collapsed ? "collapsed" : "open");
  if (!state.manual) fit();
}
$("#sidebar-toggle").addEventListener("click", () => setSidebarCollapsed(!$("#sidebar").classList.contains("collapsed")));
setSidebarCollapsed(matchMedia("(max-width: 760px)").matches || storageGet("screenbook.sidebar") === "collapsed", false);
for (const button of document.querySelectorAll("#views button")) {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll("#views button").forEach((other) => other.classList.toggle("on", other === button));
    deselect();
    render();
    fit();
  });
}

$("#askbar").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#ask-input");
  const text = input.value.trim();
  if (!text || !state.selected) return;
  if (aiPanel) {
    input.value = "";
    aiPanel.toggle(true);
    aiPanel.ask(text);
    return;
  }
  const body = new RegExp(`@${HANDLE}\\b`, "i").test(text) ? text : `@${HANDLE} ${text}`;
  const sent = await sendComment({ screen: state.selected.screen.id, el: null, version: state.selected.version, text: body });
  if (!sent) return;
  input.value = "";
  toast(t("Sent to @{handle}. It reaches whichever chat is listening.", { handle: HANDLE }));
  renderPins();
});

document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea") || presenter.playing) return;
  if (event.key === "Escape") {
    if (!$("#frame-menu").hidden) closeFrameMenu();
    else if (document.querySelector(".export-menu")) closeExportMenu();
    else if (state.editor) closeEditor();
    else if (state.overlay && inspector.on && inspector.selected) inspector.clear();
    else if (state.overlay) closeOverlay();
    else if (state.note) closeNote();
    else if (state.annotation) {
      state.annotation = null;
      renderAnnotations();
    }
    else if (state.tool === "comment") setTool("move");
    else deselect();
  }
  if (state.overlay && !state.editor && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "i" || event.key === "I")) setPanel("inspect", true);
  if (state.overlay && !state.editor && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "h" || event.key === "H")) setPanel("history", true);
  if (board.active() && !state.overlay) return;
  if (!state.overlay && !state.editor && (event.key === "c" || event.key === "C")) setTool("comment");
  if (!state.overlay && !state.editor && (event.key === "v" || event.key === "V")) setTool("move");
  if (!shared && !state.overlay && !state.editor && (event.key === "e" || event.key === "E")) setTool("edit");
});

for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

new ResizeObserver(() => {
  if (!state.manual) fit();
}).observe(viewport);

window.addEventListener("resize", () => {
  placeInspector();
  if (state.overlay) renderOverlay();
});

applyTheme(storageGet("screenbook.theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
const me = await api(`${BASE}/api/me`).catch(() => ({}));
signedIn = me.user ?? null;
shared = me.share ?? null;
document.body.classList.toggle("shared", Boolean(shared));
renderMe();
tabs.start();
await refresh(true);
const focusProposal = shared?.proposal ?? new URLSearchParams(location.search).get("proposal");
const nothingOfficial = !state.data.screens.some((screen) => screen.official);
if (!focusProposal && nothingOfficial && openProposals().length) focusOn("all");
if (focusProposal) {
  const linked = proposalById(focusProposal);
  if (linked && readerItemsOfProposal(linked).length) {
    focusOn(focusProposal, viewport.clientWidth > 900 ? 320 : 0);
    const first = placedOfProposal(linked).find((entry) => entry.item.kind === "proposal") ?? placedOfProposal(linked)[0];
    if (phone() && !location.hash) openProposalReader(focusProposal);
    else if (first) select(first.item);
    if (isClosed(linked)) toast(t("{label}: this proposal opens read-only, with the versions it pinned.", { label: closedLabel(linked) }));
  } else if (!shared) {
    toast(linked ? t("This proposal has no screens here.") : t("This proposal doesn't exist here."));
  }
}
live = shared ? null : startLive({
  base: BASE,
  state,
  viewport,
  people: $("#people"),
  myName,
  screenName: (id, fallback) => screenById(id)?.name ?? fallback ?? id,
  onAgentDrew: agentDrew,
  pieceBox: (screen, version, el) => {
    const key = `${screen}/v${version}`;
    if (!(key in state.boxes)) {
      loadBoxes(screen, version);
      return null;
    }
    return state.boxes[key]?.[el] ?? null;
  },
  applyView: () => {
    applyTransform();
  },
  onFollowLook: (screenId, version) => {
    if (!screenId) return state.overlay && closeOverlay();
    if (state.overlay?.screenId === screenId && state.overlay.version === version) return;
    const screen = screenById(screenId);
    if (screen && versionEntry(screen, version)) openOverlay(screenId, version);
  },
});
if (live) {
  live.listen("board", board.received);
  live.listen("board-preview", board.previewed);
  live.listen("snapshot", board.reconnected);
}
if (me.ai && !shared) {
  aiPanel = startAi({
    base: BASE,
    state,
    refresh,
    toast,
    showProposal: (id) => {
      if (!id || state.focus === id || state.focus === "all" || state.overlay) return;
      state.focus = id;
      render();
    },
  });
}
if (aiPanel && state.selected) $("#ask-input").placeholder = t("Ask the AI about screen {number}…", { number: state.selected.screen.number });
function openFromHash() {
  const deep = location.hash.match(/^#([\w-]+)\/v(\d+)$/);
  if (!deep || !screenById(deep[1])) {
    if (state.overlay) closeOverlay();
    return;
  }
  const screen = screenById(deep[1]);
  const inProposal = focusProposal ? state.data.proposals.find((proposal) => proposal.id === focusProposal)?.screens[screen.id] : null;
  const version = inProposal && proposalOfVersion(screen.id, Number(deep[2]))?.id !== focusProposal ? inProposal : Number(deep[2]);
  if (!versionEntry(screen, version)) return;
  if (state.overlay?.screenId === screen.id && state.overlay.version === version) return;
  openOverlay(screen.id, version);
}
window.addEventListener("hashchange", openFromHash);
openFromHash();
setInterval(() => refresh().catch(() => {}), POLL_MS);
