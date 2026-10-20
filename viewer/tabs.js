import { escapeHtml, openMenu } from "./menu.js";
import { isBoard, onPage, pageOfSection, pagesOf } from "./pages.js";
import { t } from "./i18n.js";

const OPEN_KEY = "screenbook.tabs";
const BOARD_MARK = '<svg class="page-tab-mark" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 3h10v6l-4 4H3z" stroke-linejoin="round"/><path d="M9 13V9h4" stroke-linejoin="round"/></svg>';

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

export function createTabs({ base, state, bar, menu, closeMenu, api, post, ensureName, refresh, toast, readOnly, onChange }) {
  const product = base.replace(/^\//, "");
  const pageKey = `screenbook.page.${product || "_"}`;
  let products = null;
  let renaming = null;
  let dragged = null;

  const pages = () => pagesOf(state.data?.project);
  const current = () => pages().find((page) => page.id === state.page) ?? pages()[0];

  function openProducts() {
    const saved = (read(OPEN_KEY) ?? "").split(",").filter(Boolean);
    return product && !saved.includes(product) ? [...saved, product] : saved;
  }

  function setOpenProducts(list) {
    write(OPEN_KEY, list.join(","));
  }

  async function loadProducts() {
    if (!product || products) return;
    products = await api("/api/products").catch(() => []);
    const known = new Set(products.map((entry) => entry.id));
    setOpenProducts(openProducts().filter((id) => known.has(id)));
    render();
  }

  function remember() {
    const url = new URL(location.href);
    if (state.page && state.page !== pages()[0].id) url.searchParams.set("page", state.page);
    else url.searchParams.delete("page");
    history.replaceState(history.state, "", url);
    write(pageKey, state.page ?? "");
  }

  function go(pageId, { fit = true } = {}) {
    const target = pages().find((page) => page.id === pageId) ?? pages()[0];
    if (target.id === current().id && state.page) return;
    state.page = target.id;
    remember();
    onChange({ fit });
  }

  function showFor(sectionId) {
    const target = pageOfSection(pages(), sectionId ?? null);
    if (target.id !== current().id) go(target.id, { fit: false });
  }

  function visible(sectionId) {
    return onPage(pages(), current().id, sectionId ?? null);
  }

  function showMenu(event, title, entries) {
    openMenu({ menu, close: closeMenu, event, title, entries });
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

  function chooseKind(event) {
    showMenu(event, t("New page"), [
      { label: t("Page of screens"), run: () => createPage("screens") },
      { label: t("Board"), run: () => createPage("board") },
    ]);
  }

  async function createPage(kind = "screens") {
    const board = kind === "board";
    const taken = new Set(pages().map((page) => page.name));
    let n = board ? 1 : pages().length + 1;
    const nameOf = (count) => (board ? t("Board {n}", { n: count }) : t("Page {n}", { n: count }));
    while (taken.has(nameOf(n))) n++;
    const made = await save("/api/pages", { name: nameOf(n), ...(board ? { kind: "board" } : {}) });
    if (!made) return;
    renaming = made.id;
    go(made.id);
    render();
  }

  async function renamePage(pageId, name) {
    if (renaming !== pageId) return;
    renaming = null;
    const page = pages().find((entry) => entry.id === pageId);
    const clean = name.trim();
    if (!page || !clean || clean === page.name) return render();
    await save(`/api/pages/${pageId}`, { name: clean });
  }

  async function movePage(pageId, index) {
    await save(`/api/pages/${pageId}`, { index });
  }

  async function deletePage(page) {
    const count = page.sections.length;
    const list = pages();
    const at = list.findIndex((entry) => entry.id === page.id);
    const heir = at === 0 ? list[1] : list[at - 1];
    const detail = count ? ` ${count === 1 ? t("Its section moves to \"{page}\".", { page: heir.name }) : t("Its {n} sections move to \"{page}\".", { n: count, page: heir.name })}` : "";
    if (!confirm(`${t("Delete the page \"{page}\"?", { page: page.name })}${detail}`)) return;
    const result = await save(`/api/pages/${page.id}/delete`, {});
    if (result) go(result.movedTo);
  }

  async function moveSection(sectionId, pageId) {
    const page = pages().find((entry) => entry.id === pageId);
    const done = await save(`/api/sections/${sectionId}/page`, { page: pageId });
    if (!done) return;
    const name = state.data.project.sections.find((section) => section.id === sectionId)?.name ?? sectionId;
    toast(t("\"{section}\" moved to {page}.", { section: name, page: page.name }), { label: t("Go there"), run: () => go(pageId) });
  }

  async function moveSectionToNewPage(sectionId) {
    const name = state.data.project.sections.find((section) => section.id === sectionId)?.name ?? t("New page");
    const made = await save("/api/pages", { name });
    if (made) await moveSection(sectionId, made.id);
  }

  function sectionMenu(event, sectionId) {
    if (readOnly() || !sectionId) return;
    event.preventDefault();
    event.stopPropagation();
    const here = current().id;
    const others = pages().filter((page) => page.id !== here && !isBoard(page));
    const name = state.data.project.sections.find((section) => section.id === sectionId)?.name ?? "";
    showMenu(event, t("Move \"{section}\" to", { section: name }), [
      ...others.map((page) => ({ label: page.name, run: () => moveSection(sectionId, page.id) })),
      ...(others.length ? [null] : []),
      { label: t("New page with this section"), run: () => moveSectionToNewPage(sectionId) },
    ]);
  }

  function pageMenu(event, page) {
    if (readOnly()) return;
    event.preventDefault();
    const list = pages();
    const at = list.indexOf(page);
    showMenu(event, page.name, [
      { label: t("Rename"), run: () => ((renaming = page.id), render()) },
      { label: t("Move left"), disabled: at === 0, run: () => movePage(page.id, at - 1) },
      { label: t("Move right"), disabled: at === list.length - 1, run: () => movePage(page.id, at + 1) },
      null,
      { label: t("Delete page"), disabled: list.length === 1, run: () => deletePage(page) },
    ]);
  }

  function productMenu(event) {
    const open = new Set(openProducts());
    const rest = (products ?? []).filter((entry) => !open.has(entry.id));
    showMenu(event, rest.length ? t("Open product") : "", [
      ...rest.map((entry) => ({ label: entry.name, run: () => switchProduct(entry.id) })),
      ...(rest.length ? [null] : []),
      { label: t("All products"), run: () => (location.href = "/") },
    ]);
  }

  function switchProduct(id) {
    const list = openProducts();
    if (!list.includes(id)) setOpenProducts([...list, id]);
    location.href = `/${id}/`;
  }

  function closeProduct(id) {
    const list = openProducts();
    const at = list.indexOf(id);
    const rest = list.filter((entry) => entry !== id);
    setOpenProducts(rest);
    if (id !== product) return render();
    const next = rest[Math.min(at, rest.length - 1)];
    location.href = next ? `/${next}/` : "/";
  }

  function productTabs() {
    if (!product || readOnly()) return "";
    const names = new Map((products ?? []).map((entry) => [entry.id, entry.name]));
    names.set(product, state.data?.project?.name ?? product);
    const tabs = openProducts()
      .filter((id) => names.has(id))
      .map(
        (id) =>
          `<div class="ptab${id === product ? " on" : ""}" data-product="${escapeHtml(id)}" title="${escapeHtml(names.get(id))}"><span class="ptab-initial">${escapeHtml(names.get(id).trim().charAt(0).toUpperCase())}</span><span class="ptab-name">${escapeHtml(names.get(id))}</span><button class="ptab-close" data-close="${escapeHtml(id)}" aria-label="${escapeHtml(t("Close {name}", { name: names.get(id) }))}">×</button></div>`,
      )
      .join("");
    return `<div class="tabs-group products" role="tablist" aria-label="${escapeHtml(t("Open products"))}">${tabs}<button class="tab-add" data-add-product title="${escapeHtml(t("Open another product"))}" aria-label="${escapeHtml(t("Open another product"))}">+</button></div><span class="tabs-sep"></span>`;
  }

  function pageTabs() {
    const here = current().id;
    const list = pages();
    const tabs = list
      .map((page) =>
        page.id === renaming
          ? `<input class="page-tab renaming" data-rename="${escapeHtml(page.id)}" value="${escapeHtml(page.name)}" maxlength="60" aria-label="${escapeHtml(t("Page name"))}">`
          : `<button class="page-tab${page.id === here ? " on" : ""}${isBoard(page) ? " board" : ""}" role="tab" aria-selected="${page.id === here}" data-page="${escapeHtml(page.id)}" draggable="${!readOnly()}">${isBoard(page) ? BOARD_MARK : ""}${escapeHtml(page.name)}</button>`,
      )
      .join("");
    const add = readOnly() ? "" : `<button class="tab-add" data-add-page title="${escapeHtml(t("New page"))}" aria-label="${escapeHtml(t("New page"))}">+</button>`;
    return `<div class="tabs-group pages" role="tablist" aria-label="${escapeHtml(t("Pages"))}">${tabs}${add}</div>`;
  }

  function fitRoom() {
    const right = document.getElementById("top-right")?.getBoundingClientRect();
    if (!right?.width || window.innerWidth <= 760) return bar.style.removeProperty("--tabbar-room");
    bar.style.setProperty("--tabbar-room", `${Math.max(120, right.left - 288 - 12)}px`);
  }

  function render() {
    if (!state.data) return;
    requestAnimationFrame(fitRoom);
    if (renaming && bar.querySelector(`[data-rename="${CSS.escape(renaming)}"]`)) return;
    if (!pages().some((page) => page.id === state.page)) state.page = pages()[0].id;
    const showPages = !readOnly() || pages().length > 1;
    bar.hidden = !showPages && !productTabs();
    bar.innerHTML = productTabs() + (showPages ? pageTabs() : "");
    bar.querySelectorAll("[data-product]").forEach((tab) =>
      tab.addEventListener("click", (event) => {
        if (event.target.closest("[data-close]")) return;
        if (tab.dataset.product !== product) switchProduct(tab.dataset.product);
      }),
    );
    bar.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeProduct(button.dataset.close)));
    bar.querySelector("[data-add-product]")?.addEventListener("click", (event) => productMenu(event));
    bar.querySelector("[data-add-page]")?.addEventListener("click", chooseKind);
    bar.querySelectorAll("[data-page]").forEach((tab) => {
      const page = pages().find((entry) => entry.id === tab.dataset.page);
      tab.addEventListener("click", () => go(page.id));
      tab.addEventListener("dblclick", () => {
        if (readOnly()) return;
        renaming = page.id;
        render();
      });
      tab.addEventListener("contextmenu", (event) => pageMenu(event, page));
      tab.addEventListener("dragstart", (event) => {
        dragged = page.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", page.id);
      });
      tab.addEventListener("dragover", (event) => {
        if (!dragged && !event.dataTransfer.types.includes("application/x-screenbook-section")) return;
        event.preventDefault();
        tab.classList.add("drop");
      });
      tab.addEventListener("dragleave", () => tab.classList.remove("drop"));
      tab.addEventListener("drop", (event) => {
        event.preventDefault();
        tab.classList.remove("drop");
        const section = event.dataTransfer.getData("application/x-screenbook-section");
        if (section) {
          if (isBoard(page)) return;
          if (page.id !== current().id || !page.sections.includes(section)) moveSection(section, page.id);
          return;
        }
        const from = dragged;
        dragged = null;
        if (!from || from === page.id) return;
        movePage(from, pages().findIndex((entry) => entry.id === page.id));
      });
      tab.addEventListener("dragend", () => (dragged = null));
    });
    const input = bar.querySelector("[data-rename]");
    if (input) {
      input.focus();
      input.select();
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") renamePage(input.dataset.rename, input.value);
        if (event.key === "Escape") {
          renaming = null;
          render();
        }
      });
      input.addEventListener("blur", () => renamePage(input.dataset.rename, input.value));
    }
  }

  function start() {
    window.addEventListener("resize", fitRoom);
    const asked = new URLSearchParams(location.search).get("page") ?? read(pageKey);
    state.page = asked || null;
    loadProducts();
  }

  return {
    start,
    render,
    go,
    showFor,
    visible,
    pages,
    current,
    sectionMenu,
    createPage,
    moveSection,
    switchProduct,
    product,
    products: () => products ?? [],
    renameCurrent: () => ((renaming = current().id), render()),
  };
}
