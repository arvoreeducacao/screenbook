import { t } from "./i18n.js";

const KEY = "screenbook.proposals-open";

function remembered() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function remember(open) {
  try {
    localStorage.setItem(KEY, open ? "1" : "0");
  } catch {}
}

const group = document.querySelector("#proposals-group");
const fold = document.querySelector("#proposals-fold");
const list = document.querySelector("#proposal-list");
const count = document.querySelector("#proposals-count");

function setOpen(open) {
  group.classList.toggle("folded-open", open);
  fold.setAttribute("aria-expanded", String(open));
}

function recount() {
  const total = list.querySelectorAll(".sb-item.proposal, .sb-item").length;
  count.textContent = total ? String(total) : "";
}

if (group && fold && list) {
  setOpen(remembered());
  fold.setAttribute("role", "button");
  fold.tabIndex = 0;
  fold.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const open = !group.classList.contains("folded-open");
    setOpen(open);
    remember(open);
  });
  fold.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fold.click();
    }
  });
  new MutationObserver(recount).observe(list, { childList: true, subtree: true });
  recount();
}

const root = document.documentElement;
const LIMITS = { left: [200, 420], right: [260, 560] };

function storedWidth(side) {
  try {
    const value = Number(localStorage.getItem(`screenbook.width.${side}`));
    return Number.isFinite(value) && value >= LIMITS[side][0] && value <= LIMITS[side][1] ? value : null;
  } catch {
    return null;
  }
}

function setWidth(side, value, keep = false) {
  const [low, high] = LIMITS[side];
  const width = Math.round(Math.min(high, Math.max(low, value)));
  root.style.setProperty(side === "left" ? "--left" : "--right", `${width}px`);
  if (keep) {
    try {
      localStorage.setItem(`screenbook.width.${side}`, String(width));
    } catch {}
  }
  window.dispatchEvent(new Event("resize"));
}

for (const side of ["left", "right"]) {
  const saved = storedWidth(side);
  if (saved) setWidth(side, saved);
}

function handle(side) {
  const grip = document.createElement("div");
  grip.className = `panel-grip ${side}`;
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "vertical");
  grip.title = t("Drag to resize · double-click to reset");
  document.body.appendChild(grip);
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    let last = null;
    const move = (moved) => {
      last = side === "left" ? moved.clientX : window.innerWidth - moved.clientX;
      setWidth(side, last);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      document.body.classList.remove("resizing");
      if (last !== null) setWidth(side, last, true);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });
  grip.addEventListener("dblclick", () => {
    root.style.removeProperty(side === "left" ? "--left" : "--right");
    try {
      localStorage.removeItem(`screenbook.width.${side}`);
    } catch {}
    window.dispatchEvent(new Event("resize"));
  });
}

handle("left");
handle("right");

const sidebar = document.querySelector("#sidebar");
const leftToggle = document.querySelector("#left-toggle");

function syncLeft() {
  const open = !sidebar.classList.contains("collapsed");
  leftToggle?.setAttribute("aria-pressed", String(open));
  document.body.classList.toggle("left-closed", !open);
  window.dispatchEvent(new Event("resize"));
}

leftToggle?.addEventListener("click", () => document.querySelector("#sidebar-toggle")?.click());
new MutationObserver(syncLeft).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
syncLeft();

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "\\") {
    event.preventDefault();
    document.querySelector("#sidebar-toggle")?.click();
  }
});
