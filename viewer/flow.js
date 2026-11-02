import { baseOf } from "./arrange.js";

export const FLOW = {
  frameWidth: 320,
  caption: 26,
  columnGap: 260,
  rowGap: 56,
  variantGap: 48,
  pad: 72,
  groupGapX: 200,
  groupGapY: 260,
  portSpan: 480,
  looseGap: 64,
};

function uniqueLinks(flows, known) {
  const links = new Map();
  for (const flow of flows ?? []) {
    if (flow.from === flow.to || !known.has(flow.from) || !known.has(flow.to)) continue;
    const key = `${flow.from}\u0000${flow.to}`;
    const found = links.get(key);
    if (found) {
      found.label ??= flow.label ?? null;
      found.el ??= flow.el ?? null;
      continue;
    }
    links.set(key, { from: flow.from, to: flow.to, el: flow.el ?? null, label: flow.label ?? null });
  }
  return [...links.values()];
}

function stacksOf(nodes, linked) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const stacks = new Map();
  const owner = new Map();
  for (const node of nodes) {
    const base = baseOf(node, byId);
    if (base !== node && !linked.has(node.id)) continue;
    stacks.set(node.id, [node]);
    owner.set(node.id, node.id);
  }
  for (const node of nodes) {
    if (owner.has(node.id)) continue;
    const base = baseOf(node, byId);
    stacks.get(base.id).push(node);
    owner.set(node.id, base.id);
  }
  return stacks;
}

function stackHeight(stack, size) {
  return stack.reduce((total, node, index) => total + (index ? size.variantGap : 0) + size.caption + node.height, 0);
}

function components(ids, links, rank) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  for (const link of links) {
    const a = find(link.from);
    const b = find(link.to);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  return [...groups.values()].map((members) => members.sort((a, b) => rank.get(a) - rank.get(b))).sort((a, b) => rank.get(a[0]) - rank.get(b[0]));
}

function layers(members, links, rank) {
  const inside = new Set(members);
  const own = links.filter((link) => inside.has(link.from) && inside.has(link.to));
  const out = new Map(members.map((id) => [id, []]));
  const incoming = new Map(members.map((id) => [id, 0]));
  for (const link of own) {
    out.get(link.from).push(link);
    incoming.set(link.to, incoming.get(link.to) + 1);
  }
  for (const list of out.values()) list.sort((a, b) => rank.get(a.to) - rank.get(b.to));
  const starts = [...members.filter((id) => !incoming.get(id)), ...members.filter((id) => incoming.get(id))];
  const state = new Map();
  const discovered = [];
  const back = new Set();
  for (const start of starts) {
    if (state.has(start)) continue;
    state.set(start, "open");
    discovered.push(start);
    const stack = [{ id: start, next: 0 }];
    while (stack.length) {
      const top = stack.at(-1);
      const link = out.get(top.id)[top.next++];
      if (!link) {
        state.set(top.id, "done");
        stack.pop();
        continue;
      }
      const seen = state.get(link.to);
      if (seen === "open") back.add(link);
      else if (!seen) {
        state.set(link.to, "open");
        discovered.push(link.to);
        stack.push({ id: link.to, next: 0 });
      }
    }
  }
  const forward = own.filter((link) => !back.has(link));
  const pending = new Map(members.map((id) => [id, 0]));
  for (const link of forward) pending.set(link.to, pending.get(link.to) + 1);
  const sources = new Set(members.filter((id) => !pending.get(id)));
  const depth = new Map(members.map((id) => [id, 0]));
  const queue = discovered.filter((id) => sources.has(id));
  while (queue.length) {
    const id = queue.shift();
    for (const link of forward.filter((item) => item.from === id)) {
      depth.set(link.to, Math.max(depth.get(link.to), depth.get(id) + 1));
      pending.set(link.to, pending.get(link.to) - 1);
      if (!pending.get(link.to)) queue.push(link.to);
    }
  }
  for (const id of sources) {
    const targets = forward.filter((link) => link.from === id).map((link) => depth.get(link.to));
    if (targets.length) depth.set(id, Math.max(0, Math.min(...targets) - 1));
  }
  const first = Math.min(...depth.values());
  const columns = [];
  for (const id of discovered) {
    depth.set(id, depth.get(id) - first);
    (columns[depth.get(id)] ??= []).push(id);
  }
  return { columns: columns.map((column) => column ?? []), forward, back, depth };
}

function untangle(columns, forward) {
  const before = new Map();
  const after = new Map();
  for (const link of forward) {
    if (!before.has(link.to)) before.set(link.to, []);
    if (!after.has(link.from)) after.set(link.from, []);
    before.get(link.to).push(link.from);
    after.get(link.from).push(link.to);
  }
  const place = new Map();
  const remember = () => columns.forEach((column) => column.forEach((id, index) => place.set(id, index)));
  remember();
  const sweep = (column, neighbours) => {
    const weight = new Map(column.map((id, index) => {
      const near = (neighbours.get(id) ?? []).filter((other) => place.has(other));
      return [id, near.length ? near.reduce((total, other) => total + place.get(other), 0) / near.length : index];
    }));
    column.sort((a, b) => weight.get(a) - weight.get(b));
  };
  for (let round = 0; round < 4; round++) {
    for (let index = 1; index < columns.length; index++) {
      sweep(columns[index], before);
      remember();
    }
    for (let index = columns.length - 2; index >= 0; index--) {
      sweep(columns[index], after);
      remember();
    }
  }
}

function placeComponent(members, links, stacks, rank, size) {
  const { columns, forward, back, depth } = layers(members, links, rank);
  untangle(columns, forward);
  const step = size.frameWidth + size.columnGap;
  const top = new Map();
  const before = new Map();
  for (const link of forward) {
    if (!before.has(link.to)) before.set(link.to, []);
    before.get(link.to).push(link.from);
  }
  let height = 0;
  columns.forEach((column) => {
    let floor = 0;
    for (const id of column) {
      const parents = (before.get(id) ?? []).filter((other) => top.has(other));
      const wanted = parents.length ? Math.min(...parents.map((other) => top.get(other))) : floor;
      const y = Math.max(floor, wanted);
      top.set(id, y);
      floor = y + stackHeight(stacks.get(id), size) + size.rowGap;
      height = Math.max(height, floor - size.rowGap);
    }
  });
  const spots = new Map();
  for (const [id, y] of top) spots.set(id, { x: depth.get(id) * step, y });
  return { members, spots, width: columns.length * step - size.columnGap, height, forward, back: [...back] };
}

function placeLoose(ids, stacks, width, size) {
  const step = size.frameWidth + size.looseGap;
  const perRow = Math.max(1, Math.floor((width + size.looseGap) / step));
  const spots = new Map();
  let y = 0;
  let rowHeight = 0;
  ids.forEach((id, index) => {
    if (index && index % perRow === 0) {
      y += rowHeight + size.rowGap;
      rowHeight = 0;
    }
    spots.set(id, { x: (index % perRow) * step, y });
    rowHeight = Math.max(rowHeight, stackHeight(stacks.get(id), size));
  });
  const columns = Math.min(ids.length, perRow);
  return { members: ids, spots, width: columns * step - size.looseGap, height: y + rowHeight, forward: [], back: [], loose: true };
}

function shelve(blocks, size) {
  const area = blocks.reduce((total, block) => total + (block.width + 2 * size.pad) * (block.height + 2 * size.pad), 0);
  const widest = Math.max(0, ...blocks.map((block) => block.width + 2 * size.pad));
  const limit = Math.max(widest, Math.sqrt(area * 1.6));
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const block of blocks) {
    const outer = block.width + 2 * size.pad;
    if (x && x + outer > limit) {
      x = 0;
      y += rowHeight + size.groupGapY;
      rowHeight = 0;
    }
    block.box = { left: x, top: y, width: outer, height: block.height + 2 * size.pad };
    x += outer + size.groupGapX;
    rowHeight = Math.max(rowHeight, block.box.height);
  }
  return limit;
}

function spread(count, top, height, span) {
  const reach = Math.min(height, span);
  return Array.from({ length: count }, (_, index) => top + (reach * (index + 1)) / (count + 1));
}

function route(edges, boxes, size) {
  const leaving = new Map();
  const arriving = new Map();
  for (const edge of edges.filter((item) => !item.back)) {
    if (!leaving.has(edge.from)) leaving.set(edge.from, []);
    if (!arriving.has(edge.to)) arriving.set(edge.to, []);
    leaving.get(edge.from).push(edge);
    arriving.get(edge.to).push(edge);
  }
  const centre = (id) => boxes.get(id).y + boxes.get(id).height / 2;
  for (const [id, list] of leaving) {
    list.sort((a, b) => centre(a.to) - centre(b.to));
    const box = boxes.get(id);
    spread(list.length, box.y, box.height, size.portSpan).forEach((y, index) => (list[index].start = { x: box.x + size.frameWidth, y }));
  }
  for (const [id, list] of arriving) {
    list.sort((a, b) => a.start.y - b.start.y);
    const box = boxes.get(id);
    spread(list.length, box.y, box.height, size.portSpan).forEach((y, index) => (list[index].end = { x: box.x, y }));
  }
  for (const edge of edges) {
    if (edge.back) {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      if (from.x === to.x) {
        const side = from.x + size.frameWidth;
        const y1 = from.y + Math.min(from.height, size.portSpan) / 2;
        const y2 = to.y + Math.min(to.height, size.portSpan) / 2;
        const bulge = side + 70 + Math.min(120, Math.abs(y2 - y1) * 0.1);
        edge.start = { x: side, y: y1 };
        edge.end = { x: side, y: y2 };
        edge.path = `M ${side} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${side} ${y2}`;
        edge.labelAt = { x: bulge + 8, y: (y1 + y2) / 2, anchor: "start" };
        continue;
      }
      const x1 = from.x + size.frameWidth / 2;
      const x2 = to.x + size.frameWidth / 2;
      const lift = 90 + Math.abs(x1 - x2) * 0.12;
      edge.start = { x: x1, y: from.y };
      edge.end = { x: x2, y: to.y };
      edge.path = `M ${x1} ${from.y} C ${x1} ${from.y - lift}, ${x2} ${to.y - lift}, ${x2} ${to.y}`;
      edge.labelAt = { x: (x1 + x2) / 2, y: Math.min(from.y, to.y) - lift * 0.75 - 6, anchor: "middle" };
      continue;
    }
    const { start, end } = edge;
    const bend = Math.max(60, (end.x - start.x) / 2);
    edge.path = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
    edge.labelAt = { x: start.x + 12, y: start.y - 8, anchor: "start" };
  }
}

export function layoutFlow({ nodes, flows, size: custom } = {}) {
  const size = { ...FLOW, ...custom };
  const rank = new Map(nodes.map((node, index) => [node.id, index]));
  const links = uniqueLinks(flows, rank);
  const linked = new Set(links.flatMap((link) => [link.from, link.to]));
  const stacks = stacksOf(nodes, linked);
  const blocks = components([...linked].filter((id) => stacks.has(id)), links, rank).map((members) => placeComponent(members, links, stacks, rank, size));
  const widest = Math.max(size.frameWidth * 4 + size.looseGap * 3, ...blocks.map((block) => block.width));
  const alone = [...stacks.keys()].filter((id) => !linked.has(id)).sort((a, b) => rank.get(a) - rank.get(b));
  const limit = shelve(blocks, size);
  if (alone.length) {
    const loose = placeLoose(alone, stacks, Math.max(widest, limit - 2 * size.pad), size);
    const bottom = Math.max(0, ...blocks.map((block) => block.box.top + block.box.height));
    loose.box = { left: 0, top: blocks.length ? bottom + size.groupGapY : 0, width: loose.width + 2 * size.pad, height: loose.height + 2 * size.pad };
    blocks.push(loose);
  }
  const positions = new Map();
  const boxes = new Map();
  for (const block of blocks) {
    for (const [id, spot] of block.spots) {
      let y = block.box.top + size.pad + spot.y;
      const x = block.box.left + size.pad + spot.x;
      stacks.get(id).forEach((node, index) => {
        if (index) y += size.variantGap;
        positions.set(node.id, { x, y });
        if (!index) boxes.set(id, { x, y: y + size.caption, height: node.height });
        y += size.caption + node.height;
      });
    }
  }
  const edges = blocks.flatMap((block) => [...block.forward.map((link) => ({ ...link, back: false })), ...block.back.map((link) => ({ ...link, back: true }))]);
  route(edges, boxes, size);
  const groups = blocks.map((block) => ({ ids: block.members, box: block.box, loose: Boolean(block.loose), screens: block.members.reduce((total, id) => total + stacks.get(id).length, 0) }));
  return { groups, positions, edges };
}
