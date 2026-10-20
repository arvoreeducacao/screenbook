import { escapeHtml, openMenu } from "./menu.js";
import { t } from "./i18n.js";

const WIDTH = 240;
const COLORS = [
  ["yellow", "Yellow"],
  ["pink", "Pink"],
  ["green", "Green"],
  ["blue", "Blue"],
];

export function stickyPlace(sticky, sections) {
  if (!sticky.section) return { x: sticky.x, y: sticky.y };
  const section = sections.find((entry) => entry.id === sticky.section);
  return section ? { x: section.box.left + sticky.x, y: section.box.top + sticky.y } : null;
}

export function stickyAnchor(point, sections) {
  const section = sections.find((entry) => entry.id && point.x >= entry.box.left && point.x <= entry.box.right && point.y >= entry.box.top && point.y <= entry.box.bottom);
  return section ? { section: section.id, x: point.x - section.box.left, y: point.y - section.box.top } : { section: null, x: point.x, y: point.y };
}

export function createStickies({ state, world, viewport, tabs, base, post, ensureName, refresh, toast, readOnly, setTool, menu, closeMenu }) {
  let editing = null;
  let dragging = null;
  let pressed = null;

  const toWorld = (clientX, clientY) => ({ x: (clientX - state.tx) / state.scale, y: (clientY - state.ty) / state.scale });

  function visible(sticky) {
    if (sticky.section) return tabs.visible(sticky.section) && state.sections.some((entry) => entry.id === sticky.section);
    return (sticky.page ?? tabs.pages()[0].id) === tabs.current().id;
  }

  async function save(path, body) {
    const by = await ensureName();
    if (!by) return null;
    try {
      const result = await post(`${base}${path}`, { ...body, by });
      await refresh(true);
      return result;
    } catch (error) {
      toast(t("Could not do it: {error}", { error: error.message }));
      return null;
    }
  }

  function element(sticky) {
    const place = stickyPlace(sticky, state.sections);
    const node = document.createElement("div");
    node.className = `sticky ${sticky.color ?? "yellow"}`;
    node.dataset.sticky = sticky.id;
    node.style.left = `${place.x}px`;
    node.style.top = `${place.y}px`;
    node.style.width = `${WIDTH}px`;
    const text = sticky.text.trim() ? escapeHtml(sticky.text) : `<span class="sticky-empty">${escapeHtml(t("Empty note"))}</span>`;
    node.innerHTML = `<div class="sticky-text">${text}</div><div class="sticky-by">${escapeHtml(sticky.editedBy ?? sticky.by ?? "")}</div>`;
    if (readOnly()) return node;
    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || editing === sticky.id) return;
      event.stopPropagation();
      const start = toWorld(event.clientX, event.clientY);
      dragging = { id: sticky.id, node, start, origin: { ...place }, moved: false };
      node.setPointerCapture(event.pointerId);
    });
    node.addEventListener("pointermove", (event) => {
      if (!dragging || dragging.id !== sticky.id) return;
      const point = toWorld(event.clientX, event.clientY);
      const dx = point.x - dragging.start.x;
      const dy = point.y - dragging.start.y;
      if (!dragging.moved && Math.hypot(dx, dy) * state.scale < 3) return;
      dragging.moved = true;
      node.classList.add("lifted");
      node.style.left = `${dragging.origin.x + dx}px`;
      node.style.top = `${dragging.origin.y + dy}px`;
    });
    node.addEventListener("pointerup", (event) => {
      if (!dragging || dragging.id !== sticky.id) return;
      event.stopPropagation();
      const done = dragging;
      dragging = null;
      node.classList.remove("lifted");
      if (!done.moved) return;
      const anchor = stickyAnchor({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) }, state.sections);
      save(`/api/stickies/${sticky.id}`, { ...anchor, page: tabs.current().id });
    });
    node.addEventListener("click", (event) => event.stopPropagation());
    node.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      edit(sticky.id);
    });
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu({
        menu,
        close: closeMenu,
        event,
        title: t("Note"),
        entries: [
          { label: t("Edit text"), run: () => edit(sticky.id) },
          null,
          ...COLORS.map(([color, label]) => ({ label: t(label), on: sticky.color === color, run: () => save(`/api/stickies/${sticky.id}`, { color }) })),
          null,
          { label: t("Delete note"), run: () => save(`/api/stickies/${sticky.id}/delete`, {}) },
        ],
      });
    });
    return node;
  }

  function edit(id) {
    const node = world.querySelector(`[data-sticky="${CSS.escape(id)}"]`);
    const sticky = (state.data?.stickies ?? []).find((entry) => entry.id === id);
    if (!node || !sticky) return;
    editing = id;
    const area = document.createElement("textarea");
    area.className = "sticky-input";
    area.value = sticky.text;
    area.maxLength = 2000;
    area.placeholder = t("Write the note");
    node.querySelector(".sticky-text").replaceWith(area);
    node.classList.add("editing");
    area.addEventListener("pointerdown", (event) => event.stopPropagation());
    area.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) area.blur();
    });
    area.addEventListener("blur", async () => {
      editing = null;
      if (area.value !== sticky.text) await save(`/api/stickies/${id}`, { text: area.value });
      else render();
    });
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function render() {
    if (editing || dragging) return;
    world.querySelectorAll(".sticky").forEach((node) => node.remove());
    if (!state.data || state.view !== "canvas") return;
    for (const sticky of state.data.stickies ?? []) {
      if (visible(sticky) && stickyPlace(sticky, state.sections)) world.appendChild(element(sticky));
    }
  }

  async function create(event) {
    const point = toWorld(event.clientX, event.clientY);
    setTool("move");
    const made = await save("/api/stickies", { ...stickyAnchor({ x: point.x - 20, y: point.y - 20 }, state.sections), page: tabs.current().id, text: "" });
    if (made) edit(made.id);
  }

  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (state.tool === "sticky") pressed = { x: event.clientX, y: event.clientY };
    },
    true,
  );
  viewport.addEventListener(
    "click",
    (event) => {
      if (state.tool !== "sticky" || readOnly() || state.view !== "canvas") return;
      if (event.target.closest(".sticky")) return;
      if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4) return;
      event.preventDefault();
      event.stopPropagation();
      create(event);
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.tool === "sticky") setTool("move");
  });

  return { render, isEditing: () => Boolean(editing) };
}
