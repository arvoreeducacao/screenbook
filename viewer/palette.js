import { escapeHtml, keyLabel } from "./menu.js";
import { matchesScreen } from "./layers.js";
import { t } from "./i18n.js";

const LIMIT = 60;

const SHORTCUTS = [
  ["Navigate", [
    ["Mod+K", "Search screens, sections, proposals or actions"],
    ["Mod+F", "Search the layers"],
    ["PageUp / PageDown", "Previous or next page"],
    ["Esc", "Close or clear the selection"],
  ]],
  ["Zoom", [
    ["Shift+1", "Fit all"],
    ["Shift+2", "Fit selection"],
    ["Shift+0", "Zoom to 100%"],
    ["Mod++ / Mod+-", "Zoom in or out"],
    ["Mod + scroll", "Zoom at the mouse"],
  ]],
  ["Tools", [
    ["V", "Move"],
    ["C", "Comment"],
    ["N", "Sticky note: click the canvas"],
    ["E", "Edit pieces"],
    ["I", "Open or close the AI"],
    ["Double-click", "Open the screen at full size"],
  ]],
  ["With a screen open", [
    ["I", "Inspect: sizes, colors and code"],
    ["Alt", "Measure the distance to another piece"],
    ["H", "Version history"],
  ]],
  ["Presenting", [
    ["Click", "Follow the linked piece"],
    ["← / R", "Go back or start over"],
    ["Esc", "Exit"],
  ]],
  ["Help", [["?", "This list of shortcuts"]]],
];

function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function rankItems(items, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((item) => !item.searchOnly);
  const scored = [];
  for (const item of items) {
    const label = fold(item.label);
    const haystack = item.screen ? null : `${label} ${fold(item.hint)} ${fold(item.group)}`;
    const hit = item.screen ? matchesScreen(item.screen, query) : words.every((word) => haystack.includes(word));
    if (!hit) continue;
    const score = (label.startsWith(words[0]) ? 0 : label.includes(` ${words[0]}`) ? 1 : 2) + (item.rank ?? 0);
    scored.push({ item, score });
  }
  return scored.sort((first, second) => first.score - second.score).map((entry) => entry.item);
}

export function createPalette({ state, tabs, layers, zoom, commands, focusProposal, fit, zoomAt }) {
  const back = document.createElement("div");
  back.className = "palette-back";
  back.hidden = true;
  back.innerHTML = `<div class="fl palette" role="dialog" aria-label="${escapeHtml(t("Go to"))}"><label class="palette-input"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("Go to a screen, section, proposal, page or action…"))}" aria-label="${escapeHtml(t("Search"))}"></label><div class="palette-list" role="listbox"></div><div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${escapeHtml(t("choose"))}</span><span><kbd>Enter</kbd> ${escapeHtml(t("open"))}</span><span><kbd>Esc</kbd> ${escapeHtml(t("close"))}</span></div></div>`;
  document.body.appendChild(back);
  const input = back.querySelector("input");
  const list = back.querySelector(".palette-list");
  let shown = [];
  let active = 0;

  const sheet = document.createElement("dialog");
  sheet.className = "shortcuts";
  sheet.innerHTML = `<div class="sc-head"><h2>${escapeHtml(t("Shortcuts"))}</h2><button class="icon-btn" value="close" aria-label="${escapeHtml(t("Close"))}">✕</button></div><div class="sc-grid">${SHORTCUTS.map(
    ([group, rows]) =>
      `<section><h3>${escapeHtml(t(group))}</h3>${rows
        .map(([keys, label]) => `<div class="sc-row"><span>${escapeHtml(t(label))}</span><span class="sc-keys">${keys.split(" / ").map((key) => `<kbd>${escapeHtml(keyLabel(t(key)))}</kbd>`).join("<i>/</i>")}</span></div>`)
        .join("")}</section>`,
  ).join("")}</div>`;
  document.body.appendChild(sheet);
  sheet.querySelector("[value=close]").addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.close();
  });

  function items() {
    const { data } = state;
    const result = [];
    const here = tabs.current().id;
    result.push(...commands().map((action) => ({ ...action, group: t("Actions") })));
    tabs.pages().forEach((page) =>
      result.push({ group: t("Pages"), label: page.name, hint: page.id === here ? t("current page") : t(page.sections.length === 1 ? "{n} section" : "{n} sections", { n: page.sections.length }), run: () => tabs.go(page.id) }),
    );
    data.proposals
      .filter((proposal) => proposal.status === "open")
      .forEach((proposal) =>
        result.push({ group: t("Proposals"), label: proposal.title, hint: t("{n} screens", { n: Object.keys(proposal.screens).length }), run: () => focusProposal(proposal.id), rank: 1 }),
      );
    data.project.sections.forEach((section) => {
      const count = data.screens.filter((screen) => screen.section === section.id).length;
      if (count) result.push({ group: t("Sections"), label: section.name, hint: t(count === 1 ? "{n} screen" : "{n} screens", { n: count }), run: () => layers.revealSection(section.id), rank: 1 });
    });
    data.screens.forEach((screen) =>
      result.push({ group: t("Screens"), label: screen.name, number: screen.number, kind: screen.official ? "live" : "prop", hint: screen.route ?? "", screen, searchOnly: true, run: () => layers.reveal(screen.id), rank: 2 }),
    );
    tabs.products().forEach((product) => result.push({ group: t("Products"), label: product.name, hint: product.id === tabs.product ? t("current product") : "", searchOnly: true, run: () => tabs.switchProduct(product.id), rank: 3 }));
    return result;
  }

  function draw() {
    shown = rankItems(items(), input.value).slice(0, LIMIT);
    active = Math.min(active, Math.max(0, shown.length - 1));
    if (!shown.length) {
      list.innerHTML = `<p class="palette-empty">${escapeHtml(t("Nothing by that name."))}</p>`;
      return;
    }
    let group = null;
    list.innerHTML = shown
      .map((item, index) => {
        const head = item.group !== group ? `<div class="palette-group">${escapeHtml((group = item.group))}</div>` : "";
        const badge = item.number ? `<span class="num ${item.kind}">${item.number}</span>` : "";
        return `${head}<button class="palette-item${index === active ? " on" : ""}" role="option" aria-selected="${index === active}" data-index="${index}">${badge}<span class="palette-label">${escapeHtml(item.label)}</span>${
          item.hint ? `<span class="palette-hint">${escapeHtml(item.hint)}</span>` : ""
        }${item.keys ? `<kbd>${escapeHtml(keyLabel(item.keys))}</kbd>` : ""}</button>`;
      })
      .join("");
    list.querySelectorAll("[data-index]").forEach((button) => {
      button.addEventListener("mousemove", () => {
        if (active === Number(button.dataset.index)) return;
        active = Number(button.dataset.index);
        list.querySelectorAll(".palette-item").forEach((other) => other.classList.toggle("on", other === button));
      });
      button.addEventListener("click", () => pick(Number(button.dataset.index)));
    });
    list.querySelector(".palette-item.on")?.scrollIntoView({ block: "nearest" });
  }

  function open() {
    if (!state.data) return;
    back.hidden = false;
    input.value = "";
    active = 0;
    draw();
    input.focus();
  }

  function close() {
    back.hidden = true;
  }

  function pick(index) {
    const item = shown[index];
    if (!item) return;
    close();
    item.run();
  }

  input.addEventListener("input", () => {
    active = 0;
    draw();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      draw();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  back.addEventListener("pointerdown", (event) => {
    if (event.target === back) close();
  });

  function stepPage(delta) {
    const pages = tabs.pages();
    const at = pages.findIndex((page) => page.id === tabs.current().id);
    const next = pages[at + delta];
    if (next) tabs.go(next.id);
  }

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "k") {
      event.preventDefault();
      if (back.hidden) open();
      else close();
      return;
    }
    if (!back.hidden || sheet.open) return;
    const busy = state.overlay || state.editor;
    if (mod && key === "f" && !busy) {
      event.preventDefault();
      layers.focusSearch();
      return;
    }
    if (event.target.closest?.("input, textarea, select, [contenteditable]") || busy) return;
    if (event.shiftKey && !mod && event.code === "Digit1") return fit();
    if (event.shiftKey && !mod && event.code === "Digit2") return zoom.fitSelection();
    if ((event.shiftKey || mod) && event.code === "Digit0") {
      event.preventDefault();
      return zoom.zoomTo100();
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      return zoomAt(1.25);
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      return zoomAt(0.8);
    }
    if (event.key === "?") return sheet.showModal();
    if (key === "n" && !mod && !event.shiftKey && !document.body.classList.contains("shared") && !document.body.classList.contains("board-on")) return document.querySelector('#tools [data-tool="sticky"]')?.click();
    if (event.key === "PageDown") return stepPage(1);
    if (event.key === "PageUp") return stepPage(-1);
  });

  return { open, close, shortcuts: () => sheet.showModal() };
}
