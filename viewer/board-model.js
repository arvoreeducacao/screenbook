export const BOARD_TYPES = ["sticky", "shape", "text", "connector", "path", "section", "stamp", "screen"];
export const BOARD_COLORS = ["yellow", "orange", "pink", "violet", "blue", "teal", "green", "gray"];
export const INK_COLORS = ["ink", "red", "orange", "green", "blue", "violet"];
export const SHAPES = ["rect", "ellipse", "diamond"];
export const STAMPS = ["plus1", "heart", "check"];
export const STAMP_GLYPHS = { plus1: "+1", heart: "❤", check: "✓" };
export const MAX_ITEMS = 3000;
export const MAX_POINTS = 1500;
export const MAX_OPS = 400;

const ID = /^[\w-]{1,40}$/;
const SIZES = {
  sticky: [200, 200],
  shape: [180, 110],
  text: [240, 40],
  section: [640, 440],
  stamp: [44, 44],
  screen: [280, 210],
};
const GAP = 40;
const AUTO_COLUMNS = 5;

export function emptyBoard() {
  return { rev: 0, items: {} };
}

export function defaultSize(type) {
  return SIZES[type] ?? [160, 100];
}

function number(value, fallback, min = -1e6, max = 1e6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
}

function textOf(value, limit = 4000) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function pick(value, list, fallback = list[0]) {
  return list.includes(value) ? value : fallback;
}

function endOf(end) {
  if (!end || typeof end !== "object") return { x: 0, y: 0 };
  if (typeof end.id === "string" && ID.test(end.id)) return { id: end.id };
  return { x: number(end.x, 0), y: number(end.y, 0) };
}

function pointsOf(points) {
  if (!Array.isArray(points)) return [];
  return points
    .slice(0, MAX_POINTS)
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([x, y]) => [number(x, 0), number(y, 0)]);
}

const FIELDS = {
  x: (value, item) => number(value, item.x ?? 0),
  y: (value, item) => number(value, item.y ?? 0),
  w: (value, item) => number(value, item.w ?? defaultSize(item.type)[0], 8, 20000),
  h: (value, item) => number(value, item.h ?? defaultSize(item.type)[1], 8, 20000),
  z: (value, item) => number(value, item.z ?? 0, -1e9, 1e9),
  text: (value, item) => textOf(value, item.type === "section" ? 120 : 4000),
  color: (value, item) => (item.type === "path" || item.type === "connector" || item.type === "text" ? pick(value, INK_COLORS) : pick(value, BOARD_COLORS, item.type === "shape" ? "blue" : item.type === "section" ? "gray" : "yellow")),
  shape: (value) => pick(value, SHAPES),
  size: (value) => number(value, 18, 10, 120),
  stamp: (value) => pick(value, STAMPS),
  screen: (value) => (typeof value === "string" && ID.test(value) ? value : ""),
  version: (value) => (Number.isInteger(value) && value > 0 ? value : null),
  from: (value) => endOf(value),
  to: (value) => endOf(value),
  end: (value) => pick(value, ["arrow", "none"]),
  points: (value) => pointsOf(value),
  marker: (value) => value === true,
  stroke: (value) => number(value, 3, 1, 48),
  by: (value) => textOf(value, 80),
};

const ALLOWED = {
  sticky: ["x", "y", "w", "h", "z", "text", "color"],
  shape: ["x", "y", "w", "h", "z", "text", "color", "shape"],
  text: ["x", "y", "w", "h", "z", "text", "color", "size"],
  connector: ["z", "text", "color", "from", "to", "end"],
  path: ["x", "y", "z", "color", "points", "marker", "stroke"],
  section: ["x", "y", "w", "h", "z", "text", "color"],
  stamp: ["x", "y", "z", "stamp"],
  screen: ["x", "y", "w", "h", "z", "screen", "version"],
};

export function cleanSet(item, set) {
  const out = {};
  for (const key of ALLOWED[item.type] ?? []) {
    if (set && Object.hasOwn(set, key)) out[key] = FIELDS[key](set[key], item);
  }
  return out;
}

export function cleanItem(raw, id) {
  const type = pick(raw?.type, BOARD_TYPES, null);
  if (!type) throw new Error(`unknown board item type "${raw?.type}"; use one of ${BOARD_TYPES.join(", ")}`);
  const base = { id, type };
  const [w, h] = defaultSize(type);
  const defaults = { x: 0, y: 0, w, h, z: 0, text: "", color: undefined, shape: "rect", size: 18, stamp: "plus1", screen: "", version: null, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, end: "arrow", points: [], marker: false, stroke: 3 };
  const item = { ...base };
  for (const key of ALLOWED[type]) item[key] = FIELDS[key](raw[key] ?? defaults[key], item);
  if (type === "path" && raw.marker) item.stroke = FIELDS.stroke(raw.stroke ?? 18, item);
  if (raw.by) item.by = FIELDS.by(raw.by);
  return item;
}

export function freshId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

export function itemBox(item, items = {}) {
  if (item.type === "path") {
    const xs = item.points.map((point) => point[0]);
    const ys = item.points.map((point) => point[1]);
    const pad = item.stroke / 2;
    if (!xs.length) return { x: item.x, y: item.y, w: 1, h: 1 };
    return { x: item.x + Math.min(...xs) - pad, y: item.y + Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  }
  if (item.type === "connector") {
    const a = endPoint(item.from, items);
    const b = endPoint(item.to, items);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) || 1, h: Math.abs(a.y - b.y) || 1 };
  }
  if (item.type === "stamp") {
    const [w, h] = defaultSize("stamp");
    return { x: item.x, y: item.y, w, h };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function endPoint(end, items = {}) {
  if (end?.id && items[end.id]) {
    const box = itemBox(items[end.id], items);
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
  return { x: end?.x ?? 0, y: end?.y ?? 0 };
}

export function contentBox(items) {
  const boxes = Object.values(items).map((item) => itemBox(item, items));
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { left, top, right, bottom };
}

function topZ(items) {
  return Object.values(items).reduce((most, item) => Math.max(most, item.z ?? 0), 0);
}

function autoPlacer(items) {
  const box = contentBox(items);
  const origin = box ? { x: Math.round(box.right + GAP * 3), y: Math.round(box.top) } : { x: 0, y: 0 };
  let count = 0;
  let rowHeight = 0;
  let cursor = { ...origin };
  return (type, w, h) => {
    if (count && count % AUTO_COLUMNS === 0) {
      cursor = { x: origin.x, y: cursor.y + rowHeight + GAP };
      rowHeight = 0;
    }
    const spot = { ...cursor };
    cursor.x += w + GAP;
    rowHeight = Math.max(rowHeight, h);
    count += 1;
    return spot;
  };
}

function inside(box, section) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cx >= section.x && cx <= section.x + section.w && cy >= section.y && cy <= section.y + section.h;
}

export function sectionMembers(section, items) {
  return Object.values(items).filter((item) => item.id !== section.id && item.type !== "connector" && item.type !== "section" && inside(itemBox(item, items), section));
}

function gridInside(section, members) {
  const pad = GAP;
  const top = 56;
  const widest = Math.max(...members.map((item) => item.w ?? defaultSize(item.type)[0]));
  const tallest = Math.max(...members.map((item) => item.h ?? defaultSize(item.type)[1]));
  const columns = Math.max(1, Math.min(members.length, Math.ceil(Math.sqrt(members.length))));
  const rows = Math.ceil(members.length / columns);
  const moves = members.map((item, index) => ({
    id: item.id,
    x: section.x + pad + (index % columns) * (widest + GAP / 2),
    y: section.y + top + Math.floor(index / columns) * (tallest + GAP / 2),
  }));
  const w = Math.max(section.w ?? 0, pad * 2 + columns * widest + (columns - 1) * (GAP / 2));
  const h = Math.max(section.h ?? 0, top + pad + rows * tallest + (rows - 1) * (GAP / 2));
  return { moves, w, h };
}

export function expandOps(board, ops, { by = "", makeId = freshId } = {}) {
  if (!Array.isArray(ops)) throw new Error("ops must be a list");
  if (ops.length > MAX_OPS) throw new Error(`at most ${MAX_OPS} ops per call`);
  const items = { ...board.items };
  const place = autoPlacer(items);
  const out = [];
  const refs = new Map();
  let z = topZ(items);
  const resolve = (ref) => (typeof ref === "string" ? refs.get(ref) ?? ref : ref);
  const newId = (wanted) => {
    if (typeof wanted === "string" && ID.test(wanted) && !items[wanted]) return wanted;
    let id = makeId();
    while (items[id]) id = makeId();
    return id;
  };
  const add = (raw, ref) => {
    if (Object.keys(items).length >= MAX_ITEMS) throw new Error(`a board holds at most ${MAX_ITEMS} items`);
    const id = newId(raw.id ?? ref);
    const draft = { ...raw };
    if (draft.from) draft.from = typeof draft.from === "string" ? { id: resolve(draft.from) } : draft.from.id ? { ...draft.from, id: resolve(draft.from.id) } : draft.from;
    if (draft.to) draft.to = typeof draft.to === "string" ? { id: resolve(draft.to) } : draft.to.id ? { ...draft.to, id: resolve(draft.to.id) } : draft.to;
    if (draft.type !== "connector" && draft.type !== "path" && (!Number.isFinite(Number(draft.x)) || !Number.isFinite(Number(draft.y)))) {
      const [w, h] = [draft.w ?? defaultSize(draft.type)[0], draft.h ?? defaultSize(draft.type)[1]];
      Object.assign(draft, place(draft.type, w, h));
    }
    if (draft.z === undefined) draft.z = draft.type === "section" ? -(++z) : ++z;
    const item = cleanItem({ ...draft, by: draft.by ?? by }, id);
    items[id] = item;
    if (typeof ref === "string") refs.set(ref, id);
    if (typeof raw.id === "string") refs.set(raw.id, id);
    out.push({ op: "add", item });
    return item;
  };
  const update = (id, set) => {
    const item = items[resolve(id)];
    if (!item) return null;
    const draft = { ...set };
    for (const key of ["from", "to"]) if (typeof draft[key] === "string") draft[key] = { id: resolve(draft[key]) };
    const clean = cleanSet(item, draft);
    if (!Object.keys(clean).length) return null;
    items[item.id] = { ...item, ...clean };
    out.push({ op: "update", id: item.id, set: clean });
    return items[item.id];
  };
  const remove = (id) => {
    const target = items[resolve(id)];
    if (!target) return;
    delete items[target.id];
    out.push({ op: "delete", id: target.id });
    for (const other of Object.values(items)) {
      if (other.type === "connector" && (other.from.id === target.id || other.to.id === target.id)) {
        delete items[other.id];
        out.push({ op: "delete", id: other.id });
      }
    }
  };
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    if (op.op === "add") add(op.item ?? {}, op.ref);
    else if (op.op === "update") update(op.id, op.set ?? {});
    else if (op.op === "move") {
      const item = items[resolve(op.id)];
      if (!item) continue;
      if (op.dx !== undefined || op.dy !== undefined) update(item.id, { x: (item.x ?? 0) + Number(op.dx ?? 0), y: (item.y ?? 0) + Number(op.dy ?? 0) });
      else update(item.id, { x: op.x, y: op.y });
    } else if (op.op === "delete") remove(op.id);
    else if (op.op === "connect") add({ type: "connector", from: { id: resolve(op.from) }, to: { id: resolve(op.to) }, text: op.text ?? "", color: op.color, end: op.end }, op.ref);
    else if (op.op === "group") {
      const members = (op.ids ?? []).map(resolve).map((id) => items[id]).filter((item) => item && item.type !== "connector" && item.type !== "section");
      if (!members.length) continue;
      const section = add({ type: "section", text: op.name ?? "", color: op.color, x: op.x, y: op.y, w: 10, h: 10 }, op.ref);
      const { moves, w, h } = gridInside(section, members);
      update(section.id, { w, h });
      for (const move of moves) update(move.id, { x: move.x, y: move.y });
      if (!Number.isFinite(Number(op.x))) {
        const others = { ...items };
        delete others[section.id];
        for (const member of members) delete others[member.id];
        const rest = contentBox(others);
        if (rest) {
          const shiftX = Math.round(rest.right + GAP * 3 - section.x);
          if (section.x <= rest.right + GAP) {
            update(section.id, { x: items[section.id].x + shiftX });
            for (const move of moves) update(move.id, { x: items[move.id].x + shiftX });
          }
        }
      }
    } else if (op.op === "front") update(op.id, { z: topZ(items) + 1 });
    else if (op.op === "back") update(op.id, { z: Object.values(items).reduce((least, item) => Math.min(least, item.z ?? 0), 0) - 1 });
    else throw new Error(`unknown op "${op.op}"; use add, update, move, delete, connect, group, front or back`);
  }
  return { items, ops: out, refs: Object.fromEntries(refs) };
}

export function applyOps(items, ops) {
  const next = { ...items };
  for (const op of ops) {
    if (op.op === "add" && op.item?.id) next[op.item.id] = op.item;
    else if (op.op === "update" && next[op.id]) next[op.id] = { ...next[op.id], ...op.set };
    else if (op.op === "delete") delete next[op.id];
  }
  return next;
}

export function invertOps(items, ops) {
  const inverse = [];
  let current = { ...items };
  for (const op of ops) {
    if (op.op === "add") inverse.unshift({ op: "delete", id: op.item.id });
    else if (op.op === "delete" && current[op.id]) inverse.unshift({ op: "add", item: current[op.id] });
    else if (op.op === "update" && current[op.id]) {
      const before = {};
      for (const key of Object.keys(op.set)) before[key] = current[op.id][key];
      inverse.unshift({ op: "update", id: op.id, set: before });
    }
    current = applyOps(current, [op]);
  }
  return inverse;
}

export function sortedItems(items) {
  const rank = (item) => (item.type === "section" ? 0 : 1);
  return Object.values(items).sort((a, b) => rank(a) - rank(b) || (a.z ?? 0) - (b.z ?? 0) || String(a.id).localeCompare(String(b.id)));
}

export function summarize(board, { limit = 26000 } = {}) {
  const items = board.items;
  const sections = Object.values(items).filter((item) => item.type === "section");
  const sectionOf = (item) => sections.find((section) => item.type !== "section" && item.type !== "connector" && inside(itemBox(item, items), section))?.id;
  const round = (value) => Math.round(value);
  const line = (item) => {
    const entry = { id: item.id, type: item.type };
    if (item.type === "connector") {
      entry.from = item.from.id ?? [round(item.from.x), round(item.from.y)];
      entry.to = item.to.id ?? [round(item.to.x), round(item.to.y)];
    } else {
      const box = itemBox(item, items);
      entry.box = [round(box.x), round(box.y), round(box.w), round(box.h)];
    }
    if (item.text) entry.text = item.text.length > 280 ? `${item.text.slice(0, 280)}…` : item.text;
    if (item.type === "shape") entry.shape = item.shape;
    if (item.type === "stamp") entry.stamp = item.stamp;
    if (item.type === "screen") entry.screen = item.screen;
    if (item.type === "path") entry.drawing = item.marker ? "highlighter" : "pen";
    if (item.color && item.type !== "path") entry.color = item.color;
    const section = sectionOf(item);
    if (section) entry.in = section;
    return entry;
  };
  const list = sortedItems(items).map(line);
  const box = contentBox(items);
  const result = { rev: board.rev, count: list.length, bounds: box ? [round(box.left), round(box.top), round(box.right), round(box.bottom)] : null, items: list };
  let json = JSON.stringify(result);
  if (json.length <= limit) return result;
  const kept = [];
  let size = 200;
  for (const entry of list) {
    const piece = JSON.stringify(entry).length + 1;
    if (size + piece > limit) break;
    kept.push(entry);
    size += piece;
  }
  return { ...result, items: kept, truncated: `${list.length - kept.length} items left out: read again with near or section to see them` };
}

export function nearFilter(board, { section, near } = {}) {
  const items = board.items;
  if (section) {
    const target = items[section];
    if (!target) throw new Error(`no section "${section}" on this board`);
    const ids = new Set([target.id, ...sectionMembers(target, items).map((item) => item.id)]);
    for (const item of Object.values(items)) if (item.type === "connector" && (ids.has(item.from.id) || ids.has(item.to.id))) ids.add(item.id);
    return { ...board, items: Object.fromEntries([...ids].map((id) => [id, items[id]])) };
  }
  if (Array.isArray(near) && near.length === 4) {
    const [x, y, w, h] = near.map(Number);
    const hit = (box) => box.x < x + w && box.x + box.w > x && box.y < y + h && box.y + box.h > y;
    return { ...board, items: Object.fromEntries(Object.entries(items).filter(([, item]) => hit(itemBox(item, items)))) };
  }
  return board;
}
