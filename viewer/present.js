import { t } from "./i18n.js";

export function playVersion(screen, proposal) {
  if (!screen) return null;
  const pinned = proposal?.screens?.[screen.id];
  if (pinned && screen.versions.some((entry) => entry.v === pinned)) return pinned;
  return screen.official ?? screen.versions.at(-1)?.v ?? null;
}

export function outgoing(flows, screens, from) {
  const known = new Set(screens.map((screen) => screen.id));
  const links = (flows ?? []).filter((flow) => flow.from === from && known.has(flow.to) && flow.to !== from);
  const hotspots = new Map();
  const loose = [];
  for (const flow of links) {
    if (flow.el) {
      if (!hotspots.has(flow.el)) hotspots.set(flow.el, flow);
    } else if (!loose.some((item) => item.to === flow.to)) loose.push(flow);
  }
  return { hotspots, loose };
}

export function deviceOf(width) {
  if (width <= 520) return "phone";
  if (width <= 1024) return "tablet";
  return "desktop";
}

export function viewHeight(entry) {
  const device = deviceOf(entry.width);
  const natural = device === "phone" ? Math.round(entry.width * 2.165) : device === "tablet" ? Math.round(entry.width * 1.33) : Math.round(entry.width * 0.625);
  return Math.min(entry.height, Math.max(natural, Math.min(entry.height, 480)));
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  hint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5a3 3 0 0 1 6 0v6"/><path d="M5 13a7 7 0 0 0 14 0v-2H5z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

export function createPresenter({ data, frameUrl, escapeHtml, onClose }) {
  let root = null;
  let session = null;

  function screenById(id) {
    return data().screens.find((screen) => screen.id === id) ?? null;
  }

  function build() {
    root = document.createElement("div");
    root.className = "play";
    root.innerHTML = `<div class="play-stage"></div>
      <div class="play-bar" role="toolbar" aria-label="${t("Presentation")}">
        <button type="button" class="play-btn" data-play="back" title="${t("Back (←)")}" aria-label="${t("Back")}">${ICONS.back}</button>
        <button type="button" class="play-btn" data-play="restart" title="${t("Restart (R)")}" aria-label="${t("Restart")}">${ICONS.restart}</button>
        <div class="play-where"><b class="play-name"></b><span class="play-count"></span></div>
        <div class="play-loose"></div>
        <span class="play-seg" role="group" aria-label="${t("Frame")}"><button type="button" data-frame="auto">${t("Frame")}</button><button type="button" data-frame="none">${t("No frame")}</button></span>
        <button type="button" class="play-btn" data-play="hint" title="${t("Show where you can click")}" aria-label="${t("Show where you can click")}">${ICONS.hint}</button>
        <button type="button" class="play-btn" data-play="full" title="${t("Full screen (F)")}" aria-label="${t("Full screen")}">${ICONS.expand}</button>
        <button type="button" class="play-btn" data-play="close" title="${t("Exit (Esc)")}" aria-label="${t("Exit")}">${ICONS.close}</button>
      </div>
      <p class="play-tip">${t("Click the linked pieces to navigate · <kbd>Esc</kbd> exits")}</p>`;
    document.body.appendChild(root);
    root.querySelector('[data-play="back"]').addEventListener("click", back);
    root.querySelector('[data-play="restart"]').addEventListener("click", restart);
    root.querySelector('[data-play="close"]').addEventListener("click", stop);
    root.querySelector('[data-play="hint"]').addEventListener("click", () => current()?.contentWindow?.postMessage({ type: "sb-play-flash" }, "*"));
    root.querySelector('[data-play="full"]').addEventListener("click", toggleFull);
    root.querySelectorAll("[data-frame]").forEach((button) =>
      button.addEventListener("click", () => {
        session.frame = button.dataset.frame;
        layout(true);
      }),
    );
    let idle = null;
    root.addEventListener("pointermove", () => {
      root.classList.remove("idle");
      clearTimeout(idle);
      idle = setTimeout(() => root?.classList.add("idle"), 2400);
    });
  }

  function current() {
    return root?.querySelector(".play-screen.in iframe") ?? null;
  }

  function sizeOf(entry) {
    const device = session.frame === "none" ? "none" : deviceOf(entry.width);
    const view = viewHeight(entry);
    const chrome = device === "phone" ? { x: 14, top: 14, bottom: 14 } : device === "tablet" ? { x: 18, top: 18, bottom: 18 } : device === "desktop" ? { x: 0, top: 34, bottom: 0 } : { x: 0, top: 0, bottom: 0 };
    const outerW = entry.width + chrome.x * 2;
    const outerH = view + chrome.top + chrome.bottom;
    const room = { w: window.innerWidth - 48, h: window.innerHeight - 120 };
    const scale = Math.min(1, room.w / outerW, room.h / outerH);
    return { device, view, chrome, scale, outerW, outerH };
  }

  function slide(screen, version, direction) {
    const entry = screen.versions.find((item) => item.v === version);
    const size = sizeOf(entry);
    const stage = root.querySelector(".play-stage");
    const holder = document.createElement("div");
    holder.className = `play-screen device-${size.device}`;
    holder.style.width = `${size.outerW}px`;
    holder.style.height = `${size.outerH}px`;
    holder.style.setProperty("--scale", size.scale);
    holder.innerHTML = `${size.device === "desktop" ? `<div class="play-chrome"><i></i><i></i><i></i><span>${escapeHtml(screen.route ?? screen.name)}</span></div>` : ""}<div class="play-view" style="left:${size.chrome.x}px;top:${size.chrome.top}px;width:${entry.width}px;height:${size.view}px"><iframe src="${frameUrl(screen.id, version)}" style="width:${entry.width}px;height:${entry.height}px" tabindex="0"></iframe></div>`;
    const old = stage.querySelector(".play-screen.in");
    holder.classList.add(direction ? (direction > 0 ? "from-right" : "from-left") : "fade");
    stage.appendChild(holder);
    const iframe = holder.querySelector("iframe");
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      requestAnimationFrame(() => {
        holder.classList.add("in");
        holder.classList.remove("from-right", "from-left", "fade");
        if (old) {
          old.classList.remove("in");
          old.classList.add(direction > 0 ? "to-left" : direction < 0 ? "to-right" : "fade-out");
          setTimeout(() => old.remove(), 360);
        }
        iframe.focus({ preventScroll: true });
      });
    };
    holder.dataset.screen = screen.id;
    holder.show = show;
    setTimeout(show, 900);
  }

  function go(screenId, direction = 1, record = true) {
    const screen = screenById(screenId);
    const version = playVersion(screen, session.proposal);
    if (!screen || !version) return;
    if (record && session.at) session.trail.push(session.at);
    session.at = screenId;
    const { hotspots, loose } = outgoing(data().flows, data().screens, screenId);
    session.hotspots = hotspots;
    root.querySelector(".play-name").textContent = screen.name;
    root.querySelector(".play-count").textContent = hotspots.size + loose.length ? t(hotspots.size + loose.length === 1 ? "{n} path" : "{n} paths", { n: hotspots.size + loose.length }) : t("end of the flow");
    root.querySelector('[data-play="back"]').disabled = !session.trail.length;
    root.querySelector(".play-loose").innerHTML = loose
      .map((flow) => `<button type="button" class="play-chip" data-to="${escapeHtml(flow.to)}">${escapeHtml(flow.label || screenById(flow.to)?.name || flow.to)} →</button>`)
      .join("");
    root.querySelectorAll(".play-chip").forEach((chip) => chip.addEventListener("click", () => go(chip.dataset.to, 1)));
    slide(screen, version, direction);
  }

  function back() {
    if (!session?.trail.length) return;
    go(session.trail.pop(), -1, false);
  }

  function restart() {
    if (!session) return;
    session.trail = [];
    go(session.start, -1, false);
  }

  function layout(reload = false) {
    if (!session) return;
    root.querySelectorAll("[data-frame]").forEach((button) => button.classList.toggle("on", button.dataset.frame === session.frame));
    if (reload) {
      const at = session.at;
      root.querySelector(".play-stage").innerHTML = "";
      go(at, 0, false);
    }
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else root.requestFullscreen?.().catch(() => {});
  }

  function onMessage(event) {
    if (!session) return;
    const holder = [...root.querySelectorAll(".play-screen")].find((item) => item.querySelector("iframe")?.contentWindow === event.source);
    if (!holder) return;
    const message = event.data ?? {};
    if (message.type === "sb-ready") {
      const hotspots = holder.dataset.screen === session.at ? [...session.hotspots.keys()] : [];
      event.source.postMessage({ type: "sb-play", on: true, hotspots, flash: !session.flashed }, "*");
      session.flashed = true;
      holder.show?.();
    }
    if (!holder.classList.contains("in")) return;
    if (message.type === "sb-play-go" && typeof message.el === "string") {
      const flow = session.hotspots.get(message.el);
      if (flow) go(flow.to, 1);
    }
    if (message.type === "sb-key") key(message.key);
  }

  function key(name) {
    if (name === "Escape") stop();
    if (name === "ArrowLeft" || name === "Backspace") back();
    if (name === "r" || name === "R") restart();
    if (name === "f" || name === "F") toggleFull();
  }

  function onKey(event) {
    if (!session) return;
    if (["Escape", "ArrowLeft", "Backspace", "r", "R", "f", "F"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      key(event.key);
    }
  }

  function onResize() {
    if (!session) return;
    const holder = root.querySelector(".play-screen.in");
    const screen = holder && screenById(holder.dataset.screen);
    if (!screen) return;
    const size = sizeOf(screen.versions.find((item) => item.v === playVersion(screen, session.proposal)));
    holder.style.setProperty("--scale", size.scale);
  }

  function start(screenId, { proposal = null } = {}) {
    if (!screenById(screenId)) return;
    if (!root) build();
    root.hidden = false;
    root.classList.remove("idle");
    session = { start: screenId, at: null, trail: [], proposal, frame: "auto", hotspots: new Map(), flashed: false };
    root.querySelector(".play-stage").innerHTML = "";
    layout();
    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    go(screenId, 0, false);
  }

  function stop() {
    if (!session) return;
    session = null;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    root.hidden = true;
    root.querySelector(".play-stage").innerHTML = "";
    onClose?.();
  }

  return {
    start,
    stop,
    get playing() {
      return Boolean(session);
    },
  };
}
