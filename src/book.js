import { randomBytes, randomUUID } from "node:crypto";
import { showsVersion } from "../viewer/proposal.js";
import { isAnnotation, splitAnnotations } from "../viewer/annotations.js";
import { arrange, baseOf } from "../viewer/arrange.js";
import { homePage, isBoard, pagesOf } from "../viewer/pages.js";
import { translate } from "../viewer/i18n.js";
import { emptyBoard, expandOps, nearFilter, summarize } from "../viewer/board-model.js";

export const DESKTOP = { width: 1280, height: 800 };
export const MOBILE = { width: 375, height: 812 };

export function slug(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function mentionsIn(text) {
  return [...new Set([...String(text).matchAll(/(?:^|[^\w@])@([a-z][\w-]*)/gi)].map((match) => match[1].toLowerCase()))];
}

export function chatMentionsIn(text, people = new Set()) {
  return mentionsIn(text).filter((handle) => !people.has(handle));
}

const REPEAT_WINDOW_MS = 15000;
export const STICKY_COLORS = ["yellow", "pink", "green", "blue"];
const SHARE_DAYS = 30;
const GUIDE_LIMIT = 12000;
const SHARE_TOKEN = /^[\w-]{16,64}$/;

const PART_TAG = /<sb-part\b([^>]*?)\s*(?:\/>|>\s*<\/sb-part>)/g;
const PART_ATTR = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function partRefs(html) {
  const refs = [];
  for (const match of String(html ?? "").matchAll(PART_TAG)) {
    const attrs = {};
    for (const [, key, double, single] of match[1].matchAll(PART_ATTR)) attrs[key.toLowerCase()] = double ?? single ?? "";
    if (attrs.name && slug(attrs.name)) refs.push({ name: slug(attrs.name), attrs });
  }
  return refs;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function partTag(name, attrs = {}) {
  const extra = Object.entries(attrs).filter(([key]) => key !== "name");
  return `<sb-part name="${name}"${extra.map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join("")}></sb-part>`;
}

function placePart(id, version, content, attrs) {
  const extra = Object.entries(attrs).filter(([key]) => key !== "name");
  const body = extra.length
    ? `<div data-sb-part="${id}" ${extra.map(([key, value]) => `${key.startsWith("data-") ? key : `data-${key}`}="${escapeAttr(value)}"`).join(" ")} style="display:contents">${content}</div>`
    : content;
  return `<!--sb-part ${id} v${version}-->${body}<!--/sb-part ${id}-->`;
}

function newId() {
  return randomUUID().slice(0, 8);
}

function now() {
  return new Date().toISOString();
}

function pointOf(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const clamp = (value) => Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000;
  return { x: clamp(x), y: clamp(y) };
}

function piecesOf(els) {
  if (!Array.isArray(els)) return null;
  const names = [...new Set(els.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()))].slice(0, 20);
  return names.length ? names : null;
}

function parseLines(buffer) {
  if (!buffer) return [];
  return buffer
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function textOf(html) {
  return String(html)
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

function wordsOf(text) {
  return new Set(
    String(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1),
  );
}

export class Book {
  constructor(store) {
    this.store = store;
  }

  saving(message, work) {
    return this.store.transaction ? this.store.transaction(message, work) : work();
  }

  async readJson(path, fallback = null) {
    const buffer = await this.store.read(path);
    return buffer ? JSON.parse(buffer.toString("utf8")) : fallback;
  }

  async writeJson(path, value) {
    await this.store.write(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async project() {
    return this.readJson("project.json", { name: "Untitled", sections: [] });
  }

  async init({ name }) {
    return this.saving(`created the project ${name}`, async () => {
      const existing = await this.readJson("project.json");
      if (existing) return existing;
      const project = { name, sections: [], createdAt: now() };
      await this.writeJson("project.json", project);
      return project;
    });
  }

  async ensureSection(name) {
    const project = await this.project();
    const id = slug(name);
    if (!project.sections.some((section) => section.id === id)) {
      project.sections.push({ id, name });
      await this.writeJson("project.json", project);
    }
    return id;
  }

  async savePages(project, pages) {
    project.pages = pages.map(({ id, name, kind, sections }) => (kind === "board" ? { id, name, kind, sections: [] } : { id, name, sections }));
    await this.writeJson("project.json", project);
    return project.pages;
  }

  async createPage({ name, kind, by = "agent" }) {
    const clean = String(name ?? "").trim().slice(0, 60);
    if (!clean) throw new Error("a page needs a name");
    return this.saving(`${by} created the page ${clean}`, async () => {
      const project = await this.project();
      const pages = pagesOf(project);
      const base = slug(clean) || "page";
      let id = base;
      for (let n = 2; pages.some((page) => page.id === id); n++) id = `${base}-${n}`;
      const board = kind === "board";
      pages.push({ id, name: clean, ...(board ? { kind: "board" } : {}), sections: [] });
      await this.savePages(project, pages);
      return { id, name: clean, ...(board ? { kind: "board" } : {}), pages: project.pages };
    });
  }

  async updatePage({ page, name, index, by = "agent" }) {
    return this.saving(`${by} changed the page ${page}`, async () => {
      const project = await this.project();
      const pages = pagesOf(project);
      const at = pages.findIndex((entry) => entry.id === page);
      if (at < 0) throw new Error(`no page called "${page}"`);
      if (name !== undefined) {
        const clean = String(name).trim().slice(0, 60);
        if (!clean) throw new Error("a page needs a name");
        pages[at].name = clean;
      }
      if (index !== undefined) {
        const [moving] = pages.splice(at, 1);
        pages.splice(Math.max(0, Math.min(pages.length, Number(index) || 0)), 0, moving);
      }
      return { pages: await this.savePages(project, pages) };
    });
  }

  async deletePage({ page, by = "agent" }) {
    return this.saving(`${by} deleted the page ${page}`, async () => {
      const project = await this.project();
      const pages = pagesOf(project);
      const at = pages.findIndex((entry) => entry.id === page);
      if (at < 0) throw new Error(`no page called "${page}"`);
      if (pages.length === 1) throw new Error("the last page cannot be deleted");
      if (!isBoard(pages[at]) && !pages.some((entry, index) => index !== at && !isBoard(entry))) throw new Error("the last page of screens cannot be deleted");
      const [gone] = pages.splice(at, 1);
      const heir = isBoard(gone) ? pages[Math.max(0, at - 1)] : (pages.slice(0, at).reverse().find((entry) => !isBoard(entry)) ?? homePage(pages));
      if (!isBoard(heir)) heir.sections = [...heir.sections, ...gone.sections];
      return { pages: await this.savePages(project, pages), movedTo: heir.id };
    });
  }

  async moveSection({ section, page, by = "agent" }) {
    return this.saving(`${by} moved the section ${section} to the page ${page}`, async () => {
      const project = await this.project();
      if (!project.sections.some((entry) => entry.id === section)) throw new Error(`no section called "${section}"`);
      const pages = pagesOf(project);
      const target = pages.find((entry) => entry.id === page);
      if (!target) throw new Error(`no page called "${page}"`);
      if (isBoard(target)) throw new Error(`"${target.name}" is a board: screens live on pages of screens`);
      for (const entry of pages) entry.sections = entry.sections.filter((id) => id !== section);
      target.sections.push(section);
      return { pages: await this.savePages(project, pages) };
    });
  }

  async boardPage(page) {
    const pages = pagesOf(await this.project());
    const found = pages.find((entry) => entry.id === page) ?? pages.find((entry) => entry.name.toLowerCase() === String(page ?? "").toLowerCase());
    if (!found) {
      const boards = pages.filter(isBoard).map((entry) => `${entry.id} (${entry.name})`);
      throw new Error(`no board called "${page}"; boards: ${boards.join(", ") || "none yet, create one"}`);
    }
    if (!isBoard(found)) throw new Error(`"${found.name}" is a page of screens, not a board`);
    return found;
  }

  async boards() {
    return pagesOf(await this.project()).filter(isBoard).map(({ id, name }) => ({ id, name }));
  }

  async board(page) {
    const found = await this.boardPage(page);
    const board = await this.readJson(`boards/${found.id}.json`, emptyBoard());
    return { page: found.id, name: found.name, ...board };
  }

  async boardSummary({ page, section, near } = {}) {
    const board = await this.board(page);
    return { page: board.page, name: board.name, ...summarize(nearFilter(board, { section, near })) };
  }

  async applyBoard({ page, ops, by = "agent" }) {
    return this.saving(`${by} mexeu no quadro ${page}`, async () => {
      const found = await this.boardPage(page);
      const path = `boards/${found.id}.json`;
      const board = await this.readJson(path, emptyBoard());
      const { items, ops: applied, refs } = expandOps(board, ops, { by });
      if (!applied.length) return { page: found.id, rev: board.rev, ops: [], refs };
      const saved = { rev: board.rev + 1, items };
      await this.store.write(path, `${JSON.stringify(saved)}\n`);
      return { page: found.id, rev: saved.rev, ops: applied, refs };
    });
  }

  async stickies() {
    return this.readJson("stickies.json", []);
  }

  stickyFields(sticky, input) {
    if (input.text !== undefined) sticky.text = String(input.text).slice(0, 2000);
    if (input.color !== undefined) sticky.color = STICKY_COLORS.includes(input.color) ? input.color : STICKY_COLORS[0];
    if (input.page !== undefined) sticky.page = input.page ? String(input.page) : null;
    if (input.section !== undefined) sticky.section = input.section ? String(input.section) : null;
    for (const axis of ["x", "y"]) {
      if (input[axis] === undefined) continue;
      const value = Number(input[axis]);
      if (!Number.isFinite(value)) throw new Error(`${axis} must be a number`);
      sticky[axis] = Math.round(value);
    }
    return sticky;
  }

  async addSticky({ by = "agent", ...input }) {
    return this.saving(`${by} added a sticky note`, async () => {
      const list = await this.stickies();
      const sticky = this.stickyFields({ id: newId(), text: "", color: STICKY_COLORS[0], page: null, section: null, x: 0, y: 0, by, at: now() }, input);
      list.push(sticky);
      await this.writeJson("stickies.json", list);
      return sticky;
    });
  }

  async updateSticky({ id, by = "agent", ...input }) {
    return this.saving(`${by} changed a sticky note`, async () => {
      const list = await this.stickies();
      const sticky = list.find((entry) => entry.id === id);
      if (!sticky) throw new Error(`no sticky called "${id}"`);
      this.stickyFields(sticky, input);
      sticky.editedBy = by;
      sticky.editedAt = now();
      await this.writeJson("stickies.json", list);
      return sticky;
    });
  }

  async removeSticky({ id, by = "agent" }) {
    return this.saving(`${by} removed a sticky note`, async () => {
      const list = await this.stickies();
      if (!list.some((entry) => entry.id === id)) throw new Error(`no sticky called "${id}"`);
      await this.writeJson("stickies.json", list.filter((entry) => entry.id !== id));
      return { removed: id };
    });
  }

  async screens() {
    const paths = await this.store.list("screens");
    const metas = await Promise.all(
      paths.filter((path) => path.endsWith("/meta.json")).map((path) => this.readJson(path)),
    );
    return metas
      .filter(Boolean)
      .sort((a, b) => String(a.versions[0]?.at ?? "").localeCompare(String(b.versions[0]?.at ?? "")) || a.id.localeCompare(b.id))
      .map((meta, index) => ({ ...meta, number: index + 1 }));
  }

  async screen(id) {
    const meta = await this.readJson(`screens/${id}/meta.json`);
    if (!meta) throw new Error(`no screen called "${id}"`);
    return meta;
  }

  async screenHtml(id, version) {
    const buffer = await this.store.read(`screens/${id}/v${version}.html`);
    if (!buffer) throw new Error(`screen "${id}" has no version ${version}`);
    return buffer.toString("utf8");
  }

  follows(meta, entry) {
    return Boolean(entry) && entry.v === meta.versions.at(-1)?.v && meta.official !== entry.v && !meta.archived;
  }

  async bodyHtml(id, version) {
    const source = await this.screenHtml(id, version);
    if (!partRefs(source).length) return source;
    const meta = await this.readJson(`screens/${id}/meta.json`);
    const entry = meta?.versions.find((item) => item.v === version);
    return this.expandParts(source, entry && !this.follows(meta, entry) ? (entry.parts ?? {}) : {});
  }

  async composedHtml(id, version) {
    const project = await this.project();
    const head = project.head ? ((await this.store.read(project.head))?.toString("utf8") ?? "") : "";
    const body = await this.bodyHtml(id, version);
    if (/<html[\s>]/i.test(body)) {
      return head && /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (tag) => `${tag}\n${head}`) : body;
    }
    return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n${head}\n</head><body>\n${body}\n</body></html>\n`;
  }

  latest(meta, proposal) {
    const versions = meta.versions.filter((entry) => (proposal ? entry.proposal === proposal : true));
    return versions.at(-1)?.v ?? null;
  }

  async parts() {
    const paths = await this.store.list("parts");
    const ids = new Set();
    for (const path of paths) {
      const rest = path.slice("parts/".length);
      if (/^[\w-]+\.html$/.test(rest)) ids.add(rest.slice(0, -".html".length));
      else if (/^[\w-]+\/meta\.json$/.test(rest)) ids.add(rest.split("/")[0]);
    }
    return [...ids].sort();
  }

  async partMeta(name) {
    const id = slug(name);
    if (!id) return null;
    const meta = await this.readJson(`parts/${id}/meta.json`);
    if (meta) return meta;
    const legacy = await this.store.read(`parts/${id}.html`);
    return legacy ? { id, name: id, legacy: true, versions: [{ v: 1, at: null, by: null }] } : null;
  }

  async partHtml(name, version) {
    const id = slug(name);
    const buffer = (await this.store.read(`parts/${id}/v${version}.html`)) ?? (version === 1 ? await this.store.read(`parts/${id}.html`) : null);
    if (!buffer) throw new Error(`part "${id}" has no version ${version}`);
    return buffer.toString("utf8");
  }

  async writePart(name, html, { by = "agent", note = null } = {}) {
    return this.saving((saved) => `${by} saved the part ${saved?.part} v${saved?.version}`, async () => {
      const id = slug(name);
      if (!id) throw new Error("a part needs a name");
      if (!html?.trim()) throw new Error("html is empty");
      if (partRefs(html).length) throw new Error("a part cannot hold another <sb-part>; write the pieces side by side in the screen");
      const found = await this.partMeta(id);
      const meta = found && !found.legacy ? found : { id, name: found?.name ?? name, versions: found?.versions ?? [] };
      const last = meta.versions.at(-1);
      const use = partTag(id);
      if (last && (await this.partHtml(id, last.v)) === html) return { part: id, version: last.v, changed: false, use };
      const version = (last?.v ?? 0) + 1;
      meta.versions.push({ v: version, at: now(), by, ...(note ? { note } : {}) });
      await this.store.write(`parts/${id}/v${version}.html`, html);
      await this.writeJson(`parts/${id}/meta.json`, meta);
      return { part: id, version, changed: true, use };
    });
  }

  async pinParts(html) {
    const pins = {};
    for (const name of new Set(partRefs(html).map((ref) => ref.name))) {
      const meta = await this.partMeta(name);
      if (!meta) throw new Error(`no part called "${name}"; write it with write_part first`);
      pins[name] = meta.versions.at(-1).v;
    }
    return pins;
  }

  async expandParts(html, pinned = {}) {
    const refs = partRefs(html);
    if (!refs.length) return html;
    const versions = {};
    for (const name of new Set(refs.map((ref) => ref.name))) {
      const meta = await this.partMeta(name);
      if (!meta) throw new Error(`no part called "${name}"; write it with write_part first`);
      const wanted = pinned?.[name];
      versions[name] = wanted && meta.versions.some((entry) => entry.v === wanted) ? wanted : meta.versions.at(-1).v;
    }
    const contents = new Map(await Promise.all(Object.entries(versions).map(async ([name, version]) => [name, await this.partHtml(name, version)])));
    return String(html).replace(PART_TAG, (whole) => {
      const [ref] = partRefs(whole);
      return ref ? placePart(ref.name, versions[ref.name], contents.get(ref.name), ref.attrs) : whole;
    });
  }

  async partUsage(screens = null) {
    const all = screens ?? (await this.screens());
    const usage = new Map();
    const newest = new Map();
    const latestOf = async (name) => {
      if (!newest.has(name)) newest.set(name, (await this.partMeta(name))?.versions.at(-1)?.v ?? null);
      return newest.get(name);
    };
    for (const meta of all) {
      if (meta.archived) continue;
      const current = new Set([meta.official, meta.versions.at(-1)?.v].filter(Boolean));
      for (const entry of meta.versions) {
        if (!current.has(entry.v) || !entry.parts) continue;
        const follows = this.follows(meta, entry);
        for (const [name, pinned] of Object.entries(entry.parts)) {
          const latest = await latestOf(name);
          const shown = follows ? latest : pinned;
          const official = meta.official === entry.v;
          const outdated = official && Boolean(latest) && shown < latest && !(entry.kept?.[name] >= latest);
          if (!usage.has(name)) usage.set(name, []);
          usage.get(name).push({ screen: meta.id, number: meta.number ?? null, name: meta.name, version: entry.v, official, follows, shown, latest, outdated });
        }
      }
    }
    return usage;
  }

  summarizeUsage(rows = []) {
    return {
      screens: new Set(rows.map((row) => row.screen)).size,
      following: rows.filter((row) => row.follows).length,
      official: rows.filter((row) => row.official).length,
      outdated: rows.filter((row) => row.outdated).length,
    };
  }

  async components() {
    const [ids, screens] = await Promise.all([this.parts(), this.screens()]);
    const usage = await this.partUsage(screens);
    return Promise.all(
      ids.map(async (id) => {
        const meta = await this.partMeta(id);
        return { id, name: meta?.name ?? id, legacy: Boolean(meta?.legacy), version: meta?.versions.at(-1)?.v ?? 1, versions: meta?.versions ?? [], ...this.summarizeUsage(usage.get(id)) };
      }),
    );
  }

  async component(name, version = null) {
    const id = slug(name);
    const meta = await this.partMeta(id);
    if (!meta) throw new Error(`no part called "${name}"`);
    const chosen = version ?? meta.versions.at(-1).v;
    const usage = (await this.partUsage()).get(id) ?? [];
    return { id, name: meta.name ?? id, legacy: Boolean(meta.legacy), version: chosen, latest: meta.versions.at(-1).v, versions: meta.versions, html: await this.partHtml(id, chosen), usage, ...this.summarizeUsage(usage) };
  }

  async partHtmlPage(name, version) {
    const project = await this.project();
    const head = project.head ? ((await this.store.read(project.head))?.toString("utf8") ?? "") : "";
    const meta = await this.partMeta(name);
    if (!meta) throw new Error(`no part called "${name}"`);
    const body = await this.partHtml(name, version ?? meta.versions.at(-1).v);
    return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n${head}\n</head><body>\n${body}\n</body></html>\n`;
  }

  async officialEntry(screen) {
    const meta = await this.screen(screen);
    if (!meta.official) throw new Error(`"${screen}" has no official version; a proposal follows its parts by itself`);
    const entry = meta.versions.find((item) => item.v === meta.official);
    if (!entry?.parts) throw new Error(`v${meta.official} of "${screen}" uses no shared part`);
    return { meta, entry };
  }

  async updateParts({ screen, by = "agent" }) {
    return this.saving(`${by} brought the parts of ${screen} up to date`, async () => {
      const { meta, entry } = await this.officialEntry(screen);
      const changed = [];
      for (const [name, pinned] of Object.entries(entry.parts)) {
        const latest = (await this.partMeta(name))?.versions.at(-1)?.v;
        if (latest && latest !== pinned) changed.push({ part: name, from: pinned, to: latest });
      }
      if (!changed.length) return { screen, version: entry.v, changed };
      for (const item of changed) {
        entry.parts[item.part] = item.to;
        if (entry.kept) delete entry.kept[item.part];
      }
      if (entry.kept && !Object.keys(entry.kept).length) delete entry.kept;
      entry.repinned = [...(entry.repinned ?? []), ...changed.map((item) => ({ ...item, by, at: now() }))];
      delete entry.shot;
      await this.writeJson(`screens/${screen}/meta.json`, meta);
      return { screen, version: entry.v, changed };
    });
  }

  async keepParts({ screen, by = "agent" }) {
    return this.saving(`${by} kept the parts of ${screen} as they are`, async () => {
      const { meta, entry } = await this.officialEntry(screen);
      const kept = {};
      for (const name of Object.keys(entry.parts)) {
        const latest = (await this.partMeta(name))?.versions.at(-1)?.v;
        if (latest && latest !== entry.parts[name]) kept[name] = latest;
      }
      if (!Object.keys(kept).length) return { screen, version: entry.v, kept };
      entry.kept = { ...(entry.kept ?? {}), ...kept };
      await this.writeJson(`screens/${screen}/meta.json`, meta);
      return { screen, version: entry.v, kept };
    });
  }

  async linkCopies({ part, dryRun = false, by = "agent" }) {
    return this.saving(`${by} linked the copies of ${slug(part)}`, async () => {
      const id = slug(part);
      const meta = await this.partMeta(id);
      if (!meta) throw new Error(`no part called "${part}"`);
      const versions = await Promise.all(meta.versions.map(async (entry) => ({ v: entry.v, html: await this.partHtml(id, entry.v) })));
      const candidates = versions.filter((item) => item.html.trim().length >= 40).sort((a, b) => b.html.length - a.html.length);
      const linked = [];
      for (const screenMeta of await this.screens()) {
        if (screenMeta.archived) continue;
        const current = new Set([screenMeta.official, screenMeta.versions.at(-1)?.v].filter(Boolean));
        let touched = false;
        for (const entry of screenMeta.versions) {
          if (!current.has(entry.v)) continue;
          let source = await this.screenHtml(screenMeta.id, entry.v);
          let count = 0;
          let pinned = null;
          for (const candidate of candidates) {
            const pieces = source.split(candidate.html);
            if (pieces.length < 2) continue;
            count += pieces.length - 1;
            pinned = pinned ?? candidate.v;
            source = pieces.join(partTag(id));
          }
          if (!count) continue;
          linked.push({ screen: screenMeta.id, number: screenMeta.number, version: entry.v, official: screenMeta.official === entry.v, copies: count, pinned });
          if (dryRun) continue;
          await this.store.write(`screens/${screenMeta.id}/v${entry.v}.html`, source);
          entry.parts = { ...(entry.parts ?? {}), [id]: pinned };
          entry.linked = [...(entry.linked ?? []), { part: id, by, at: now() }];
          touched = true;
        }
        if (touched) {
          const { number, ...stored } = screenMeta;
          await this.writeJson(`screens/${screenMeta.id}/meta.json`, stored);
        }
      }
      return { part: id, dryRun, screens: new Set(linked.map((item) => item.screen)).size, linked };
    });
  }

  async shotIsStale(id, version) {
    const meta = await this.readJson(`screens/${id}/meta.json`);
    const entry = meta?.versions.find((item) => item.v === version);
    if (!entry?.parts) return false;
    const wanted = await this.shownParts(meta, entry);
    return JSON.stringify(wanted) !== JSON.stringify(entry.shot ?? null);
  }

  async shownParts(meta, entry) {
    if (!entry?.parts) return null;
    const follows = this.follows(meta, entry);
    const shown = {};
    for (const name of Object.keys(entry.parts).sort()) {
      shown[name] = follows ? ((await this.partMeta(name))?.versions.at(-1)?.v ?? entry.parts[name]) : entry.parts[name];
    }
    return shown;
  }

  async editedHtml(id, meta, edits) {
    if (!meta) throw new Error(`no screen called "${id}" to edit; send the whole html`);
    let html = await this.screenHtml(id, meta.versions.at(-1).v);
    for (const { old_string: before, new_string: after } of edits) {
      const count = before ? html.split(before).length - 1 : 0;
      if (count !== 1) throw new Error(`old_string must appear exactly once in the latest version, found ${count}: ${String(before).slice(0, 80)}`);
      html = html.replace(before, () => after);
    }
    return html;
  }

  async writeScreen({ proposal, proposalTitle, screen, name, section, route, html, edits, amend = false, width, height, after, variantOf, by = "agent" }) {
    return this.saving((saved) => `${by} ${saved?.amended ? "redrew" : "drew"} ${saved?.screen} v${saved?.version} (${saved?.proposal})`, async () => {
      if (!proposal) throw new Error("every drawing goes inside a proposal: pass proposal");
      if (!html?.trim() && !edits?.length) throw new Error("pass html, or edits to change the latest version");
      const proposalId = slug(proposal);
      const id = slug(screen ?? name);
      if (!id) throw new Error("pass screen (an id) or name");
      const previous = await this.readJson(`screens/${id}/meta.json`);
      const base = variantOf ? await this.variantBase(id, variantOf) : null;
      if (!previous && !section && !base) throw new Error(`"${id}" is a new screen: pass section so it lands somewhere on the canvas`);
      const source = edits?.length ? await this.editedHtml(id, previous, edits) : html;
      const parts = await this.pinParts(source);
      const finalHtml = source;
      if (amend) return this.amendLatest({ id, meta: previous, proposalId, html: finalHtml, parts, width, height, by });
      const meta = previous ?? { id, name: name ?? screen, section: null, route: null, official: null, versions: [] };
      if (name) meta.name = name;
      if (route) meta.route = route;
      if (section) meta.section = await this.ensureSection(section);
      if (base) {
        meta.variantOf = base.id;
        meta.section = base.section;
      }
      delete meta.archived;
      const version = (meta.versions.at(-1)?.v ?? 0) + 1;
      const size = {
        width: width ?? meta.versions.at(-1)?.width ?? DESKTOP.width,
        height: height ?? meta.versions.at(-1)?.height ?? DESKTOP.height,
      };
      meta.versions.push({ v: version, proposal: proposalId, at: now(), by, ...size, ...(Object.keys(parts).length ? { parts } : {}) });
      await this.store.write(`screens/${id}/v${version}.html`, finalHtml);
      await this.writeJson(`screens/${id}/meta.json`, meta);
      if (after !== undefined) await this.place(id, after);

      const record = (await this.readJson(`proposals/${proposalId}/proposal.json`)) ?? {
        id: proposalId,
        title: proposalTitle ?? proposal,
        status: "open",
        createdBy: by,
        createdAt: now(),
        screens: {},
      };
      if (proposalTitle) record.title = proposalTitle;
      if (record.status !== "open") {
        record.approved = this.approvals(record);
        record.status = "open";
        delete record.replaced;
        delete record.approvedBy;
        delete record.approvedAt;
        delete record.archived;
      }
      if (record.approved) delete record.approved[id];
      record.screens[id] = version;
      await this.writeJson(`proposals/${proposalId}/proposal.json`, record);
      return { screen: id, version, proposal: proposalId, ...size };
    });
  }

  async variantBase(id, variantOf) {
    const screens = await this.screens();
    const byId = new Map(screens.map((screen) => [screen.id, screen]));
    const target = byId.get(slug(variantOf));
    if (!target) throw new Error(`no screen called "${variantOf}" to be a variation of`);
    const base = baseOf(target, byId);
    if (base.id === id) throw new Error(`"${id}" cannot be a variation of itself`);
    return base;
  }

  async order(project, screens) {
    const placed = new Map();
    for (const { section, groups } of arrange(project.sections, screens)) {
      if (section.id) placed.set(section.id, groups.flatMap((group) => [group.screen.id, ...group.variants.map((variant) => variant.id)]));
    }
    return placed;
  }

  async place(id, after) {
    const [project, screens] = await Promise.all([this.project(), this.screens()]);
    const meta = screens.find((screen) => screen.id === id);
    const section = project.sections.find((item) => item.id === meta?.section);
    if (!section) return;
    const current = await this.order(project, screens);
    const list = (current.get(section.id) ?? []).filter((item) => item !== id);
    if (after === "start" || after === "") list.unshift(id);
    else {
      const anchor = list.indexOf(slug(after));
      if (anchor < 0) throw new Error(`"${after}" is not in section "${section.name}"; pass a screen of that section, or "start"`);
      list.splice(anchor + 1, 0, id);
    }
    for (const item of project.sections) {
      item.screens = item.id === section.id ? list : (current.get(item.id) ?? []).filter((entry) => entry !== id);
    }
    await this.writeJson("project.json", project);
  }

  async arrange({ sections, by = "agent" }) {
    return this.saving(`${by} rearranged the screens`, async () => {
      if (!Array.isArray(sections) || !sections.length) throw new Error("pass sections, in the order they go on the canvas");
      const screens = await this.screens();
      const byId = new Map(screens.map((screen) => [screen.id, screen]));
      const seen = new Set();
      const claim = (id) => {
        const key = slug(id);
        if (!byId.has(key)) throw new Error(`no screen called "${id}"`);
        if (seen.has(key)) throw new Error(`"${id}" appears twice`);
        seen.add(key);
        return byId.get(key);
      };
      const plan = sections.map((entry) => ({
        name: entry.name,
        groups: (entry.screens ?? []).map((item) => {
          const base = claim(typeof item === "string" ? item : item.id);
          return { base, variants: (typeof item === "string" ? [] : item.variants ?? []).map(claim) };
        }),
      }));
      const project = await this.project();
      const previous = await this.order(project, screens);
      const listed = [];
      for (const entry of plan) {
        const id = slug(entry.name);
        const found = project.sections.find((item) => item.id === id || item.name === entry.name);
        const section = found ?? { id, name: entry.name };
        if (!found) project.sections.push(section);
        if (listed.includes(section)) throw new Error(`section "${entry.name}" appears twice`);
        listed.push(section);
        const ids = [];
        for (const { base, variants } of entry.groups) {
          ids.push(base.id, ...variants.map((variant) => variant.id));
          await this.writeJson(`screens/${base.id}/meta.json`, this.placedMeta(base, section.id, null));
          for (const variant of variants) await this.writeJson(`screens/${variant.id}/meta.json`, this.placedMeta(variant, section.id, base.id));
        }
        section.screens = [...ids, ...(previous.get(section.id) ?? []).filter((item) => !seen.has(item))];
      }
      for (const section of project.sections) {
        if (!listed.includes(section)) section.screens = (previous.get(section.id) ?? []).filter((item) => !seen.has(item));
      }
      const rest = project.sections.filter((section) => !listed.includes(section));
      const first = project.sections.findIndex((section) => listed.includes(section));
      const slot = project.sections.slice(0, first).filter((section) => !listed.includes(section)).length;
      project.sections = [...rest.slice(0, slot), ...listed, ...rest.slice(slot)];
      await this.writeJson("project.json", project);
      return { sections: project.sections.map((section) => ({ id: section.id, name: section.name, screens: section.screens })) };
    });
  }

  placedMeta(screen, section, variantOf) {
    const { number, ...meta } = screen;
    meta.section = section;
    if (variantOf) meta.variantOf = variantOf;
    else delete meta.variantOf;
    return meta;
  }

  async amendLatest({ id, meta, proposalId, html, parts = {}, width, height, by }) {
    const last = meta?.versions.at(-1);
    if (!last) throw new Error(`"${id}" has no version to amend; draw it without amend`);
    if (last.proposal !== proposalId) throw new Error(`v${last.v} of "${id}" belongs to proposal "${last.proposal}", not "${proposalId}"; draw a new version instead`);
    if (meta.official === last.v) throw new Error(`v${last.v} of "${id}" is official; draw a new version instead`);
    const commented = (await this.comments(id)).some((entry) => entry.version === last.v);
    if (commented) throw new Error(`someone already commented on v${last.v} of "${id}"; draw a new version so the conversation keeps what it was about`);
    last.at = now();
    last.by = by;
    if (Object.keys(parts).length) last.parts = parts;
    else delete last.parts;
    delete last.shot;
    if (width) last.width = width;
    if (height) last.height = height;
    await this.store.write(`screens/${id}/v${last.v}.html`, html);
    await this.writeJson(`screens/${id}/meta.json`, meta);
    return { screen: id, version: last.v, proposal: proposalId, width: last.width, height: last.height, amended: true };
  }

  async freeProposalId(base) {
    let id = slug(base);
    for (let n = 2; ; n += 1) {
      const record = await this.readJson(`proposals/${id}/proposal.json`);
      if (!record || record.status === "open") return id;
      id = `${slug(base)}-${n}`;
    }
  }

  async proposalForChange(meta, version, { base, title, fresh = false }) {
    const entry = meta.versions.find((item) => item.v === version);
    if (!entry) throw new Error(`screen "${meta.id}" has no version ${version}`);
    if (!fresh && meta.official !== version) {
      const record = await this.readJson(`proposals/${entry.proposal}/proposal.json`);
      if (record?.status === "open") return { proposal: record.id };
    }
    return { proposal: await this.freeProposalId(base), proposalTitle: title };
  }

  async numberOf(id) {
    return (await this.screens()).find((screen) => screen.id === id)?.number ?? null;
  }

  async duplicate({ screen, version, fresh = false, by, lang = "en" }) {
    return this.saving((written) => `${by} duplicated ${screen} as ${written?.screen}`, async () => {
      if (!by) throw new Error("duplicating needs a person's name");
      const meta = await this.screen(screen);
      const from = version ?? meta.official ?? this.latest(meta);
      const entry = meta.versions.find((item) => item.v === from);
      if (!entry) throw new Error(`screen "${screen}" has no version ${from}`);
      const number = await this.numberOf(screen);
      const target = await this.proposalForChange(meta, from, { base: `variation-${screen}`, title: translate(lang, "Variation of screen {number}: {name}", { number, name: meta.name }), fresh });
      const ids = new Set((await this.screens()).map((item) => item.id));
      let id = `${screen}-copy`;
      for (let n = 2; ids.has(id); n += 1) id = `${screen}-copy-${n}`;
      const project = await this.project();
      const section = project.sections.find((item) => item.id === meta.section)?.name ?? translate(lang, "No section");
      const written = await this.writeScreen({
        ...target,
        screen: id,
        name: translate(lang, "{name} (copy)", { name: meta.name }),
        section,
        route: meta.route ?? undefined,
        html: await this.screenHtml(screen, from),
        width: entry.width,
        height: entry.height,
        by,
      });
      const copy = await this.screen(id);
      copy.copiedFrom = { screen, version: from };
      copy.variantOf = screen;
      await this.writeJson(`screens/${id}/meta.json`, copy);
      const png = copy.versions.at(-1)?.parts ? null : await this.png(screen, from);
      if (png) await this.savePng(id, written.version, png);
      return written;
    });
  }

  async saveEdit({ screen, version, html, by, lang = "en" }) {
    return this.saving(`${by} edited ${screen}`, async () => {
      if (!by) throw new Error("editing needs a person's name");
      if (!html?.trim()) throw new Error("an edit needs the whole html");
      const meta = await this.screen(screen);
      const number = await this.numberOf(screen);
      const target = await this.proposalForChange(meta, version, { base: `edit-${screen}`, title: translate(lang, "Edit to screen {number}: {name}", { number, name: meta.name }) });
      const entry = meta.versions.find((item) => item.v === version);
      return this.writeScreen({ ...target, screen, html, width: entry.width, height: entry.height, by });
    });
  }

  async revert({ screen, version, by, lang = "en" }) {
    return this.saving((written) => `${by} restored ${screen} to v${version} (v${written?.version})`, async () => {
      if (!by) throw new Error("restoring a version needs a person's name");
      const meta = await this.screen(screen);
      const entry = meta.versions.find((item) => item.v === version);
      if (!entry) throw new Error(`screen "${screen}" has no version ${version}`);
      if (meta.versions.at(-1).v === version) throw new Error(`v${version} is already the latest version of "${screen}"`);
      const number = await this.numberOf(screen);
      const proposal = await this.freeProposalId(`restore-${screen}`);
      const written = await this.writeScreen({
        proposal,
        proposalTitle: translate(lang, "Screen {number} back to v{version}: {name}", { number, version, name: meta.name }),
        screen,
        html: await this.screenHtml(screen, version),
        width: entry.width,
        height: entry.height,
        by,
      });
      const restored = await this.screen(screen);
      const last = restored.versions.find((item) => item.v === written.version);
      if (last) {
        last.restoredFrom = version;
        await this.writeJson(`screens/${screen}/meta.json`, restored);
      }
      const png = last?.parts ? null : await this.png(screen, version);
      if (png) await this.savePng(screen, written.version, png);
      return { ...written, restoredFrom: version };
    });
  }

  async savePng(id, version, png) {
    return this.saving(`screenshot of ${id} v${version}`, async () => {
      await this.store.write(`screens/${id}/v${version}.png`, png);
      const meta = await this.readJson(`screens/${id}/meta.json`);
      const entry = meta?.versions.find((item) => item.v === version);
      if (!entry?.parts) return;
      entry.shot = await this.shownParts(meta, entry);
      await this.writeJson(`screens/${id}/meta.json`, meta);
    });
  }

  async shotStamp(id, version) {
    const meta = await this.readJson(`screens/${id}/meta.json`);
    const entry = meta?.versions.find((item) => item.v === version);
    const shown = await this.shownParts(meta, entry);
    return shown ? Object.entries(shown).map(([name, v]) => `${name}.${v}`).join("-") : "";
  }

  thumbPath(id, version, stamp) {
    return `screens/${id}/v${version}.thumb${stamp ? `.${stamp}` : ""}.webp`;
  }

  async thumb(id, version, stamp) {
    return this.store.read(this.thumbPath(id, version, stamp));
  }

  async saveThumb(id, version, stamp, webp) {
    return this.saving(`thumbnail of ${id} v${version}`, () => this.store.write(this.thumbPath(id, version, stamp), webp));
  }

  async png(id, version) {
    return this.store.read(`screens/${id}/v${version}.png`);
  }

  async proposals() {
    const paths = await this.store.list("proposals");
    const records = await Promise.all(
      paths.filter((path) => path.endsWith("/proposal.json")).map((path) => this.readJson(path)),
    );
    return records.filter(Boolean);
  }

  async proposal(id) {
    const record = await this.readJson(`proposals/${slug(id)}/proposal.json`);
    if (!record) throw new Error(`no proposal called "${id}"`);
    return record;
  }

  approvals(record) {
    if (record.approved) return record.approved;
    if (record.status !== "approved") return {};
    return Object.fromEntries(
      Object.keys(record.screens).map((screenId) => [screenId, { by: record.approvedBy, at: record.approvedAt, replaced: record.replaced?.[screenId] ?? null }]),
    );
  }

  async approve(id, by, screen = null, reason = null) {
    return this.saving(`${by} approved ${slug(id)}${screen ? ` (${screen})` : ""}`, async () => {
      if (!by) throw new Error("approving needs a person's name");
      const record = await this.proposal(id);
      if (screen && !record.screens[screen]) throw new Error(`proposal "${record.id}" has no screen "${screen}"`);
      const approved = this.approvals(record);
      const archived = await this.archivedScreens(record);
      const targets = (screen ? [screen] : Object.keys(record.screens)).filter((screenId) => !approved[screenId] && (screen || !archived.has(screenId)));
      for (const screenId of targets) {
        const meta = await this.screen(screenId);
        archived.delete(screenId);
        approved[screenId] = { by, at: now(), replaced: meta.official ?? null, ...(reason ? { reason } : {}) };
        const entry = meta.versions.find((item) => item.v === record.screens[screenId]);
        if (entry?.parts) {
          const shown = await this.shownParts(meta, entry);
          if (shown) entry.parts = shown;
        }
        meta.official = record.screens[screenId];
        delete meta.archived;
        await this.writeJson(`screens/${screenId}/meta.json`, meta);
      }
      record.approved = approved;
      delete record.replaced;
      this.closeWhenSettled(record, archived, by, reason);
      await this.writeJson(`proposals/${record.id}/proposal.json`, record);
      return record;
    });
  }

  async archivedScreens(record) {
    const metas = await Promise.all(Object.keys(record.screens).map((screenId) => this.readJson(`screens/${screenId}/meta.json`)));
    return new Set(metas.filter((meta) => meta?.archived).map((meta) => meta.id));
  }

  closeWhenSettled(record, archived, by, reason = null) {
    if (record.status === "approved") return false;
    const approved = this.approvals(record);
    const screens = Object.keys(record.screens);
    if (!screens.some((screenId) => approved[screenId])) return false;
    if (!screens.every((screenId) => approved[screenId] || archived.has(screenId))) return false;
    record.status = "approved";
    record.approvedBy = by;
    record.approvedAt = now();
    if (reason) record.approvedReason = reason;
    return true;
  }

  async reopen(id, by, screen = null) {
    return this.saving(`${by} undid the approval of ${slug(id)}${screen ? ` (${screen})` : ""}`, async () => {
      if (!by) throw new Error("undoing an approval needs a person's name");
      const record = await this.proposal(id);
      const approved = this.approvals(record);
      const targets = (screen ? [screen] : Object.keys(approved)).filter((screenId) => approved[screenId]);
      for (const screenId of targets) {
        const meta = await this.screen(screenId);
        if (meta.official === record.screens[screenId]) {
          meta.official = approved[screenId].replaced ?? null;
          await this.writeJson(`screens/${screenId}/meta.json`, meta);
        }
        delete approved[screenId];
      }
      record.approved = approved;
      delete record.replaced;
      if (record.status === "approved" && targets.length) {
        record.status = "open";
        record.reopenedBy = by;
        record.reopenedAt = now();
        delete record.approvedBy;
        delete record.approvedAt;
      }
      await this.writeJson(`proposals/${record.id}/proposal.json`, record);
      return record;
    });
  }

  async archive({ screen = null, proposal = null, by, reason }) {
    return this.saving(`${by} archived ${screen ?? proposal}`, async () => {
      if (!by) throw new Error("archiving needs a name");
      if (!screen === !proposal) throw new Error("pass screen or proposal, one of them");
      const stamp = { by, at: now(), ...(reason?.trim() ? { reason: reason.trim() } : {}) };
      if (screen) {
        const meta = await this.screen(screen);
        meta.archived = stamp;
        await this.writeJson(`screens/${meta.id}/meta.json`, meta);
        const closed = [];
        for (const record of await this.proposals()) {
          if (record.status !== "open" || !record.screens[meta.id]) continue;
          if (!this.closeWhenSettled(record, await this.archivedScreens(record), by)) continue;
          await this.writeJson(`proposals/${record.id}/proposal.json`, record);
          closed.push(record.id);
        }
        return { screen: meta.id, archived: stamp, ...(closed.length ? { closed } : {}) };
      }
      const record = await this.proposal(proposal);
      if (record.status === "approved") throw new Error(`proposal "${record.id}" is approved; archive its screens instead`);
      record.status = "archived";
      record.archived = stamp;
      await this.writeJson(`proposals/${record.id}/proposal.json`, record);
      return { proposal: record.id, archived: stamp };
    });
  }

  async restore({ screen = null, proposal = null, by = null }) {
    return this.saving(`${by ? `${by} ` : ""}restored ${screen ?? proposal}`, async () => {
      if (!screen === !proposal) throw new Error("pass screen or proposal, one of them");
      if (screen) {
        const meta = await this.screen(screen);
        delete meta.archived;
        await this.writeJson(`screens/${meta.id}/meta.json`, meta);
        return { screen: meta.id, restored: true };
      }
      const record = await this.proposal(proposal);
      if (record.status !== "archived") throw new Error(`proposal "${record.id}" is not archived`);
      record.status = "open";
      delete record.archived;
      await this.writeJson(`proposals/${record.id}/proposal.json`, record);
      return { proposal: record.id, restored: true };
    });
  }

  async flows() {
    return this.readJson("flows.json", []);
  }

  async link({ from, el, to, label, remove = false }) {
    return this.saving(`${remove ? "unlinked" : "linked"} ${from} to ${to}`, async () => {
      const flows = await this.flows();
      if (remove) {
        const kept = flows.filter((flow) => !(flow.from === from && flow.to === to && (el === undefined || flow.el === (el ?? null))));
        if (kept.length === flows.length) throw new Error(`no link from ${from} to ${to}${el ? ` by ${el}` : ""}`);
        await this.writeJson("flows.json", kept);
        return { from, to, removed: flows.length - kept.length };
      }
      await this.screen(from);
      await this.screen(to);
      const rest = flows.filter((flow) => !(flow.from === from && flow.el === (el ?? null) && flow.to === to));
      const entry = { from, el: el ?? null, to, label: label ?? null };
      rest.push(entry);
      await this.writeJson("flows.json", rest);
      return entry;
    });
  }

  async comments(screen) {
    return parseLines(await this.store.read(`comments/${screen}.jsonl`));
  }

  async comment({ screen, el, els, point, version, text, author, login, people = new Set(), kind = "human", category, replyTo }) {
    return this.saving(`${author} commented on ${screen}`, async () => {
      if (!text?.trim()) throw new Error("comment is empty");
      if (!author) throw new Error("comment needs an author");
      await this.screen(screen);
      const earlier = await this.comments(screen);
      const repeated = [...earlier]
        .reverse()
        .find(
          (earlier) =>
            earlier.author === author &&
            earlier.text === text &&
            earlier.el === (el ?? null) &&
            earlier.replyTo === (replyTo ?? null) &&
            Date.now() - new Date(earlier.at).getTime() < REPEAT_WINDOW_MS,
        );
      if (repeated) return repeated;
      const entry = {
        id: newId(),
        screen,
        el: el ?? piecesOf(els)?.[0] ?? null,
        els: piecesOf(els),
        point: pointOf(point),
        version: version ?? null,
        author,
        ...(login ? { login: String(login) } : {}),
        kind,
        ...(kind === "annotation" && category?.trim() ? { category: category.trim() } : {}),
        text,
        replyTo: replyTo ?? null,
        at: now(),
      };
      const reopened = (kind === "human" || kind === "guest") && entry.replyTo ? earlier.find((item) => item.id === entry.replyTo && item.resolved) : null;
      if (reopened) {
        delete reopened.resolved;
        await this.store.write(`comments/${screen}.jsonl`, [...earlier, entry].map((item) => `${JSON.stringify(item)}\n`).join(""));
      } else {
        await this.store.append(`comments/${screen}.jsonl`, `${JSON.stringify(entry)}\n`);
      }
      if (kind === "human") await this.notifyChats(entry, chatMentionsIn(text, people), entry.at);
      return entry;
    });
  }

  async notifyChats(entry, handles, at) {
    for (const handle of handles) {
      const mention = { comment: entry.id, screen: entry.screen, el: entry.el, els: entry.els, version: entry.version, author: entry.author, text: entry.text, at };
      await this.store.append(`mentions/${handle}.jsonl`, `${JSON.stringify(mention)}\n`);
    }
  }

  async editComment({ id, text, login, people = new Set() }) {
    return this.saving(`${login} edited a comment`, async () => {
      const found = await this.findComment(id);
      const entries = await this.comments(found.screen);
      const entry = entries.find((item) => item.id === found.id);
      const owner = entry.kind === "human" && Boolean(login) && String(entry.login ?? "").toLowerCase() === String(login).toLowerCase();
      if (!owner) throw new Error("only the author can edit this comment");
      if (!String(text ?? "").trim()) throw new Error("comment is empty");
      const asked = chatMentionsIn(entry.text, people);
      entry.text = text;
      entry.edited = now();
      await this.store.write(`comments/${found.screen}.jsonl`, entries.map((item) => `${JSON.stringify(item)}\n`).join(""));
      await this.notifyChats(entry, chatMentionsIn(text, people).filter((handle) => !asked.includes(handle)), entry.edited);
      return entry;
    });
  }

  async annotate({ screen, el, text, category, version, author }) {
    return this.saving(`${author} annotated ${screen}`, async () => {
      const meta = await this.screen(screen);
      const chosen = version ?? this.latest(meta);
      if (!meta.versions.some((entry) => entry.v === chosen)) throw new Error(`screen "${screen}" has no version ${chosen}`);
      return this.comment({ screen: meta.id, el: el ?? null, els: el ? [el] : null, version: chosen, text, author, kind: "annotation", category });
    });
  }

  async annotations(screen) {
    return splitAnnotations(await this.comments(screen)).annotations;
  }

  async removeAnnotation({ id, by }) {
    return this.saving(`${by} deleted an annotation`, async () => {
      const found = await this.findComment(id);
      if (!isAnnotation(found)) throw new Error(`comment "${id}" is not an annotation; only annotations can be removed`);
      const path = `comments/${found.screen}.jsonl`;
      const kept = (await this.comments(found.screen)).filter((entry) => entry.id !== found.id && entry.replyTo !== found.id);
      await this.store.write(path, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
      return { removed: found.id, screen: found.screen };
    });
  }

  async resolve({ comment, by, reopen = false }) {
    return this.saving(`${by} ${reopen ? "reopened" : "resolved"} a thread`, async () => {
      if (!by) throw new Error("resolving needs a name");
      const found = await this.findComment(comment);
      const entries = await this.comments(found.screen);
      const root = entries.find((entry) => entry.id === (found.replyTo ?? found.id));
      if (!root) throw new Error(`no comment with id "${found.replyTo}"`);
      if (isAnnotation(root)) throw new Error(`comment "${root.id}" is an annotation; only conversations can be resolved`);
      if (reopen) delete root.resolved;
      else root.resolved ??= { by, at: now() };
      await this.store.write(`comments/${found.screen}.jsonl`, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
      return { comment: root.id, screen: root.screen, resolved: root.resolved ?? null };
    });
  }

  async findComment(id) {
    const paths = await this.store.list("comments");
    for (const path of paths) {
      const found = parseLines(await this.store.read(path)).find((entry) => entry.id === id);
      if (found) return found;
    }
    throw new Error(`no comment with id "${id}"`);
  }

  async reply({ comment, text, author, version }) {
    return this.saving((entry) => `${author} replied on ${entry?.screen}`, async () => {
      const original = await this.findComment(comment);
      return this.comment({
        screen: original.screen,
        el: original.el,
        els: original.els,
        point: original.point,
        version: version ?? original.version,
        text,
        author,
        kind: "agent",
        replyTo: original.replyTo ?? original.id,
      });
    });
  }

  async pendingMentions(handle) {
    const mentions = parseLines(await this.store.read(`mentions/${handle.toLowerCase()}.jsonl`));
    if (!mentions.length) return [];
    const byScreen = new Map();
    for (const mention of mentions) {
      if (!byScreen.has(mention.screen)) byScreen.set(mention.screen, await this.comments(mention.screen));
    }
    return mentions.filter((mention) => {
      const thread = byScreen.get(mention.screen);
      const askedAt = thread.findIndex((entry) => entry.id === mention.comment);
      if (askedAt === -1) return false;
      const root = thread[askedAt].replyTo ?? mention.comment;
      if (thread.find((entry) => entry.id === root)?.resolved) return false;
      return !thread
        .slice(askedAt + 1)
        .some((entry) => entry.kind === "agent" && (entry.author === handle || String(entry.author).startsWith(`${handle} via `)) && entry.replyTo === root && String(entry.at) >= String(mention.at));
    });
  }

  async waiting() {
    const paths = await this.store.list("mentions");
    const handles = paths.filter((path) => path.endsWith(".jsonl")).map((path) => path.slice("mentions/".length, -".jsonl".length));
    const lists = await Promise.all(handles.map(async (handle) => (await this.pendingMentions(handle)).map((mention) => ({ handle, ...mention }))));
    return lists.flat();
  }

  async allComments() {
    const paths = (await this.store.list("comments")).filter((item) => item.endsWith(".jsonl"));
    const lists = await Promise.all(paths.map(async (path) => parseLines(await this.store.read(path))));
    return lists.flat();
  }

  async commentCounts(all) {
    const counts = {};
    const { comments } = splitAnnotations(all ?? (await this.allComments()));
    const resolved = new Set(comments.filter((entry) => entry.resolved).map((entry) => entry.id));
    for (const entry of comments) if (!resolved.has(entry.id) && !resolved.has(entry.replyTo)) counts[entry.screen] = (counts[entry.screen] ?? 0) + 1;
    return counts;
  }

  annotationCounts(all) {
    const counts = {};
    for (const entry of splitAnnotations(all).annotations.filter(isAnnotation)) counts[entry.screen] = (counts[entry.screen] ?? 0) + 1;
    return counts;
  }

  async share({ proposal, by }) {
    return this.saving(`${by} opened a public link to ${slug(proposal)}`, async () => {
      if (!by) throw new Error("sharing needs a person's name");
      const record = await this.proposal(proposal);
      if (record.status === "archived") throw new Error(`proposal "${record.id}" is archived`);
      const token = randomBytes(18).toString("base64url");
      const at = new Date();
      const entry = { token, proposal: record.id, by, at: at.toISOString(), expiresAt: new Date(at.getTime() + SHARE_DAYS * 86400000).toISOString() };
      await this.writeJson(`shares/${token}.json`, entry);
      return entry;
    });
  }

  async openShare(token) {
    if (!SHARE_TOKEN.test(String(token))) return null;
    const entry = await this.readJson(`shares/${token}.json`);
    if (!entry || entry.revoked || Date.parse(entry.expiresAt) <= Date.now()) return null;
    const record = await this.readJson(`proposals/${entry.proposal}/proposal.json`);
    return record && record.status !== "archived" ? { ...entry, record } : null;
  }

  async revokeShare(token, by) {
    return this.saving(`${by} revoked a public link`, async () => {
      if (!by) throw new Error("revoking needs a person's name");
      if (!SHARE_TOKEN.test(String(token))) throw new Error("no such link");
      const entry = await this.readJson(`shares/${token}.json`);
      if (!entry) throw new Error("no such link");
      entry.revoked = { by, at: now() };
      await this.writeJson(`shares/${token}.json`, entry);
      return entry;
    });
  }

  async shares() {
    const paths = (await this.store.list("shares")).filter((path) => path.endsWith(".json"));
    const entries = await Promise.all(paths.map((path) => this.readJson(path)));
    return entries.filter((entry) => entry && !entry.revoked && Date.parse(entry.expiresAt) > Date.now());
  }

  sharedVersion(share, meta, version) {
    return showsVersion(share.record, meta, version);
  }

  async sharedScreen(share, id, version = null) {
    if (!(id in share.record.screens)) throw new Error(`no screen called "${id}"`);
    const meta = await this.screen(id);
    if (version !== null && !this.sharedVersion(share, meta, version)) throw new Error(`screen "${id}" has no version ${version}`);
    return meta;
  }

  async sharedOverview(share) {
    const [project, screens, flows, notes] = await Promise.all([this.project(), this.screens(), this.flows(), this.allComments()]);
    const ids = new Set(Object.keys(share.record.screens));
    const visible = screens
      .filter((screen) => ids.has(screen.id) && !screen.archived)
      .map((screen) => ({ ...screen, versions: screen.versions.filter((entry) => this.sharedVersion(share, screen, entry.v)) }));
    const sections = new Set(visible.map((screen) => screen.section));
    const shown = notes.filter((entry) => ids.has(entry.screen));
    return {
      project: { name: project.name, sections: project.sections.filter((section) => sections.has(section.id)) },
      screens: visible,
      archived: [],
      proposals: [share.record],
      flows: flows.filter((flow) => ids.has(flow.from) && ids.has(flow.to)),
      pending: [],
      waiting: [],
      comments: await this.commentCounts(shown),
      annotations: this.annotationCounts(shown),
      notes: shown,
      parts: [],
      shares: [],
    };
  }

  async guide() {
    const record = await this.readJson("guide.json");
    return { text: record?.text ?? "", updatedBy: record?.updatedBy ?? null, updatedAt: record?.updatedAt ?? null, changes: record?.changes ?? [] };
  }

  async writeGuide({ text, edits, change, by = "agent" }) {
    return this.saving(`${by} updated the guide`, async () => {
      const current = await this.guide();
      let next = text;
      if (next === undefined || next === null) {
        if (!edits?.length) throw new Error("pass text with the whole guide, or edits");
        next = current.text;
        for (const { old_string: before, new_string: after } of edits) {
          const count = before ? next.split(before).length - 1 : 0;
          if (count !== 1) throw new Error(`old_string must appear exactly once in the guide, found ${count}: ${String(before).slice(0, 80)}`);
          next = next.replace(before, () => after);
        }
      }
      next = String(next).trim();
      if (next.length > GUIDE_LIMIT) throw new Error(`the guide is ${next.length} characters; keep it under ${GUIDE_LIMIT} by merging and cutting old lines`);
      const at = now();
      const entry = { by, at, change: String(change ?? "").trim().slice(0, 200) || null };
      const record = { text: next, updatedBy: by, updatedAt: at, changes: [entry, ...current.changes].slice(0, 30) };
      await this.writeJson("guide.json", record);
      return record;
    });
  }

  async lessons(since = null, limit = 20) {
    const after = (stamp) => stamp && (!since || String(stamp) > String(since));
    const [proposals, screens, notes] = await Promise.all([this.proposals(), this.screens(), this.allComments()]);
    const drawnBy = new Map(screens.map((screen) => [screen.id, screen]));
    const items = [];
    for (const record of proposals) {
      for (const [screen, stamp] of Object.entries(this.approvals(record))) {
        if (after(stamp.at) && !String(stamp.by).startsWith("claude")) items.push({ kind: "approved", at: stamp.at, by: stamp.by, proposal: record.id, screen, reason: stamp.reason ?? null });
      }
      if (record.status === "archived" && after(record.archived?.at) && !String(record.archived.by).startsWith("claude")) items.push({ kind: "archived", at: record.archived.at, by: record.archived.by, proposal: record.id, reason: record.archived.reason ?? null });
    }
    for (const screen of screens) {
      if (screen.archived && after(screen.archived.at) && !String(screen.archived.by).startsWith("claude")) items.push({ kind: "archived", at: screen.archived.at, by: screen.archived.by, screen: screen.id, reason: screen.archived.reason ?? null });
    }
    for (const entry of notes) {
      if (entry.kind !== "human" || !after(entry.at)) continue;
      const meta = drawnBy.get(entry.screen);
      const version = meta?.versions.find((item) => item.v === entry.version) ?? meta?.versions.at(-1);
      if (!String(version?.by ?? "").startsWith("claude")) continue;
      items.push({ kind: "comment", at: entry.at, by: entry.author, screen: entry.screen, el: entry.el ?? null, text: String(entry.text).slice(0, 300) });
    }
    return items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
  }

  async searchScreens({ query = "", like = null, limit = 8 } = {}) {
    const screens = (await this.screens()).filter((screen) => !screen.archived);
    const project = await this.project();
    const sectionName = new Map(project.sections.map((section) => [section.id, section.name]));
    const docs = [];
    for (let at = 0; at < screens.length; at += 24) {
      const batch = screens.slice(at, at + 24);
      docs.push(
        ...(await Promise.all(
          batch.map(async (screen) => {
            const version = screen.official ?? screen.versions.at(-1)?.v;
            const html = version ? await this.screenHtml(screen.id, version).catch(() => "") : "";
            const pieces = [...new Set([...html.matchAll(/data-el=["']([^"']+)["']/g)].map((match) => match[1]))];
            const body = textOf(html);
            return { screen, version, pieces, body, words: wordsOf(`${screen.name} ${screen.route ?? ""} ${sectionName.get(screen.section) ?? ""} ${pieces.join(" ")} ${body}`) };
          }),
        )),
      );
    }
    const target = like ? docs.find((doc) => doc.screen.id === like) : null;
    if (like && !target) throw new Error(`no screen called "${like}"`);
    const wanted = wordsOf(query);
    const asked = target ? new Set([...target.words].filter((word) => word.length > 3)) : new Set(wanted);
    if (!asked.size) throw new Error("pass query (words to look for) or like (a screen id)");
    const frequency = new Map();
    for (const doc of docs) for (const word of doc.words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    const weight = (word) => Math.log(1 + docs.length / (frequency.get(word) ?? 1));
    const scored = docs
      .filter((doc) => doc !== target)
      .map((doc) => {
        const title = wordsOf(`${doc.screen.name} ${doc.screen.route ?? ""}`);
        let score = 0;
        for (const word of asked) {
          if (doc.words.has(word)) score += weight(word) * (title.has(word) ? 3 : 1);
          else if (!target && word.length > 3 && [...doc.words].some((other) => other.startsWith(word))) score += weight(word) * 0.5;
        }
        return { doc, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(20, limit));
    const snippet = (body) => {
      const words = [...asked];
      const lower = body.toLowerCase();
      const hit = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
      return body.slice(Math.max(0, hit - 60), hit + 140).trim();
    };
    return scored.map(({ doc, score }) => ({
      screen: doc.screen.id,
      number: doc.screen.number,
      name: doc.screen.name,
      section: sectionName.get(doc.screen.section) ?? doc.screen.section,
      route: doc.screen.route ?? null,
      version: doc.version,
      official: Boolean(doc.screen.official),
      score: Math.round(score * 10) / 10,
      pieces: doc.pieces.slice(0, 24),
      text: snippet(doc.body),
    }));
  }

  async proposalThreads(id) {
    const record = await this.proposal(id);
    const approved = this.approvals(record);
    const ids = Object.keys(record.screens);
    const screens = await Promise.all(ids.map((screenId) => this.screen(screenId).catch(() => null)));
    const threads = [];
    for (const meta of screens.filter(Boolean)) {
      const { comments, annotations } = splitAnnotations(await this.comments(meta.id));
      const roots = comments.filter((entry) => !entry.replyTo);
      for (const root of roots) {
        const replies = comments.filter((entry) => entry.replyTo === root.id);
        threads.push({
          id: root.id,
          screen: meta.id,
          el: root.el ?? null,
          version: root.version ?? null,
          resolved: Boolean(root.resolved),
          messages: [root, ...replies].map((entry) => ({ id: entry.id, author: entry.author, at: entry.at, text: String(entry.text).slice(0, 1200) })),
        });
      }
      for (const note of annotations.filter((entry) => !entry.replyTo)) {
        threads.push({ id: note.id, screen: meta.id, el: note.el ?? null, version: note.version ?? null, annotation: true, category: note.category ?? null, messages: [{ id: note.id, author: note.author, at: note.at, text: String(note.text).slice(0, 600) }] });
      }
    }
    threads.sort((a, b) => Number(a.resolved ?? false) - Number(b.resolved ?? false) || String(a.messages[0].at).localeCompare(String(b.messages[0].at)));
    return {
      proposal: { id: record.id, title: record.title, status: record.status, createdBy: record.createdBy ?? null, archived: record.archived ?? null },
      screens: screens.filter(Boolean).map((meta) => ({ id: meta.id, name: meta.name, version: record.screens[meta.id], latest: meta.versions.at(-1)?.v, approved: Boolean(approved[meta.id]), archived: Boolean(meta.archived), variantOf: meta.variantOf ?? null })),
      open: threads.filter((thread) => !thread.annotation && !thread.resolved).length,
      threads,
    };
  }

  async setPresence(handle, activity) {
    const who = handle.toLowerCase();
    await this.writeJson(`presence/${who}.json`, { handle: who, ...activity, at: now() });
  }

  async presence() {
    const paths = (await this.store.list("presence")).filter((path) => path.endsWith(".json"));
    return (await Promise.all(paths.map((path) => this.readJson(path)))).filter(Boolean);
  }

  async overview(handle) {
    const [project, screens, proposals, flows, waiting, notes, parts, shares, stickies] = await Promise.all([
      this.project(),
      this.screens(),
      this.proposals(),
      this.flows(),
      this.waiting(),
      this.allComments(),
      this.parts(),
      this.shares(),
      this.stickies(),
    ]);
    const pending = handle ? waiting.filter((mention) => mention.handle === handle.toLowerCase()) : [];
    const archived = screens.filter((screen) => screen.archived).map(({ id, name, number, versions, archived: stamp }) => ({ id, name, number, version: versions.at(-1)?.v ?? null, ...stamp }));
    const usage = await this.partUsage(screens);
    const components = [...usage.entries()].map(([id, rows]) => ({ id, latest: rows[0]?.latest ?? null, ...this.summarizeUsage(rows) }));
    const outdated = {};
    for (const [id, rows] of usage) for (const row of rows) if (row.outdated) (outdated[row.screen] ??= []).push({ part: id, shown: row.shown, latest: row.latest });
    return { project, screens: screens.filter((screen) => !screen.archived), archived, proposals, flows, pending, waiting, comments: await this.commentCounts(notes), annotations: this.annotationCounts(notes), notes, parts, components, outdated, shares, stickies };
  }
}
