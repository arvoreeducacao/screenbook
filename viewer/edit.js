import { applyEditOps, createEditHistory, parseScreen, sameAt, serializeScreen, uniqueName } from "./edit-ops.js";
import { colorText, readColor, rgbToHex, parseRgb } from "./inspect.js";
import { t } from "./i18n.js";

const px = (value) => parseFloat(value) || 0;
const round = (value) => String(Math.round(value * 100) / 100);

const ICON = {
  text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  wrap: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5" stroke-dasharray="3 2.5"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>',
  hide: '<path d="M3 12s3.5-6.5 9-6.5 9 6.5 9 6.5-3.5 6.5-9 6.5S3 12 3 12z"/><circle cx="12" cy="12" r="2.5"/><path d="m4 20 16-16"/>',
  show: '<path d="M3 12s3.5-6.5 9-6.5 9 6.5 9 6.5-3.5 6.5-9 6.5S3 12 3 12z"/><circle cx="12" cy="12" r="2.5"/>',
  remove: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5"/>',
  undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h10a5 5 0 0 1 0 10H11"/>',
  redo: '<path d="m15 14 4.5-4.5L15 5"/><path d="M19.5 9.5h-10a5 5 0 0 0 0 10H13"/>',
  row: '<path d="M4 12h15M14 7l5 5-5 5"/>',
  column: '<path d="M12 4v15M7 14l5 5 5-5"/>',
  between: '<path d="M4.5 4v16M19.5 4v16"/><rect x="8" y="8.5" width="3" height="7" rx="1"/><rect x="13" y="8.5" width="3" height="7" rx="1"/>',
  spark: '<path d="M12 3c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"/>',
  left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  layout: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/>',
};

const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const FIELDS = {
  w: { prop: "width", unit: "px" },
  h: { prop: "height", unit: "px" },
  pt: { prop: "padding-top", unit: "px" },
  pr: { prop: "padding-right", unit: "px" },
  pb: { prop: "padding-bottom", unit: "px" },
  pl: { prop: "padding-left", unit: "px" },
  mt: { prop: "margin-top", unit: "px" },
  mr: { prop: "margin-right", unit: "px" },
  mb: { prop: "margin-bottom", unit: "px" },
  ml: { prop: "margin-left", unit: "px" },
  radius: { prop: "border-radius", unit: "px" },
  bw: { prop: "border-width", unit: "px" },
  fs: { prop: "font-size", unit: "px" },
  fw: { prop: "font-weight", unit: "" },
  lh: { prop: "line-height", unit: "px" },
  gap: { prop: "gap", unit: "px" },
};

const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
const AXIS = ["start", "center", "end"];

export function cssValue(raw, unit) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (/^-?\d+(\.\d+)?$/.test(text)) return `${text}${unit}`;
  return text;
}

export function axisOf(value) {
  if (["center"].includes(value)) return "center";
  if (["flex-end", "end", "right", "bottom"].includes(value)) return "end";
  return "start";
}

export function tokenName(value) {
  const match = String(value ?? "").match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);
  return match ? match[1] : null;
}

export function inverseOf(doc, op) {
  const node = op.at.reduce((current, index) => current?.children[index] ?? null, doc.body);
  if (op.kind === "insert") return { kind: "remove", at: op.at };
  if (!node) return null;
  if (op.kind === "style") return { kind: "style", at: op.at, prop: op.prop, value: node.style.getPropertyValue(op.prop) };
  if (op.kind === "text") return { kind: "text", at: op.at, value: node.textContent };
  if (op.kind === "remove") return { kind: "insert", at: op.at, html: node.outerHTML };
  if (op.kind === "move") return { kind: "move", at: [...op.at.slice(0, -1), op.to], to: op.at.at(-1) };
  return null;
}

export function createEditing({ base, frames, current, canEdit, lockedReason = () => null, escapeHtml, toast, post, ensureName, targetText, onSaved, onAskAi, rerender }) {
  const state = { key: "", model: null, source: null, loading: null, history: createEditHistory(), info: null, at: null, tokens: [], popover: null, on: false };
  const bar = document.createElement("div");
  bar.className = "pe-bar";
  bar.id = "pe-bar";
  bar.hidden = true;
  document.querySelector("#overlay .ov-body")?.appendChild(bar);

  function keyOf() {
    const now = current();
    return now ? `${now.screenId}/v${now.version}` : "";
  }

  function send(message) {
    for (const frame of frames()) frame.contentWindow?.postMessage(message, "*");
  }

  function scale() {
    const frame = frames()[0];
    if (!frame?.offsetWidth) return 1;
    return frame.getBoundingClientRect().width / frame.offsetWidth;
  }

  function dirty() {
    return state.history.count > 0;
  }

  function reset() {
    state.model = state.source === null ? null : parseScreen(state.source);
    state.history.clear();
    state.info = null;
    state.at = null;
    closePopover();
    renderBar();
  }

  async function load() {
    const key = keyOf();
    if (!key || !canEdit()) return;
    if (state.key === key && (state.model || state.loading)) return state.loading;
    const now = current();
    state.key = key;
    state.source = null;
    reset();
    state.loading = fetch(`${base}/api/screens/${now.screenId}/v${now.version}.source`)
      .then((response) => (response.ok ? response.text() : null))
      .then((source) => {
        if (state.key !== key) return;
        state.source = source;
        state.model = source === null ? null : parseScreen(source);
        state.loading = null;
        send({ type: "sb-edit", on: state.on && Boolean(state.model), scale: scale() });
        rerender();
      })
      .catch(() => {
        state.loading = null;
      });
    return state.loading;
  }

  function setOn(on) {
    state.on = on;
    if (on) load();
    send({ type: "sb-edit", on: on && Boolean(state.model), scale: scale() });
    if (!on) closePopover();
    renderBar();
  }

  function nodeAt(at) {
    if (!state.model || !Array.isArray(at)) return null;
    return at.reduce((node, index) => node?.children[index] ?? null, state.model.doc.body);
  }

  function matches(info) {
    const node = nodeAt(info?.at);
    if (!node || !info.at.length) return null;
    if (node.tagName.toLowerCase() !== info.tag) return null;
    if ((node.getAttribute("data-el") ?? null) !== (info.el ?? null)) return null;
    return node;
  }

  function picked(info) {
    state.info = info;
    state.at = info?.at ?? null;
    closePopover();
  }

  function editable(info) {
    return Boolean(canEdit() && state.model && keyOf() === state.key && matches(info));
  }

  function reason(info) {
    if (!canEdit()) return lockedReason();
    if (!state.model) return state.loading ? t("Getting the editor ready…") : null;
    if (!matches(info)) return t("This piece comes from a script on the screen and cannot be changed here. Ask the AI.");
    return null;
  }

  function commit(ops, { merge = null, select } = {}) {
    if (!state.model || !ops.length) return;
    const after = select === undefined ? state.at : select;
    if (merge && state.history.merge(merge, ops, after)) {
      applyEditOps(state.model.doc, ops);
      send({ type: "sb-edit-ops", ops });
      renderBar();
      return;
    }
    state.history.seal();
    const inverse = [];
    for (const op of ops) {
      const back = inverseOf(state.model.doc, op);
      if (!back) {
        applyEditOps(state.model.doc, inverse);
        return;
      }
      inverse.unshift(back);
      applyEditOps(state.model.doc, [op]);
    }
    state.history.push({ ops, inverse, merge, selectBefore: state.at, selectAfter: after });
    send({ type: "sb-edit-ops", ops });
    if (!sameAt(after, state.at)) selectAt(after);
    renderBar();
  }

  function selectAt(at) {
    state.at = at;
    send({ type: "sb-inspect-at", at: at ?? [] });
  }

  function refreshInfo() {
    state.history.seal();
    if (state.at) send({ type: "sb-inspect-at", at: state.at });
  }

  function undo() {
    const entry = state.history.undo();
    if (!entry) return;
    applyEditOps(state.model.doc, entry.inverse);
    send({ type: "sb-edit-ops", ops: entry.inverse });
    selectAt(entry.selectBefore);
    renderBar();
  }

  function redo() {
    const entry = state.history.redo();
    if (!entry) return;
    applyEditOps(state.model.doc, entry.ops);
    send({ type: "sb-edit-ops", ops: entry.ops });
    selectAt(entry.selectAfter);
    renderBar();
  }

  function discard() {
    if (!dirty()) return;
    const back = state.history.applied().reverse().flatMap((entry) => entry.inverse);
    send({ type: "sb-edit-ops", ops: back });
    const at = state.at;
    reset();
    if (at) selectAt(at);
  }

  function leave() {
    if (!dirty()) return true;
    if (!confirm(t("Discard the changes you made to this screen?"))) return false;
    discard();
    return true;
  }

  function takenNames() {
    return new Set([...state.model.doc.querySelectorAll("[data-el]")].map((node) => node.getAttribute("data-el")));
  }

  function freeName(baseName, taken) {
    return taken.has(baseName) ? uniqueName(baseName, taken) : baseName;
  }

  function setStyle(prop, value, merge = null) {
    if (!state.at) return;
    commit([{ kind: "style", at: state.at, prop, value }], { merge });
  }

  const actions = {
    duplicate() {
      const node = nodeAt(state.at);
      if (!node) return;
      const clone = node.cloneNode(true);
      const taken = takenNames();
      for (const piece of [clone, ...clone.querySelectorAll("[data-el]")]) {
        const name = piece.getAttribute("data-el");
        if (!name) continue;
        const next = uniqueName(name, taken);
        taken.add(next);
        piece.setAttribute("data-el", next);
      }
      const at = [...state.at.slice(0, -1), state.at.at(-1) + 1];
      commit([{ kind: "insert", at, html: clone.outerHTML }], { select: at });
    },
    delete() {
      if (!nodeAt(state.at)) return;
      commit([{ kind: "remove", at: state.at }], { select: null });
    },
    up() {
      const index = state.at?.at(-1);
      if (!index) return;
      const at = [...state.at.slice(0, -1), index - 1];
      commit([{ kind: "move", at: state.at, to: index - 1 }], { select: at });
    },
    down() {
      const node = nodeAt(state.at);
      if (!node?.nextElementSibling) return;
      const index = state.at.at(-1);
      commit([{ kind: "move", at: state.at, to: index + 1 }], { select: [...state.at.slice(0, -1), index + 1] });
    },
    wrap() {
      const node = nodeAt(state.at);
      if (!node) return;
      const inline = /^inline/.test(state.info?.styles?.display ?? "");
      const box = state.model.doc.createElement("div");
      box.setAttribute("data-el", freeName("box", takenNames()));
      box.setAttribute("style", inline ? "display: inline-flex;" : "display: flex; flex-direction: column;");
      box.appendChild(node.cloneNode(true));
      commit([{ kind: "remove", at: state.at }, { kind: "insert", at: state.at, html: box.outerHTML }], { select: state.at });
    },
    hide() {
      const node = nodeAt(state.at);
      if (!node) return;
      const inline = node.style.getPropertyValue("display") === "none";
      const computed = state.info?.styles?.display === "none";
      setStyle("display", inline ? "" : computed ? "block" : "none");
      refreshInfo();
    },
    text() {
      if (state.at) send({ type: "sb-edit-type", at: state.at });
    },
    ai() {
      onAskAi(state.info);
    },
    layout() {
      if (!state.at) return;
      commit([{ kind: "style", at: state.at, prop: "display", value: "flex" }, { kind: "style", at: state.at, prop: "flex-direction", value: "column" }]);
      refreshInfo();
    },
  };

  function inlineOf(prop) {
    return nodeAt(state.at)?.style.getPropertyValue(prop) ?? "";
  }

  function numberField(field, label, value, title = "") {
    return `<label class="pe-num" title="${escapeHtml(title)}"><span class="pe-k" data-scrub="${field}">${label}</span><input data-field="${field}" inputmode="decimal" spellcheck="false" autocomplete="off" value="${escapeHtml(value)}"></label>`;
  }

  function colorRow(field, label, computed) {
    const inline = inlineOf(field);
    const token = tokenName(inline) ?? matchToken(computed);
    const { hex, alpha } = readColor(computed);
    const shown = alpha === 0 ? t("None") : hex;
    return `<button type="button" class="pe-color" data-color="${field}"><i class="dv-swatch" style="background:${escapeHtml(computed)}"></i><span class="pe-color-val">${
      token ? `<span class="pe-token">${escapeHtml(token.replace(/^--/, ""))}</span>` : `<span class="mono">${escapeHtml(shown)}</span>`
    }</span><span class="muted pe-color-label">${label}${alpha > 0 && alpha < 1 ? ` · ${Math.round(alpha * 100)}%` : ""}</span></button>`;
  }

  function matchToken(computed) {
    const text = colorText(computed);
    const list = state.tokens.filter((token) => token.color && colorText(token.color) === text);
    list.sort((a, b) => (b.used === "direct") - (a.used === "direct") || a.name.length - b.name.length);
    return list[0]?.name ?? null;
  }

  function matrix(s) {
    const row = s.flexDirection !== "column" && s.flexDirection !== "column-reverse";
    const main = s.justifyContent === "space-between" ? null : axisOf(s.justifyContent);
    const cross = axisOf(s.alignItems);
    const cells = [];
    for (const y of AXIS) {
      for (const x of AXIS) {
        const on = row ? main === x && cross === y : main === y && cross === x;
        const between = !main && (row ? cross === y : cross === x);
        cells.push(`<button type="button" class="pe-cell ${on ? "on" : ""} ${between ? "line" : ""}" data-align="${x}:${y}" aria-label="${t("Align {x} {y}", { x, y })}"><i></i></button>`);
      }
    }
    return `<div class="pe-matrix ${row ? "row" : "column"}">${cells.join("")}</div>`;
  }

  function sectionsHtml(info) {
    const s = info.styles;
    const node = nodeAt(info.at);
    const leafText = node && !node.children.length && /\S/.test(node.textContent);
    const hidden = node?.style.getPropertyValue("display") === "none" || s.display === "none";
    const flex = /flex/.test(s.display ?? "");
    const container = node?.children.length > 0;
    const bordered = px(s.borderTopWidth) && s.borderTopStyle !== "none";
    const button = (icon, act, label, keys = "", disabled = false) =>
      `<button type="button" class="icon-btn pe-act" data-act="${act}" title="${escapeHtml(label + (keys ? ` (${keys})` : ""))}" aria-label="${escapeHtml(label)}" ${disabled ? "disabled" : ""}>${svg(icon)}</button>`;
    const actionsHtml = `<div class="pe-actions">
        ${leafText ? button("text", "text", t("Edit the text"), "Enter") : ""}
        ${button("duplicate", "duplicate", t("Duplicate"), "⌘D")}
        ${button("up", "up", t("Move up"), "⌥↑", !info.at.at(-1))}
        ${button("down", "down", t("Move down"), "⌥↓", !node?.nextElementSibling)}
        ${button("wrap", "wrap", t("Wrap in a box"), "⌘⌥G")}
        ${hidden ? button("show", "hide", t("Show")) : button("hide", "hide", t("Hide"))}
        ${button("remove", "delete", t("Delete"), "⌫")}
        <span class="grow"></span>
        <button type="button" class="btn sm pe-ai" data-act="ai">${svg("spark")}${t("Ask the AI")}</button>
      </div>`;
    return { actions: actionsHtml, sections: `
        ${
          leafText
            ? `<section class="pe-sec"><div class="pe-title">${t("Text")}</div><textarea class="pe-textarea" data-field="text" rows="${Math.min(5, Math.max(1, Math.ceil(node.textContent.length / 34)))}" spellcheck="false">${escapeHtml(node.textContent)}</textarea></section>`
            : ""
        }
        <section class="pe-sec"><div class="pe-title">${t("Size")}</div>
          <div class="pe-two">${numberField("w", t("W"), round(info.box.w), t("Width"))}${numberField("h", t("H"), round(info.box.h), t("Height"))}</div>
        </section>
        ${
          flex
            ? `<section class="pe-sec"><div class="pe-title">Auto layout<span class="seg pe-seg"><button type="button" data-dir="row" class="${s.flexDirection.startsWith("row") ? "on" : ""}" title="Horizontal" aria-label="Horizontal">${svg("row")}</button><button type="button" data-dir="column" class="${
                s.flexDirection.startsWith("column") ? "on" : ""
              }" title="Vertical" aria-label="Vertical">${svg("column")}</button></span></div>
              <div class="pe-layout">${matrix(s)}<div class="pe-layout-side">${numberField("gap", "↔", round(px(s.gap)), t("Space between items"))}<button type="button" class="btn sm pe-between ${s.justifyContent === "space-between" ? "on" : ""}" data-between title="${t("Spread the items")}">${svg("between")}${t("Spread")}</button></div></div></section>`
            : container
              ? `<section class="pe-sec"><div class="pe-title">Auto layout<button type="button" class="icon-btn pe-add" data-act="layout" title="${t("Turn on auto layout")}" aria-label="${t("Turn on auto layout")}">+</button></div></section>`
              : ""
        }
        <section class="pe-sec"><div class="pe-title">${t("Padding and margin")}</div>
          <div class="pe-sub">${t("Inside")}</div>
          <div class="pe-four">${numberField("pt", "↑", round(px(s.paddingTop)), t("Top"))}${numberField("pr", "→", round(px(s.paddingRight)), t("Right"))}${numberField("pb", "↓", round(px(s.paddingBottom)), t("Bottom"))}${numberField("pl", "←", round(px(s.paddingLeft)), t("Left"))}</div>
          <div class="pe-sub">${t("Outside")}</div>
          <div class="pe-four">${numberField("mt", "↑", round(px(s.marginTop)), t("Top"))}${numberField("mr", "→", round(px(s.marginRight)), t("Right"))}${numberField("mb", "↓", round(px(s.marginBottom)), t("Bottom"))}${numberField("ml", "←", round(px(s.marginLeft)), t("Left"))}</div>
        </section>
        <section class="pe-sec"><div class="pe-title">${t("Fill")}</div>${colorRow("background-color", t("Background"), s.backgroundColor)}</section>
        ${
          info.ownText || leafText
            ? `<section class="pe-sec"><div class="pe-title">${t("Typography")}</div>
              ${colorRow("color", t("Text"), s.color)}
              <div class="pe-two">${numberField("fs", "Aa", round(px(s.fontSize)), t("Font size"))}<label class="pe-num pe-select" title="${t("Weight")}"><span class="pe-k">${t("Wt")}</span><select data-field="fw">${WEIGHTS.map((weight) => `<option ${String(s.fontWeight) === weight ? "selected" : ""}>${weight}</option>`).join("")}</select></label></div>
              <div class="pe-two">${numberField("lh", "↕", s.lineHeight === "normal" ? "" : round(px(s.lineHeight)), t("Line height"))}<span class="seg pe-seg pe-align">${["left", "center", "right"]
                .map((value) => `<button type="button" data-ta="${value}" class="${axisOf(s.textAlign === "start" ? "left" : s.textAlign) === axisOf(value) ? "on" : ""}" aria-label="${t("Align {value}", { value })}">${svg(value)}</button>`)
                .join("")}</span></div>
            </section>`
            : ""
        }
        <section class="pe-sec"><div class="pe-title">${t("Border and corners")}</div>
          <div class="pe-two">${numberField("radius", "◜", round(px(s.borderTopLeftRadius)), t("Corner radius"))}${numberField("bw", "▢", bordered ? round(px(s.borderTopWidth)) : "0", t("Border width"))}</div>
          ${bordered ? colorRow("border-color", t("Border"), s.borderTopColor) : ""}
        </section>` };
  }

  function opsForField(field, raw) {
    const spec = FIELDS[field];
    const value = cssValue(raw, spec.unit);
    const ops = [{ kind: "style", at: state.at, prop: spec.prop, value }];
    if (field === "bw" && px(value) > 0 && (state.info?.styles?.borderTopStyle ?? "none") === "none" && !inlineOf("border-style")) {
      ops.push({ kind: "style", at: state.at, prop: "border-style", value: "solid" });
    }
    return ops;
  }

  function wire(container) {
    container.querySelectorAll("[data-act]").forEach((button) => button.addEventListener("click", () => actions[button.dataset.act]?.()));
    container.querySelectorAll("input[data-field]").forEach((input) => {
      const field = input.dataset.field;
      const key = () => `${field}:${state.at?.join(".")}`;
      input.addEventListener("input", () => commit(opsForField(field, input.value), { merge: key() }));
      input.addEventListener("change", refreshInfo);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") input.blur();
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        const number = parseFloat(input.value);
        if (Number.isNaN(number)) return;
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
        input.value = round(Math.max(field.startsWith("m") ? -9999 : 0, number + step));
        commit(opsForField(field, input.value), { merge: key() });
      });
    });
    container.querySelectorAll("[data-scrub]").forEach((label) =>
      label.addEventListener("mousedown", (event) => {
        const input = container.querySelector(`input[data-field="${label.dataset.scrub}"]`);
        const start = parseFloat(input?.value);
        if (!input || Number.isNaN(start)) return;
        event.preventDefault();
        const x = event.clientX;
        const field = label.dataset.scrub;
        document.body.classList.add("pe-scrubbing");
        const move = (moved) => {
          const delta = Math.round((moved.clientX - x) / 2) * (moved.shiftKey ? 10 : 1);
          input.value = round(Math.max(field.startsWith("m") ? -9999 : 0, start + delta));
          commit(opsForField(field, input.value), { merge: `${field}:${state.at?.join(".")}` });
        };
        const up = () => {
          document.body.classList.remove("pe-scrubbing");
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          refreshInfo();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }),
    );
    container.querySelector('select[data-field="fw"]')?.addEventListener("change", (event) => {
      commit(opsForField("fw", event.target.value));
      refreshInfo();
    });
    const text = container.querySelector('textarea[data-field="text"]');
    text?.addEventListener("input", () => commit([{ kind: "text", at: state.at, value: text.value }], { merge: `text:${state.at?.join(".")}` }));
    text?.addEventListener("change", refreshInfo);
    container.querySelectorAll("[data-dir]").forEach((button) =>
      button.addEventListener("click", () => {
        setStyle("flex-direction", button.dataset.dir);
        refreshInfo();
      }),
    );
    container.querySelectorAll("[data-align]").forEach((button) =>
      button.addEventListener("click", () => {
        const [x, y] = button.dataset.align.split(":");
        const row = !String(state.info?.styles?.flexDirection).startsWith("column");
        const between = state.info?.styles?.justifyContent === "space-between";
        const ops = [{ kind: "style", at: state.at, prop: "align-items", value: row ? y : x }];
        if (!between) ops.push({ kind: "style", at: state.at, prop: "justify-content", value: row ? x : y });
        commit(ops);
        refreshInfo();
      }),
    );
    container.querySelector("[data-between]")?.addEventListener("click", () => {
      setStyle("justify-content", state.info?.styles?.justifyContent === "space-between" ? "start" : "space-between");
      refreshInfo();
    });
    container.querySelectorAll("[data-ta]").forEach((button) =>
      button.addEventListener("click", () => {
        setStyle("text-align", button.dataset.ta);
        refreshInfo();
      }),
    );
    container.querySelectorAll("[data-color]").forEach((button) => button.addEventListener("click", () => openPopover(button)));
  }

  function closePopover() {
    state.popover?.remove();
    state.popover = null;
  }

  function popoverList(filter) {
    const query = filter.trim().toLowerCase();
    const colors = state.tokens.filter((token) => token.color && (!query || token.name.toLowerCase().includes(query)));
    colors.sort((a, b) => Boolean(b.used) - Boolean(a.used));
    if (!colors.length) return `<p class="muted pe-pop-empty">${state.tokens.some((token) => token.color) ? t("No token with that name.") : t("The product defines no color tokens.")}</p>`;
    return colors
      .slice(0, 200)
      .map((token) => `<button type="button" class="pe-pop-tok" data-token="${escapeHtml(token.name)}"><i class="dv-swatch" style="background:${escapeHtml(token.color)}"></i><span class="mono pe-pop-name">${escapeHtml(token.name.replace(/^--/, ""))}</span><span class="mono muted">${escapeHtml(colorText(token.color))}</span></button>`)
      .join("");
  }

  function openPopover(anchor) {
    const prop = anchor.dataset.color;
    if (state.popover?.dataset.prop === prop) return closePopover();
    closePopover();
    const computed = prop === "color" ? state.info.styles.color : prop === "border-color" ? state.info.styles.borderTopColor : state.info.styles.backgroundColor;
    const rgb = parseRgb(computed);
    const hex = rgb ? rgbToHex(rgb) : "#FFFFFF";
    const pop = document.createElement("div");
    pop.className = "pe-pop";
    pop.dataset.prop = prop;
    pop.innerHTML = `<div class="pe-pop-head"><b>${prop === "color" ? t("Text color") : prop === "border-color" ? t("Border color") : t("Background color")}</b><button type="button" class="pe-link" data-clear>${t("Back to the original")}</button></div>
      <input class="pe-pop-search" type="search" placeholder="${t("Search tokens")}" autocomplete="off" spellcheck="false">
      <div class="pe-sub">${t("Product tokens")}</div>
      <div class="pe-pop-list">${popoverList("")}</div>
      <div class="pe-sub">${t("Custom color")}</div>
      <div class="pe-pop-free"><input type="color" value="${hex.toLowerCase()}" aria-label="${t("Pick a color")}"><input class="mono pe-pop-hex" value="${hex}" spellcheck="false" aria-label="Hex"></div>`;
    anchor.insertAdjacentElement("afterend", pop);
    state.popover = pop;
    const key = `${prop}:${state.at?.join(".")}`;
    const list = pop.querySelector(".pe-pop-list");
    const bind = () =>
      list.querySelectorAll("[data-token]").forEach((button) =>
        button.addEventListener("click", () => {
          setStyle(prop, `var(${button.dataset.token})`);
          closePopover();
          refreshInfo();
        }),
      );
    bind();
    pop.querySelector(".pe-pop-search").addEventListener("input", (event) => {
      list.innerHTML = popoverList(event.target.value);
      bind();
    });
    const picker = pop.querySelector('input[type="color"]');
    const hexInput = pop.querySelector(".pe-pop-hex");
    picker.addEventListener("input", () => {
      hexInput.value = picker.value.toUpperCase();
      setStyle(prop, picker.value, key);
    });
    picker.addEventListener("change", refreshInfo);
    hexInput.addEventListener("change", () => {
      const value = hexInput.value.trim();
      if (!/^#?[0-9a-f]{3,8}$/i.test(value)) return;
      setStyle(prop, value.startsWith("#") ? value : `#${value}`);
      refreshInfo();
    });
    pop.querySelector("[data-clear]").addEventListener("click", () => {
      setStyle(prop, "");
      closePopover();
      refreshInfo();
    });
    pop.scrollIntoView({ block: "nearest" });
    setTimeout(() => pop.querySelector(".pe-pop-search")?.focus({ preventScroll: true }), 0);
  }

  document.addEventListener("mousedown", (event) => {
    if (!state.popover) return;
    if (state.popover.contains(event.target) || event.target.closest?.("[data-color]")) return;
    closePopover();
  });

  function renderBar() {
    const count = state.history.count;
    const show = Boolean(state.model) && keyOf() === state.key && (count > 0 || state.history.canRedo);
    bar.hidden = !show;
    if (!show) return;
    const now = current();
    bar.innerHTML = `<span class="pe-bar-dot" aria-hidden="true"></span><span class="pe-bar-count">${count ? t(count === 1 ? "{n} unsaved change" : "{n} unsaved changes", { n: count }) : t("Nothing to save")}</span>
      <button type="button" class="icon-btn" data-bar="undo" title="${t("Undo (⌘Z)")}" aria-label="${t("Undo")}" ${count ? "" : "disabled"}>${svg("undo")}</button>
      <button type="button" class="icon-btn" data-bar="redo" title="${t("Redo (⌘⇧Z)")}" aria-label="${t("Redo")}" ${state.history.canRedo ? "" : "disabled"}>${svg("redo")}</button>
      <span class="vr"></span>
      <button type="button" class="btn sm" data-bar="discard" ${count ? "" : "disabled"}>${t("Discard")}</button>
      <button type="button" class="btn sm primary" data-bar="save" title="${escapeHtml(now ? targetText(now.screenId, now.version) : "")}" ${count ? "" : "disabled"}>${t("Save as a new version")}</button>`;
    bar.querySelector('[data-bar="undo"]').addEventListener("click", undo);
    bar.querySelector('[data-bar="redo"]').addEventListener("click", redo);
    bar.querySelector('[data-bar="discard"]').addEventListener("click", () => {
      discard();
      rerender();
    });
    bar.querySelector('[data-bar="save"]').addEventListener("click", save);
  }

  async function save() {
    const now = current();
    if (!now || !dirty() || !state.model) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
    const name = await ensureName();
    if (!name) return;
    bar.querySelectorAll("button").forEach((button) => (button.disabled = true));
    try {
      const saved = await post(`${base}/api/screens/${now.screenId}/edit`, { version: now.version, html: serializeScreen(state.model), by: name });
      state.history.clear();
      state.key = "";
      state.model = null;
      renderBar();
      await onSaved(saved);
    } catch (error) {
      toast(t("Could not save: {error}", { error: error.message }));
      renderBar();
    }
  }

  function onKey(name) {
    if (!state.model) return;
    if (name === "undo") return undo();
    if (name === "redo") return redo();
    if (name === "typing") return;
    if (state.at && actions[name]) actions[name]();
  }

  window.addEventListener("message", (event) => {
    if (!frames().some((frame) => frame.contentWindow === event.source)) return;
    const data = event.data ?? {};
    if (data.type === "sb-ready") {
      if (keyOf() !== state.key) return;
      const ops = state.history.applied().flatMap((entry) => entry.ops);
      if (ops.length) send({ type: "sb-edit-ops", ops });
      send({ type: "sb-edit", on: state.on && Boolean(state.model), scale: scale() });
      if (state.at && ops.length) send({ type: "sb-inspect-at", at: state.at });
    }
    if (data.type === "sb-edit-key" && typeof data.key === "string") onKey(data.key);
    if (data.type === "sb-edit-text" && Array.isArray(data.at) && typeof data.value === "string") {
      if (!matches({ at: data.at, tag: nodeAt(data.at)?.tagName.toLowerCase(), el: nodeAt(data.at)?.getAttribute("data-el") ?? null })) return;
      if (nodeAt(data.at).children.length) return;
      commit([{ kind: "text", at: data.at, value: data.value.slice(0, 5000) }], { select: data.at });
      refreshInfo();
    }
    if (data.type === "sb-edit-resize" && Array.isArray(data.at) && nodeAt(data.at)) {
      const ops = [];
      const size = (value) => typeof value === "string" && /^\d+(\.\d+)?px$/.test(value);
      if (size(data.width)) ops.push({ kind: "style", at: data.at, prop: "width", value: data.width });
      if (size(data.height)) ops.push({ kind: "style", at: data.at, prop: "height", value: data.height });
      commit(ops, { select: data.at });
      refreshInfo();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!state.model || keyOf() !== state.key || !current()) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const mod = event.metaKey || event.ctrlKey;
    let name = null;
    if (mod && event.key.toLowerCase() === "z") name = event.shiftKey ? "redo" : "undo";
    else if (mod && event.key.toLowerCase() === "y") name = "redo";
    else if (state.on && state.at && mod && event.key.toLowerCase() === "d") name = "duplicate";
    else if (state.on && state.at && mod && event.altKey && event.code === "KeyG") name = "wrap";
    else if (state.on && state.at && !mod && (event.key === "Backspace" || event.key === "Delete")) name = "delete";
    else if (state.on && state.at && event.altKey && event.key === "ArrowUp") name = "up";
    else if (state.on && state.at && event.altKey && event.key === "ArrowDown") name = "down";
    if (!name) return;
    event.preventDefault();
    event.stopPropagation();
    onKey(name);
  });

  return {
    setOn,
    picked,
    editable,
    reason,
    sectionsHtml,
    wire,
    leave,
    discard,
    get dirty() {
      return dirty();
    },
    set tokens(list) {
      state.tokens = Array.isArray(list) ? list : [];
    },
    renderBar,
  };
}
