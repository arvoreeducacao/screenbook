import { copyText, cropPng, fileName, saveBlob } from "./export.js";
import { t } from "./i18n.js";

const px = (value) => parseFloat(value) || 0;
const trimNumber = (value) => String(Math.round(value * 100) / 100);

export function parseRgb(value) {
  const match = String(value ?? "").match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (!match) return null;
  let alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  alpha = Math.round(alpha * 100) / 100;
  return { r: Math.round(+match[1]), g: Math.round(+match[2]), b: Math.round(+match[3]), alpha };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

let probe = null;

export function readColor(value) {
  const direct = parseRgb(value);
  if (direct) return { hex: rgbToHex(direct), alpha: direct.alpha };
  if (typeof document === "undefined") return { hex: String(value), alpha: 1 };
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "rgba(0,0,0,0)";
  probe.fillStyle = String(value);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const alpha = Math.round((a / 255) * 100) / 100;
  if (!alpha) return { hex: t("transparent"), alpha: 0 };
  const unmix = (channel) => Math.min(255, Math.round(channel / (a / 255)));
  return { hex: rgbToHex({ r: unmix(r), g: unmix(g), b: unmix(b) }), alpha };
}

export function colorText(value) {
  const { hex, alpha } = readColor(value);
  return alpha < 1 && alpha > 0 ? `${hex} ${Math.round(alpha * 100)}%` : hex;
}

function cssColor(value) {
  const { hex, alpha } = readColor(value);
  if (alpha >= 1) return hex;
  const rgb = parseRgb(value);
  if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  return String(value);
}

export function box4(top, right, bottom, left) {
  const values = [top, right, bottom, left].map((value) => trimNumber(px(value)));
  if (values.every((value) => value === "0")) return null;
  const [t, r, b, l] = values.map((value) => (value === "0" ? "0" : `${value}px`));
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

function transparent(value) {
  return !value || value === "transparent" || /,\s*0\)$/.test(value) || /\/\s*0\)$/.test(value);
}

export function firstFamily(family) {
  return String(family ?? "").split(",")[0].trim().replace(/^["']|["']$/g, "");
}

export function cssFor(info, color = cssColor) {
  const s = info.styles;
  const lines = [];
  const add = (prop, value) => value !== null && value !== undefined && value !== "" && lines.push(`${prop}: ${value};`);
  add("width", `${trimNumber(info.box.w)}px`);
  add("height", `${trimNumber(info.box.h)}px`);
  if (s.display && !["block", "inline", "inline-block"].includes(s.display)) add("display", s.display);
  if (s.display?.includes("flex")) {
    if (s.flexDirection !== "row") add("flex-direction", s.flexDirection);
    if (s.flexWrap && s.flexWrap !== "nowrap") add("flex-wrap", s.flexWrap);
    if (s.justifyContent && !["normal", "flex-start", "start"].includes(s.justifyContent)) add("justify-content", s.justifyContent);
    if (s.alignItems && !["normal", "stretch"].includes(s.alignItems)) add("align-items", s.alignItems);
  }
  if (s.display?.includes("grid") && s.gridTemplateColumns && s.gridTemplateColumns !== "none") add("grid-template-columns", s.gridTemplateColumns);
  if ((s.display?.includes("flex") || s.display?.includes("grid")) && s.gap && s.gap !== "normal" && px(s.gap)) add("gap", s.gap);
  add("padding", box4(s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft));
  add("margin", box4(s.marginTop, s.marginRight, s.marginBottom, s.marginLeft));
  if (!transparent(s.backgroundColor)) add("background", color(s.backgroundColor));
  if (s.backgroundImage && s.backgroundImage !== "none") add("background-image", s.backgroundImage);
  const widths = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(px);
  if (widths.some(Boolean) && s.borderTopStyle !== "none") {
    const same = widths.every((width) => width === widths[0]) && [s.borderRightColor, s.borderBottomColor, s.borderLeftColor].every((value) => value === s.borderTopColor);
    if (same) add("border", `${trimNumber(widths[0])}px ${s.borderTopStyle} ${color(s.borderTopColor)}`);
    else {
      const sides = [["top", s.borderTopColor], ["right", s.borderRightColor], ["bottom", s.borderBottomColor], ["left", s.borderLeftColor]];
      sides.forEach(([side, sideColor], index) => widths[index] && add(`border-${side}`, `${trimNumber(widths[index])}px ${s.borderTopStyle} ${color(sideColor)}`));
    }
  }
  add("border-radius", box4(s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius));
  if (s.boxShadow && s.boxShadow !== "none") add("box-shadow", s.boxShadow);
  if (s.opacity && s.opacity !== "1") add("opacity", s.opacity);
  if (info.ownText) {
    add("color", color(s.color));
    add("font-family", s.fontFamily);
    add("font-size", s.fontSize);
    if (s.fontWeight && s.fontWeight !== "400") add("font-weight", s.fontWeight);
    if (s.fontStyle && s.fontStyle !== "normal") add("font-style", s.fontStyle);
    if (s.lineHeight && s.lineHeight !== "normal") add("line-height", s.lineHeight);
    if (s.letterSpacing && s.letterSpacing !== "normal" && px(s.letterSpacing)) add("letter-spacing", s.letterSpacing);
    if (s.textAlign && !["start", "left"].includes(s.textAlign)) add("text-align", s.textAlign);
    if (s.textTransform && s.textTransform !== "none") add("text-transform", s.textTransform);
    if (s.textDecorationLine && s.textDecorationLine !== "none") add("text-decoration", s.textDecorationLine);
  }
  return lines.join("\n");
}

export function tokensByColor(tokens) {
  const map = new Map();
  for (const token of tokens ?? []) {
    if (!token.color) continue;
    const key = colorText(token.color);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(token);
  }
  for (const list of map.values()) list.sort((a, b) => (b.used === "direct") - (a.used === "direct") || a.name.length - b.name.length);
  return map;
}

export function fontLine(font) {
  const size = trimNumber(px(font.size));
  const lineHeight = font.lineHeight === "normal" ? "auto" : trimNumber(px(font.lineHeight));
  return `${firstFamily(font.family)} · ${size}/${lineHeight} · ${font.weight}${font.style === "italic" ? ` ${t("italic")}` : ""}`;
}

export function visibleTokens(tokens, filter) {
  const list = (tokens ?? []).filter((token) => (filter === "all" ? true : Boolean(token.used)));
  return [...list.filter((token) => token.color), ...list.filter((token) => !token.color)];
}

const USES = { fundo: "background", texto: "text", borda: "border", "ícone": "icon" };

const COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';

export function createInspector({ frames, current, base, escapeHtml, toast, onEscape, editing = null }) {
  const state = { on: false, info: null, infoKey: "", styles: new Map(), asked: new Set(), code: "css", tokens: "used", container: null };

  function key() {
    const now = current();
    return now ? `${now.screenId}/v${now.version}` : "";
  }

  function post(message) {
    for (const frame of frames()) frame.contentWindow?.postMessage(message, "*");
  }

  function askStyles() {
    const id = key();
    if (!id || state.styles.has(id) || state.asked.has(id)) return;
    state.asked.add(id);
    post({ type: "sb-styles", id });
  }

  function setOn(on) {
    if (state.on === on) return;
    state.on = on;
    if (!on) state.info = null;
    post({ type: "sb-inspect", on });
    if (on) askStyles();
    editing?.setOn(on);
  }

  function reset() {
    state.info = null;
  }

  function colorRow(value, extra, tokenMap, attrs = "") {
    const text = colorText(value);
    const tokens = tokenMap.get(text) ?? [];
    return `<button type="button" class="dv-color" data-copy="${escapeHtml(text.split(" ")[0])}" ${attrs}><i class="dv-swatch" style="background:${escapeHtml(value)}"></i><span class="mono">${escapeHtml(text)}</span>${
      tokens.length ? `<span class="dv-token" title="${escapeHtml(tokens.map((token) => token.name).join(", "))}">${escapeHtml(tokens[0].name)}</span>` : ""
    }<span class="muted grow dv-right">${extra}</span></button>`;
  }

  function stylesHtml(styles) {
    if (!styles) return `<div class="head"><b>${t("Screen styles")}</b></div><p class="hint">${t("Reading the screen…")}</p>`;
    const tokenMap = tokensByColor(styles.tokens);
    const tokens = visibleTokens(styles.tokens, state.tokens);
    const used = styles.tokens.filter((token) => token.used).length;
    return `<div class="head"><b>${t("Screen styles")}</b><span class="tag plain">${styles.size.w} × ${styles.size.h}</span></div>
      <p class="hint">${t("Click a piece to see its measurements and code. Hold <kbd>Alt</kbd> over another piece to measure the distance.")}</p>
      <div class="dv-scroll">
        <section class="dv-group"><div class="ed-label">${t("Colors")} <span class="dv-n">${styles.colors.length}</span></div>
          ${styles.colors.map((color) => colorRow(color.value, `${escapeHtml(color.uses.map((use) => t(USES[use] ?? use)).join(" · "))} <span class="dv-n">${color.count}</span>`, tokenMap, `data-hl-color="${escapeHtml(color.value)}"`)).join("") || `<p class="muted">${t("No colors.")}</p>`}
        </section>
        <section class="dv-group"><div class="ed-label">${t("Typography")} <span class="dv-n">${styles.fonts.length}</span></div>
          ${styles.fonts
            .map(
              (font) => `<button type="button" class="dv-font" data-copy="${escapeHtml(`font-family: ${font.family};\nfont-size: ${font.size};\nfont-weight: ${font.weight};\nline-height: ${font.lineHeight};`)}" data-hl-font="${escapeHtml([font.family, font.size, font.weight, font.lineHeight].join("|"))}"><span class="dv-font-name">${escapeHtml(fontLine(font))}<span class="dv-n">${font.count}</span></span><span class="dv-sample">${escapeHtml(font.sample)}</span></button>`,
            )
            .join("") || `<p class="muted">${t("No text.")}</p>`}
        </section>
        <section class="dv-group"><div class="ed-label dv-label-row"><span>Tokens <span class="dv-n">${state.tokens === "all" ? styles.tokens.length : used}</span></span>${
          styles.tokens.length
            ? `<span class="seg dv-seg"><button type="button" data-tokens="used" class="${state.tokens === "used" ? "on" : ""}">${t("Used")}</button><button type="button" data-tokens="all" class="${state.tokens === "all" ? "on" : ""}">${t("All")}</button></span>`
            : ""
        }</div>
          ${
            tokens
              .map(
                (token) => `<button type="button" class="dv-tok" data-copy="var(${escapeHtml(token.name)})" title="${escapeHtml(token.source || token.value)}">${
                  token.color ? `<i class="dv-swatch" style="background:${escapeHtml(token.color)}"></i>` : '<i class="dv-swatch none"></i>'
                }<span class="mono dv-tok-name">${escapeHtml(token.name)}</span><span class="mono muted dv-tok-value">${escapeHtml(token.color ? colorText(token.color) : token.value)}</span></button>`,
              )
              .join("") || `<p class="muted">${styles.tokens.length ? t("No tokens used by this screen.") : t("The product defines no CSS variables.")}</p>`
          }
        </section>
      </div>`;
  }

  function boxModel(info) {
    const s = info.styles;
    const n = (value) => {
      const number = trimNumber(px(value));
      return `<i class="${number === "0" ? "zero" : ""}">${number === "0" ? "–" : number}</i>`;
    };
    const ring = (kind, label, [t, r, b, l], inner) =>
      `<div class="dv-bm ${kind}"><span class="dv-bm-label">${label}</span><span class="t">${n(t)}</span><span class="r">${n(r)}</span><span class="b">${n(b)}</span><span class="l">${n(l)}</span>${inner}</div>`;
    const content = `<div class="dv-bm content">${trimNumber(info.box.w - px(s.paddingLeft) - px(s.paddingRight) - px(s.borderLeftWidth) - px(s.borderRightWidth))} × ${trimNumber(
      info.box.h - px(s.paddingTop) - px(s.paddingBottom) - px(s.borderTopWidth) - px(s.borderBottomWidth),
    )}</div>`;
    return ring(
      "margin",
      t("margin"),
      [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft],
      ring("border", t("border"), [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], ring("padding", t("padding"), [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], content)),
    );
  }

  function kv(label, value, copy = value) {
    return `<button type="button" class="dv-kv" data-copy="${escapeHtml(copy)}"><span class="muted">${label}</span><span class="mono">${escapeHtml(value)}</span></button>`;
  }

  function propsHtml(info, styles) {
    const s = info.styles;
    const tokenMap = tokensByColor(styles?.tokens);
    const path = info.path.slice(-5);
    const layout = [];
    if (s.display?.includes("flex")) layout.push(kv("Layout", `flex ${s.flexDirection === "column" ? "vertical" : "horizontal"}`, `display: flex;\nflex-direction: ${s.flexDirection};`));
    else if (s.display?.includes("grid")) layout.push(kv("Layout", "grid", `display: grid;\ngrid-template-columns: ${s.gridTemplateColumns};`));
    if ((s.display?.includes("flex") || s.display?.includes("grid")) && px(s.gap)) layout.push(kv(t("Gap"), `${trimNumber(px(s.gap))}`, `gap: ${s.gap};`));
    if (s.display?.includes("flex") && s.alignItems !== "normal") layout.push(kv(t("Align"), s.alignItems));
    if (s.display?.includes("flex") && s.justifyContent !== "normal") layout.push(kv(t("Distribute"), s.justifyContent));
    const colors = [];
    if (!transparent(s.backgroundColor)) colors.push(colorRow(s.backgroundColor, t("background"), tokenMap));
    if (info.ownText) colors.push(colorRow(s.color, t("text"), tokenMap));
    if (px(s.borderTopWidth) && s.borderTopStyle !== "none") colors.push(colorRow(s.borderTopColor, t("border {n}", { n: trimNumber(px(s.borderTopWidth)) }), tokenMap));
    const radius = box4(s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius);
    const css = cssFor(info);
    const edit = editing?.editable(info) ? editing.sectionsHtml(info) : null;
    const note = edit ? null : editing?.reason(info);
    return `<div class="head dv-head"><button type="button" class="icon-btn dv-back" data-action="clear" title="${t("Screen styles")}" aria-label="${t("Back to the screen styles")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button><b class="dv-title">${escapeHtml(info.label)}</b><span class="tag plain">${escapeHtml(info.tag)}</span></div>
      <nav class="dv-path">${path
        .map((item) => `<button type="button" data-depth="${item.depth}" class="${item.depth === info.depth ? "on" : ""}">${escapeHtml(item.label)}</button>`)
        .join('<span class="muted">›</span>')}</nav>
      ${edit ? edit.actions : ""}
      <div class="dv-scroll">
        ${note ? `<p class="ed-note dv-note">${escapeHtml(note)}</p>` : ""}
        ${edit ? edit.sections : `        <section class="dv-group"><div class="ed-label">${t("Measurements")}</div>
          <div class="dv-grid">${kv(t("W"), trimNumber(info.box.w), `width: ${trimNumber(info.box.w)}px;`)}${kv(t("H"), trimNumber(info.box.h), `height: ${trimNumber(info.box.h)}px;`)}${kv("X", trimNumber(info.box.x))}${kv("Y", trimNumber(info.box.y))}</div>
          ${boxModel(info)}
          ${layout.length ? `<div class="dv-grid">${layout.join("")}</div>` : ""}
        </section>
        ${colors.length ? `<section class="dv-group"><div class="ed-label">${t("Colors")}</div>${colors.join("")}</section>` : ""}
        ${
          info.ownText
            ? `<section class="dv-group"><div class="ed-label">${t("Typography")}</div><div class="dv-grid">${kv(t("Font"), firstFamily(s.fontFamily), `font-family: ${s.fontFamily};`)}${kv(t("Weight"), s.fontWeight)}${kv(t("Size"), trimNumber(px(s.fontSize)), `font-size: ${s.fontSize};`)}${kv(
                t("Line height"),
                s.lineHeight === "normal" ? "auto" : trimNumber(px(s.lineHeight)),
                `line-height: ${s.lineHeight};`,
              )}${s.letterSpacing !== "normal" && px(s.letterSpacing) ? kv(t("Letter spacing"), s.letterSpacing) : ""}${s.textAlign && !["start", "left"].includes(s.textAlign) ? kv(t("Alignment"), s.textAlign) : ""}</div></section>`
            : ""
        }
        ${
          radius || (s.boxShadow && s.boxShadow !== "none") || s.opacity !== "1"
            ? `<section class="dv-group"><div class="ed-label">${t("Appearance")}</div><div class="dv-grid">${radius ? kv(t("Corners"), radius.replaceAll("px", ""), `border-radius: ${radius};`) : ""}${s.opacity !== "1" ? kv(t("Opacity"), `${Math.round(px(s.opacity) * 100)}%`, `opacity: ${s.opacity};`) : ""}</div>${
                s.boxShadow && s.boxShadow !== "none" ? `<button type="button" class="dv-kv dv-wide" data-copy="box-shadow: ${escapeHtml(s.boxShadow)};"><span class="muted">${t("Shadow")}</span><span class="mono">${escapeHtml(s.boxShadow)}</span></button>` : ""
              }</section>`
            : ""
        }`}
        <section class="dv-group"><div class="ed-label dv-label-row"><span class="seg dv-seg"><button type="button" data-code="css" class="${state.code === "css" ? "on" : ""}">CSS</button><button type="button" data-code="html" class="${
          state.code === "html" ? "on" : ""
        }">HTML</button></span><button type="button" class="btn sm" data-action="copy-code">${COPY}${t("Copy")}</button></div>
          <pre class="dv-code"><code>${escapeHtml(state.code === "css" ? css : info.html)}</code></pre>
          ${state.code === "html" && info.truncated ? `<p class="ed-note">${t("The HTML is too large and was cut.")}</p>` : ""}
        </section>
        <section class="dv-group"><div class="ed-label">${t("Export")}</div><div class="row dv-actions"><button type="button" class="btn sm" data-action="png">${t("Piece as PNG")}</button></div></section>
      </div>`;
  }

  function render(container = state.container) {
    if (!container) return;
    state.container = container;
    if (state.info && state.infoKey !== key()) state.info = null;
    const styles = state.styles.get(key()) ?? null;
    if (editing) editing.tokens = styles?.tokens;
    const active = container.contains(document.activeElement) ? document.activeElement : null;
    const field = active?.dataset?.field ?? null;
    const caret = field && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = container.querySelector(".dv-scroll")?.scrollTop ?? 0;
    container.innerHTML = state.info ? propsHtml(state.info, styles) : stylesHtml(styles);
    wire(container);
    if (state.info && editing?.editable(state.info)) editing.wire(container);
    const scroller = container.querySelector(".dv-scroll");
    if (scroller) scroller.scrollTop = scroll;
    const again = field ? container.querySelector(`[data-field="${CSS.escape(field)}"]`) : null;
    if (again) {
      again.focus();
      if (caret) again.setSelectionRange?.(caret[0], caret[1]);
    }
  }

  async function copy(text, label = t("Copied")) {
    if (await copyText(text)) toast(`${label}.`);
  }

  function wire(container) {
    container.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => copy(button.dataset.copy, t("Copied: {value}", { value: button.dataset.copy.split("\n")[0] }))));
    container.querySelectorAll("[data-hl-color], [data-hl-font]").forEach((button) => {
      button.addEventListener("mouseenter", () => post({ type: "sb-highlight", color: button.dataset.hlColor ?? null, font: button.dataset.hlFont ?? null }));
      button.addEventListener("mouseleave", () => post({ type: "sb-highlight" }));
    });
    container.querySelectorAll("[data-tokens]").forEach((button) =>
      button.addEventListener("click", () => {
        state.tokens = button.dataset.tokens;
        render();
      }),
    );
    container.querySelectorAll("[data-code]").forEach((button) =>
      button.addEventListener("click", () => {
        state.code = button.dataset.code;
        render();
      }),
    );
    container.querySelectorAll("[data-depth]").forEach((button) => button.addEventListener("click", () => post({ type: "sb-inspect-depth", depth: Number(button.dataset.depth) })));
    container.querySelector('[data-action="clear"]')?.addEventListener("click", () => post({ type: "sb-inspect-clear" }));
    container.querySelector('[data-action="copy-code"]')?.addEventListener("click", () => copy(state.code === "css" ? cssFor(state.info) : state.info.html, state.code === "css" ? t("CSS copied") : t("HTML copied")));
    container.querySelector('[data-action="png"]')?.addEventListener("click", exportPiece);
  }

  async function exportPiece() {
    const now = current();
    if (!now || !state.info) return;
    const blob = await cropPng(`${base}/api/screens/${now.screenId}/v${now.version}.png`, state.info.box);
    if (!blob) return toast(t("This version has no picture yet. Ask the chat to take a screenshot of the screen."));
    saveBlob(blob, fileName(now.screenId, now.version, state.info.el ?? state.info.label));
  }

  function fromOverlay(source) {
    return frames().some((frame) => frame.contentWindow === source);
  }

  window.addEventListener("message", (event) => {
    if (!fromOverlay(event.source)) return;
    const data = event.data ?? {};
    if (data.type === "sb-ready" && state.on) {
      state.asked.delete(key());
      post({ type: "sb-inspect", on: true });
      askStyles();
    }
    if (data.type === "sb-styles" && typeof data.id === "string" && data.styles && typeof data.styles === "object") {
      state.styles.set(data.id, {
        colors: Array.isArray(data.styles.colors) ? data.styles.colors : [],
        fonts: Array.isArray(data.styles.fonts) ? data.styles.fonts : [],
        tokens: Array.isArray(data.styles.tokens) ? data.styles.tokens : [],
        size: data.styles.size ?? { w: 0, h: 0 },
      });
      if (state.on && data.id === key()) render();
    }
    if (data.type === "sb-inspect-pick" && state.on) {
      state.info = data.info && typeof data.info === "object" && data.info.styles && data.info.box ? data.info : null;
      state.infoKey = key();
      editing?.picked(state.info);
      render();
    }
    if (data.type === "sb-key" && state.on) {
      if (data.key === "Escape") {
        if (state.info) post({ type: "sb-inspect-clear" });
        else onEscape?.();
      }
    }
  });

  const altKey = (event) => {
    if (!state.on || event.key !== "Alt") return;
    if (event.target.closest?.("input, textarea")) return;
    event.preventDefault();
    post({ type: "sb-inspect-alt", on: event.type === "keydown" });
  };
  document.addEventListener("keydown", altKey);
  document.addEventListener("keyup", altKey);
  window.addEventListener("blur", () => state.on && post({ type: "sb-inspect-alt", on: false }));

  return {
    setOn,
    reset,
    render,
    get on() {
      return state.on;
    },
    get selected() {
      return Boolean(state.info);
    },
    clear: () => post({ type: "sb-inspect-clear" }),
  };
}
