import { existsSync } from "node:fs";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function chromePath() {
  if (process.env.SCREENBOOK_CHROME) return process.env.SCREENBOOK_CHROME;
  return CHROME_PATHS.find((path) => existsSync(path));
}

let browserPromise = null;

async function browser() {
  if (!browserPromise) {
    const { chromium } = await import("playwright-core");
    const executablePath = chromePath();
    browserPromise = chromium.launch(executablePath ? { executablePath } : { channel: "chrome" }).catch((error) => {
      browserPromise = null;
      throw new Error(
        `could not start Chrome to take the screenshot (${error.message.split("\n")[0]}). Set SCREENBOOK_CHROME to a Chrome or Chromium binary.`,
      );
    });
  }
  return browserPromise;
}

export async function screenshot(html, { width, height, fullPage = false } = {}) {
  const page = await (await browser()).newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    await page.evaluate(() => document.fonts?.ready);
    return await page.screenshot({ type: "png", fullPage });
  } finally {
    await page.close();
  }
}

export async function closeRenderer() {
  if (!browserPromise) return;
  const current = await browserPromise.catch(() => null);
  browserPromise = null;
  await current?.close();
}

function readPage(target) {
  const round = (value) => Math.round(value);
  const hex = (value) => {
    const match = String(value).match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (!match) return value;
    const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    if (alpha === 0) return "transparent";
    const code = `#${[match[1], match[2], match[3]].map((part) => Math.round(+part).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    return alpha < 1 ? `${code} ${Math.round(alpha * 100)}%` : code;
  };
  const visible = (node) => {
    const cs = getComputedStyle(node);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const boxOf = (node) => {
    const box = node.getBoundingClientRect();
    return { x: round(box.left + scrollX), y: round(box.top + scrollY), w: round(box.width), h: round(box.height) };
  };
  const labelOf = (node) => {
    const el = node.getAttribute("data-el");
    if (el) return el;
    const classes = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return node.tagName.toLowerCase() + (node.id ? `#${node.id}` : "") + (classes.length ? `.${classes.join(".")}` : "");
  };
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list = null;
    try {
      list = sheet.cssRules;
    } catch {
      list = null;
    }
    const walk = (items) => {
      for (const rule of items) {
        if (rule.cssRules && !rule.style) walk(rule.cssRules);
        else if (rule.style) rules.push(rule);
      }
    };
    if (list) walk(list);
  }
  const rootRule = (rule) => /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText || "");
  const rootStyle = getComputedStyle(document.documentElement);
  const declared = [];
  for (const rule of rules.filter(rootRule)) for (const prop of rule.style) if (prop.startsWith("--") && !declared.includes(prop)) declared.push(prop);
  const refs = (text) => (String(text).match(/var\(\s*--[\w-]+/g) || []).map((ref) => ref.replace(/var\(\s*/, ""));
  const tokenValue = (name) => {
    const value = rootStyle.getPropertyValue(name).trim();
    const probe = document.createElement("i");
    probe.style.color = value;
    if (!probe.style.color || /^(inherit|initial|unset|currentcolor|transparent)$/i.test(value)) return value.slice(0, 120);
    document.body.appendChild(probe);
    const color = hex(getComputedStyle(probe).color);
    probe.remove();
    return color === value.toUpperCase() ? value : `${value.slice(0, 80)} (${color})`;
  };
  const KEYS = ["display", "position", "flexDirection", "flexWrap", "justifyContent", "alignItems", "gap", "gridTemplateColumns", "padding", "margin", "width", "height", "backgroundColor", "backgroundImage", "color", "opacity", "border", "borderTop", "borderBottom", "borderLeft", "borderRight", "borderRadius", "boxShadow", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "textTransform", "whiteSpace", "overflow"];
  const DEFAULTS = { display: ["block", "inline"], position: ["static"], flexDirection: ["row"], flexWrap: ["nowrap"], justifyContent: ["normal"], alignItems: ["normal"], gap: ["normal"], gridTemplateColumns: ["none"], padding: ["0px"], margin: ["0px"], backgroundColor: ["rgba(0, 0, 0, 0)"], backgroundImage: ["none"], opacity: ["1"], borderRadius: ["0px"], boxShadow: ["none"], letterSpacing: ["normal"], textAlign: ["start"], textTransform: ["none"], whiteSpace: ["normal"], overflow: ["visible"] };
  const cssOf = (node, keys = KEYS) => {
    const cs = getComputedStyle(node);
    const out = {};
    for (const key of keys) {
      let value = cs[key];
      if (!value || DEFAULTS[key]?.includes(value)) continue;
      if (key.startsWith("border") && key !== "borderRadius" && /^0px/.test(value)) continue;
      if (/^border(Top|Bottom|Left|Right)$/.test(key) && cs.border && value === cs.border) continue;
      if (key === "fontFamily") value = value.split(",")[0].replace(/["']/g, "").trim();
      out[key] = String(value).replace(/rgba?\([^)]*\)/g, (color) => hex(color)).slice(0, 160);
    }
    return out;
  };
  if (target) {
    let node = null;
    try {
      node = document.querySelector(`[data-el="${CSS.escape(target)}"]`) || document.querySelector(target);
    } catch {
      node = null;
    }
    if (!node) {
      const pieces = [...new Set([...document.querySelectorAll("[data-el]")].map((item) => item.getAttribute("data-el")))];
      return { error: `no piece "${target}"`, pieces: pieces.slice(0, 150) };
    }
    const used = new Set();
    const matched = [];
    for (const rule of rules) {
      let hit = false;
      try {
        hit = !rootRule(rule) && node.matches(rule.selectorText);
      } catch {
        hit = false;
      }
      if (!hit) continue;
      matched.push(`${rule.selectorText} { ${rule.style.cssText.slice(0, 300)} }`);
      refs(rule.style.cssText).forEach((name) => used.add(name));
    }
    refs(node.getAttribute("style") || "").forEach((name) => used.add(name));
    const children = [...node.querySelectorAll("*")].filter((child) => child.hasAttribute("data-el") || child.parentElement === node).filter(visible).slice(0, 40);
    return {
      piece: labelOf(node),
      tag: node.tagName.toLowerCase(),
      box: boxOf(node),
      css: cssOf(node),
      tokens: Object.fromEntries([...used].map((name) => [name, tokenValue(name)])),
      rules: matched.slice(0, 20),
      inlineStyle: (node.getAttribute("style") || "").slice(0, 400) || null,
      text: (node.innerText || "").trim().replace(/\s+/g, " ").slice(0, 400),
      parent: node.parentElement ? labelOf(node.parentElement) : null,
      children: children.map((child) => ({ piece: labelOf(child), tag: child.tagName.toLowerCase(), box: boxOf(child), css: cssOf(child, ["display", "backgroundColor", "color", "fontSize", "fontWeight", "padding", "gap", "borderRadius", "border"]), text: (child.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60) })),
      html: node.outerHTML.slice(0, 2500),
    };
  }
  const used = new Set();
  for (const rule of rules) if (!rootRule(rule)) refs(rule.style.cssText).forEach((name) => used.add(name));
  document.querySelectorAll("[style]").forEach((node) => refs(node.getAttribute("style")).forEach((name) => used.add(name)));
  const colors = new Map();
  const fonts = new Map();
  const nodes = [...document.body.getElementsByTagName("*")].slice(0, 4000);
  for (const node of nodes) {
    if (["SCRIPT", "STYLE"].includes(node.tagName) || !visible(node)) continue;
    const cs = getComputedStyle(node);
    const add = (value, use) => {
      const code = hex(value);
      if (code === "transparent" || !code) return;
      const entry = colors.get(code) ?? { color: code, count: 0, uses: new Set() };
      entry.count += 1;
      entry.uses.add(use);
      colors.set(code, entry);
    };
    add(cs.backgroundColor, "background");
    if ([...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim())) {
      add(cs.color, "text");
      const key = `${cs.fontFamily.split(",")[0].replace(/["']/g, "").trim()} ${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`;
      const font = fonts.get(key) ?? { font: key, count: 0, sample: node.textContent.trim().slice(0, 40) };
      font.count += 1;
      fonts.set(key, font);
    }
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") add(cs.borderTopColor, "border");
  }
  const pieces = [...document.querySelectorAll("[data-el]")].filter(visible).slice(0, 140).map((node) => ({ piece: node.getAttribute("data-el"), tag: node.tagName.toLowerCase(), box: boxOf(node), text: (node.innerText || "").trim().replace(/\s+/g, " ").slice(0, 50) }));
  return {
    size: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    tokens: Object.fromEntries(declared.filter((name) => used.has(name)).slice(0, 120).map((name) => [name, tokenValue(name)])),
    unusedTokens: declared.filter((name) => !used.has(name)).slice(0, 60),
    colors: [...colors.values()].sort((a, b) => b.count - a.count).slice(0, 18).map((entry) => ({ color: entry.color, count: entry.count, uses: [...entry.uses] })),
    type: [...fonts.values()].sort((a, b) => b.count - a.count).slice(0, 14),
    pieces,
  };
}

export async function inspect(html, { width, height, el = null } = {}) {
  const page = await (await browser()).newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    await page.evaluate(() => document.fonts?.ready);
    return await page.evaluate(readPage, el);
  } finally {
    await page.close();
  }
}
