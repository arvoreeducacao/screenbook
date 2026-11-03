import { escapeHtml } from "./menu.js";
import { t } from "./i18n.js";

const DIAMOND = '<i class="cp-dia" aria-hidden="true"></i>';

function timeAgo(iso) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{n} h ago", { n: hours });
  return t("{n} d ago", { n: Math.round(hours / 24) });
}

export function shownParts(state, screen, version) {
  const entry = screen.versions?.find((item) => item.v === version);
  if (!entry?.parts) return null;
  const follows = entry.v === screen.versions.at(-1)?.v && screen.official !== entry.v;
  const latest = Object.fromEntries((state.data?.components ?? []).map((item) => [item.id, item.latest]));
  return Object.fromEntries(Object.keys(entry.parts).sort().map((name) => [name, follows ? (latest[name] ?? entry.parts[name]) : entry.parts[name]]));
}

export function partsStamp(state, screen, version) {
  const shown = shownParts(state, screen, version);
  return shown ? Object.entries(shown).map(([name, v]) => `${name}.${v}`).join("-") : "";
}

export function createComponents({ base, state, list, api, post, ensureName, toast, refresh, openScreen, askAi }) {
  let items = null;
  let loading = null;
  let view = null;

  async function load() {
    loading = api(`${base}/api/components`).then((data) => {
      items = data;
      loading = null;
      return data;
    });
    return loading;
  }

  function linked(item) {
    return !item.legacy || item.screens > 0;
  }

  function row(item) {
    const flag = item.outdated ? `<span class="cp-tag warn" title="${escapeHtml(t("{n} official screens wait for the newest version", { n: item.outdated }))}">${item.outdated}</span>` : "";
    return `<button class="sb-item cp-row${view?.id === item.id ? " on" : ""}" data-component="${escapeHtml(item.id)}">${DIAMOND}<span class="sb-name">${escapeHtml(item.name)}</span>${flag}<span class="n">${item.screens}</span></button>`;
  }

  function loose(item) {
    return `<div class="cp-loose"><span class="sb-name">${escapeHtml(item.name)}</span><button class="sb-link" data-link="${escapeHtml(item.id)}">${t("link copies")}</button></div>`;
  }

  function renderList() {
    if (!items) {
      list.innerHTML = `<p class="sb-empty">${t("Loading…")}</p>`;
      if (!loading) load().then(renderList).catch((error) => (list.innerHTML = `<p class="sb-empty">${escapeHtml(error.message)}</p>`));
      return;
    }
    const kit = items.filter(linked).sort((a, b) => b.screens - a.screens || a.name.localeCompare(b.name));
    const old = items.filter((item) => !linked(item)).sort((a, b) => a.name.localeCompare(b.name));
    list.innerHTML = `
      <div class="sb-title">${t("Components")}<b class="sb-count">${kit.length}</b></div>
      ${kit.length ? kit.map(row).join("") : `<p class="sb-empty">${t("No component yet. Ask the AI to save the pieces that repeat, or link the copies below.")}</p>`}
      ${old.length ? `<div class="sb-title cp-old-title">${t("Not linked yet")}<b class="sb-count">${old.length}</b></div><p class="cp-hint">${t("Old pieces: the screens carry pasted copies of them. Link the copies and they become components, without changing any screen.")}</p>${old.map(loose).join("")}` : ""}`;
    list.querySelectorAll("[data-component]").forEach((button) => button.addEventListener("click", () => open(button.dataset.component)));
    list.querySelectorAll("[data-link]").forEach((button) => button.addEventListener("click", () => linkCopies(button.dataset.link)));
  }

  async function linkCopies(id) {
    const name = await ensureName();
    if (!name) return;
    const dry = await post(`${base}/api/components/${id}/link`, { dryRun: true, by: name });
    if (!dry.screens) {
      toast(t("No screen carries a copy of {name}.", { name: id }));
      return;
    }
    if (!confirm(t("{n} screens carry copies of {name}. Link them to the component? No screen changes how it looks.", { n: dry.screens, name: id }))) return;
    const done = await post(`${base}/api/components/${id}/link`, { by: name });
    toast(t("{n} screens now follow {name}.", { n: done.screens, name: id }));
    await reload();
  }

  async function reload() {
    await load();
    await refresh(true);
    renderList();
    if (view) await open(view.id, view.version, true);
  }

  async function open(id, version = null, keep = false) {
    const data = await api(`${base}/api/components/${id}${version ? `?version=${version}` : ""}`);
    view = { id, version: data.version, data };
    renderView();
    if (!keep) renderList();
  }

  function close() {
    view = null;
    document.querySelector("#component-view")?.remove();
    renderList();
  }

  function usageRow(row) {
    const status = row.outdated
      ? `<span class="cp-tag warn">v${row.shown} → v${row.latest}</span>`
      : row.official ? `<span class="cp-tag live">${t("official")} · v${row.shown}</span>` : `<span class="cp-tag prop">${t("proposal")} · v${row.shown}</span>`;
    const actions = row.outdated
      ? `<span class="cp-actions"><button class="btn sm approve" data-update="${escapeHtml(row.screen)}">${t("Update to v{v}", { v: row.latest })}</button><button class="btn sm" data-keep="${escapeHtml(row.screen)}">${t("Keep v{v}", { v: row.shown })}</button></span>`
      : "";
    return `<li class="cp-use${row.outdated ? " outdated" : ""}"><button class="cp-thumb" data-screen="${escapeHtml(row.screen)}" data-version="${row.version}"><img src="${base}/api/screens/${escapeHtml(row.screen)}/v${row.version}.thumb.webp?p=${row.shown}" alt="" loading="lazy"></button><span class="cp-use-text"><b>${row.number ?? ""} ${escapeHtml(row.name)}</b>${status}</span>${actions}</li>`;
  }

  function renderView() {
    const { data } = view;
    let panel = document.querySelector("#component-view");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "component-view";
      panel.className = "fl cp-view";
      document.body.append(panel);
    }
    const versions = [...data.versions].reverse();
    const usage = [...data.usage].sort((a, b) => Number(b.outdated) - Number(a.outdated) || Number(b.official) - Number(a.official) || (a.number ?? 0) - (b.number ?? 0));
    const waiting = usage.filter((row) => row.outdated);
    panel.innerHTML = `
      <header class="cp-head">${DIAMOND}<h2>${escapeHtml(data.name)}</h2><span class="cp-tag comp">v${data.version}${data.version !== data.latest ? ` · ${t("newest is v{v}", { v: data.latest })}` : ""}</span><span class="grow"></span><button class="icon-btn" data-close aria-label="${t("Close")}">×</button></header>
      <div class="cp-body">
        <div class="cp-stage"><iframe title="${escapeHtml(data.name)}" src="${base}/api/components/${escapeHtml(data.id)}/v${data.version}.html" sandbox="allow-scripts"></iframe></div>
        <aside class="cp-side">
          <dl class="cp-sum">
            <dt><span class="cp-tag prop">${data.following}</span></dt><dd>${t("screens in proposals follow the newest version")}</dd>
            <dt><span class="cp-tag live">${data.official}</span></dt><dd>${t("official screens keep the version they were approved with")}</dd>
            ${waiting.length ? `<dt><span class="cp-tag warn">${waiting.length}</span></dt><dd>${t("official screens wait for the newest version")}</dd>` : ""}
          </dl>
          ${askAi ? `<form class="cp-ask" data-ask><input name="change" autocomplete="off" placeholder="${escapeHtml(t("What should change in {name}?", { name: data.name }))}"><button class="btn sm primary">${t("Ask the AI")}</button></form>` : ""}
          <h3>${t("Versions")}</h3>
          <ol class="cp-versions">${versions
            .map((entry) => `<li><button class="${entry.v === data.version ? "on" : ""}" data-version-pick="${entry.v}"><b>v${entry.v}</b><span>${escapeHtml(entry.note ?? "")}</span><small>${escapeHtml(entry.by ?? t("before versions"))}${entry.at ? ` · ${timeAgo(entry.at)}` : ""}</small></button></li>`)
            .join("")}</ol>
          <h3>${t("Used in {n} screens", { n: data.screens })}</h3>
          <ul class="cp-usage">${usage.length ? usage.map(usageRow).join("") : `<li class="sb-empty">${t("No screen uses it yet.")}</li>`}</ul>
        </aside>
      </div>`;
    fitStage(panel);
    panel.querySelector("[data-close]").addEventListener("click", close);
    panel.querySelectorAll("[data-version-pick]").forEach((button) => button.addEventListener("click", () => open(view.id, Number(button.dataset.versionPick), true)));
    panel.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => {
      openScreen(button.dataset.screen, Number(button.dataset.version));
    }));
    panel.querySelectorAll("[data-update]").forEach((button) => button.addEventListener("click", () => updateScreen(button.dataset.update, "update")));
    panel.querySelectorAll("[data-keep]").forEach((button) => button.addEventListener("click", () => updateScreen(button.dataset.keep, "keep")));
    panel.querySelector("[data-ask]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const change = event.target.change.value.trim();
      if (!change) return;
      askAi(`Change the component "${view.data.id}" (read it with read_part, then save a new version with write_part and a short note): ${change}`);
      event.target.change.value = "";
    });
  }

  function fitStage(panel = document.querySelector("#component-view")) {
    const stage = panel?.querySelector(".cp-stage");
    if (!stage) return;
    const scale = Math.min(1, Math.max(0.2, (stage.clientWidth - 48) / 1280));
    stage.style.setProperty("--cp-scale", scale.toFixed(3));
  }

  addEventListener("resize", () => fitStage());

  async function updateScreen(screen, action) {
    const name = await ensureName();
    if (!name) return;
    const result = await post(`${base}/api/screens/${screen}/parts/${action}`, { by: name });
    toast(action === "update" ? t("Screen updated to the newest components.") : t("Screen keeps its version. The warning is gone."));
    await reload();
    return result;
  }

  return {
    render: renderList,
    open,
    close,
    updateScreen,
    invalidate() {
      items = null;
      if (!list.hidden) renderList();
      if (view) open(view.id, view.version, true).catch(() => close());
    },
  };
}
