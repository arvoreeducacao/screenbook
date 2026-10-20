import { arrange } from "./arrange.js";
import { escapeHtml } from "./menu.js";
import { pageOfSection } from "./pages.js";
import { t } from "./i18n.js";

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function matchesScreen(screen, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(`${screen.number} ${screen.name} ${screen.id} ${screen.route ?? ""}`);
  return words.every((word) => haystack.includes(word));
}

export function createLayers({ state, list, search, tabs, focusSection, focusPlaced, focusProposal, onPick, board = () => null }) {
  const open = new Set();
  let query = "";

  const sectionKey = (id) => id ?? "sem-secao";

  function placedOf(screenId) {
    const placed = state.placed.filter((entry) => entry.item.screen.id === screenId);
    return placed.find((entry) => entry.item.kind === "proposal") ?? placed[0] ?? null;
  }

  function latestProposal(screen) {
    const versions = [...screen.versions].reverse();
    for (const entry of versions) {
      const proposal = state.data.proposals.find((record) => record.id === entry.proposal && record.status === "open");
      if (proposal) return proposal;
    }
    return null;
  }

  function reveal(screenId) {
    const screen = state.data.screens.find((entry) => entry.id === screenId);
    if (!screen) return false;
    tabs.showFor(screen.section);
    let placed = placedOf(screenId);
    if (!placed) {
      const proposal = latestProposal(screen);
      if (proposal) focusProposal(proposal.id);
      placed = placedOf(screenId);
    }
    if (!placed) return false;
    focusPlaced(placed);
    onPick?.();
    return true;
  }

  function revealSection(sectionId) {
    tabs.showFor(sectionId);
    const section = state.sections.find((entry) => sectionKey(entry.id) === sectionKey(sectionId));
    if (section) focusSection(section);
    onPick?.();
  }

  function rows() {
    const { project, screens } = state.data;
    const searching = Boolean(query.trim());
    const pages = tabs.pages();
    const visible = searching ? screens.filter((screen) => matchesScreen(screen, query)) : screens;
    const placedIds = new Set(state.placed.map((entry) => entry.item.screen.id));
    const sections = [];
    for (const { section, groups } of arrange(project.sections, visible)) {
      if (!searching && !tabs.visible(section.id)) continue;
      const items = groups.flatMap((group) => [
        { screen: group.screen, variant: false },
        ...group.variants.map((screen) => ({ screen, variant: true })),
      ]);
      const shown = searching ? items : items.filter((entry) => placedIds.has(entry.screen.id));
      if (!shown.length) continue;
      const page = pageOfSection(pages, section.id);
      sections.push({ section, items: shown, page: page.id === tabs.current().id ? null : page });
    }
    return { sections, searching };
  }

  function kindOf(screen) {
    if (screen.official) return "live";
    return "prop";
  }

  function render() {
    if (!state.data) return;
    const onBoard = board()?.active();
    const hint = onBoard ? t("Search the board") : t("Search screens");
    if (search.placeholder !== hint) {
      search.placeholder = hint;
      search.setAttribute("aria-label", hint);
    }
    if (onBoard) return board().renderLayers(list, query);
    delete list.dataset.boardLayers;
    if (state.view !== "canvas") {
      list.innerHTML = `<p class="sb-empty">${escapeHtml(t("In the flow, screens follow navigation, not sections."))}</p>`;
      return;
    }
    const { sections, searching } = rows();
    const selected = state.selected?.screen.id;
    if (!sections.length) {
      list.innerHTML = `<p class="sb-empty">${escapeHtml(searching ? t("No screen by that name.") : t("No screens on this page."))}</p>`;
      return;
    }
    list.innerHTML = sections
      .map(({ section, items, page }) => {
        const key = sectionKey(section.id);
        const expanded = searching || open.has(key);
        const head = `<div class="ly-section${expanded ? " open" : ""}"><button class="ly-fold" data-fold="${escapeHtml(key)}" aria-expanded="${expanded}" aria-label="${escapeHtml(t(expanded ? "Collapse {section}" : "Expand {section}", { section: section.name }))}">${CHEVRON}</button><button class="ly-name" data-section="${escapeHtml(key)}"><span class="sb-name">${escapeHtml(section.name)}</span>${
          page ? `<span class="ly-page">${escapeHtml(page.name)}</span>` : ""
        }<span class="n">${items.length}</span></button></div>`;
        if (!expanded) return head;
        const children = items
          .map(
            ({ screen, variant }) =>
              `<button class="ly-screen${variant ? " variant" : ""}${screen.id === selected ? " on" : ""}" data-screen="${escapeHtml(screen.id)}" title="${escapeHtml(screen.route ?? screen.name)}"><span class="num ${kindOf(screen)}">${screen.number}</span><span class="sb-name">${escapeHtml(screen.name)}</span></button>`,
          )
          .join("");
        return `${head}<div class="ly-children">${children}</div>`;
      })
      .join("");
    list.querySelectorAll("[data-fold]").forEach((button) =>
      button.addEventListener("click", () => {
        const key = button.dataset.fold;
        if (open.has(key)) open.delete(key);
        else open.add(key);
        render();
      }),
    );
    list.querySelectorAll("[data-section]").forEach((button) =>
      button.addEventListener("click", () => {
        const key = button.dataset.section;
        open.add(key);
        revealSection(key === "sem-secao" ? null : key);
        render();
      }),
    );
    list.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => reveal(button.dataset.screen)));
    list.querySelector(".ly-screen.on")?.scrollIntoView({ block: "nearest" });
  }

  search.addEventListener("input", () => {
    query = search.value;
    render();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      search.value = "";
      query = "";
      search.blur();
      render();
    }
    if (event.key === "Enter") list.querySelector("[data-screen], [data-board-item]")?.click();
  });

  function expandFor(screenId) {
    const screen = state.data?.screens.find((entry) => entry.id === screenId);
    if (screen) open.add(sectionKey(state.data.project.sections.some((section) => section.id === screen.section) ? screen.section : null));
  }

  return {
    render,
    reveal,
    revealSection,
    expandFor,
    focusSearch: () => {
      if (search.closest(".collapsed")) document.getElementById("sidebar-toggle")?.click();
      search.focus();
      search.select();
    },
  };
}
