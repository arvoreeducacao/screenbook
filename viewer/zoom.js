import { openMenu } from "./menu.js";
import { t } from "./i18n.js";

const MAP_KEY = "screenbook.minimap";
const MAP_WIDTH = 196;
const MAP_HEIGHT = 128;

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function boundsOf(boxes) {
  if (!boxes.length) return null;
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

export function createZoom({ state, viewport, menu, closeMenu, pct, fit, zoomAt, zoomTo, applyTransform }) {
  const map = document.createElement("canvas");
  map.className = "fl minimap";
  map.width = MAP_WIDTH * devicePixelRatio;
  map.height = MAP_HEIGHT * devicePixelRatio;
  map.style.width = `${MAP_WIDTH}px`;
  map.style.height = `${MAP_HEIGHT}px`;
  map.setAttribute("aria-label", t("Minimap"));
  document.body.appendChild(map);
  let mapOn = read(MAP_KEY) !== "off";
  let frame = 0;
  let projection = null;

  function placedBoxes() {
    return state.placed.map((entry) => ({ left: entry.x, top: entry.y - 26, right: entry.x + entry.width, bottom: entry.y + entry.height, kind: entry.item.kind, selected: entry.item === state.selected }));
  }

  function worldBounds() {
    if (state.view === "canvas" && state.sections.length) return boundsOf(state.sections.map((section) => section.box));
    return boundsOf(placedBoxes());
  }

  function selectedPlaced() {
    if (!state.selected) return null;
    return state.placed.find((entry) => entry.item.screen.id === state.selected.screen.id && entry.item.version === state.selected.version) ?? null;
  }

  function fitSelection() {
    const placed = selectedPlaced();
    if (!placed) return fit();
    zoomTo({ left: placed.x - 24, top: placed.y - 50, right: placed.x + placed.width + 24, bottom: placed.y + placed.height + 24 }, 0, 4);
  }

  function zoomTo100() {
    zoomAt(1 / state.scale);
  }

  function zoomToPct(value) {
    zoomAt(value / state.scale);
  }

  function color(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
  }

  function draw() {
    frame = 0;
    const show = mapOn && state.placed.length > 0 && !state.overlay;
    map.hidden = !show;
    if (!show) return;
    const bounds = worldBounds();
    if (!bounds) return;
    const pad = 8;
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const scale = Math.min((MAP_WIDTH - 2 * pad) / width, (MAP_HEIGHT - 2 * pad) / height);
    const offsetX = pad + (MAP_WIDTH - 2 * pad - width * scale) / 2 - bounds.left * scale;
    const offsetY = pad + (MAP_HEIGHT - 2 * pad - height * scale) / 2 - bounds.top * scale;
    projection = { scale, offsetX, offsetY };
    const context = map.getContext("2d");
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    const rect = (box) => [box.left * scale + offsetX, box.top * scale + offsetY, Math.max(1, (box.right - box.left) * scale), Math.max(1, (box.bottom - box.top) * scale)];
    context.fillStyle = color("--sunk");
    for (const section of state.view === "canvas" ? state.sections : []) context.fillRect(...rect(section.box));
    for (const box of placedBoxes()) {
      context.fillStyle = box.selected ? color("--prop") : box.kind === "official" ? color("--line-strong") : color("--prop-soft");
      context.fillRect(...rect(box));
    }
    const view = {
      left: -state.tx / state.scale,
      top: -state.ty / state.scale,
      right: (viewport.clientWidth - state.tx) / state.scale,
      bottom: (viewport.clientHeight - state.ty) / state.scale,
    };
    const [x, y, w, h] = rect(view);
    context.strokeStyle = color("--prop");
    context.lineWidth = 1.5;
    context.fillStyle = "rgba(78, 111, 255, 0.08)";
    context.fillRect(x, y, w, h);
    context.strokeRect(x, y, w, h);
  }

  function update() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function panTo(event) {
    if (!projection) return;
    const box = map.getBoundingClientRect();
    const worldX = (event.clientX - box.left - projection.offsetX) / projection.scale;
    const worldY = (event.clientY - box.top - projection.offsetY) / projection.scale;
    state.tx = viewport.clientWidth / 2 - worldX * state.scale;
    state.ty = viewport.clientHeight / 2 - worldY * state.scale;
    state.manual = true;
    applyTransform();
  }

  map.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    map.setPointerCapture(event.pointerId);
    panTo(event);
  });
  map.addEventListener("pointermove", (event) => {
    if (map.hasPointerCapture(event.pointerId)) panTo(event);
  });
  map.addEventListener("wheel", (event) => event.preventDefault(), { passive: false });

  function setMinimap(on) {
    mapOn = on;
    write(MAP_KEY, on ? "on" : "off");
    update();
  }

  function zoomMenu(event) {
    openMenu({
      menu,
      close: closeMenu,
      event,
      anchor: pct.closest(".zoom").getBoundingClientRect(),
      entries: [
        { label: t("Zoom in"), keys: "Mod++", run: () => zoomAt(1.25) },
        { label: t("Zoom out"), keys: "Mod+-", run: () => zoomAt(0.8) },
        null,
        { label: t("Fit all"), keys: "Shift+1", run: fit },
        { label: t("Fit to selection"), keys: "Shift+2", disabled: !state.selected, run: fitSelection },
        null,
        { label: "50%", run: () => zoomToPct(0.5) },
        { label: "100%", keys: "Shift+0", run: zoomTo100 },
        { label: "200%", run: () => zoomToPct(2) },
        null,
        { label: mapOn ? t("Hide minimap") : t("Show minimap"), run: () => setMinimap(!mapOn) },
      ],
    });
  }

  pct.setAttribute("role", "button");
  pct.tabIndex = 0;
  pct.title = t("Zoom options");
  pct.addEventListener("click", (event) => zoomMenu(event));
  pct.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") zoomMenu(event);
  });

  return { update, fitSelection, zoomTo100, zoomToPct, toggleMinimap: () => setMinimap(!mapOn), minimapOn: () => mapOn };
}
