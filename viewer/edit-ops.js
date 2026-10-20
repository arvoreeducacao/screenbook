export function applyEditOps(doc, ops) {
  var body = doc.body;
  function resolve(at) {
    var node = body;
    for (var i = 0; i < at.length && node; i++) node = node.children[at[i]];
    return node || null;
  }
  function placeAt(parent, node, index) {
    parent.insertBefore(node, parent.children[index] || null);
  }
  for (var o = 0; o < (ops || []).length; o++) {
    var op = ops[o];
    if (!op || !Array.isArray(op.at) || !op.at.length) continue;
    if (op.kind === "insert") {
      var holder = resolve(op.at.slice(0, -1));
      if (!holder) continue;
      var template = doc.createElement("template");
      template.innerHTML = String(op.html || "");
      var fresh = template.content.firstElementChild;
      if (fresh) placeAt(holder, fresh, op.at[op.at.length - 1]);
      continue;
    }
    var node = resolve(op.at);
    if (!node || node === body) continue;
    if (op.kind === "style") {
      if (op.value) node.style.setProperty(op.prop, op.value);
      else node.style.removeProperty(op.prop);
      if (!node.style.length) node.removeAttribute("style");
    }
    if (op.kind === "text") node.textContent = String(op.value);
    if (op.kind === "remove") node.remove();
    if (op.kind === "move") {
      var parent = node.parentElement;
      node.remove();
      placeAt(parent, node, op.to);
    }
  }
}

export function sameAt(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

export function createEditHistory() {
  const entries = [];
  let applied = 0;
  return {
    push(entry) {
      entries.length = applied;
      entries.push(entry);
      applied = entries.length;
      return entry;
    },
    merge(key, ops, select) {
      const top = applied === entries.length ? entries[applied - 1] : null;
      if (!key || !top || top.merge !== key) return null;
      top.ops = ops;
      top.selectAfter = select ?? top.selectAfter;
      return top;
    },
    seal() {
      if (entries[applied - 1]) entries[applied - 1].merge = null;
    },
    undo() {
      if (!applied) return null;
      applied -= 1;
      return entries[applied];
    },
    redo() {
      if (applied >= entries.length) return null;
      applied += 1;
      return entries[applied - 1];
    },
    applied: () => entries.slice(0, applied),
    get count() {
      return applied;
    },
    get canRedo() {
      return applied < entries.length;
    },
    clear() {
      entries.length = 0;
      applied = 0;
    },
  };
}

export function uniqueName(base, taken) {
  const root = String(base).replace(/-\d+$/, "");
  for (let n = 2; ; n++) {
    const name = `${root}-${n}`;
    if (!taken.has(name)) return name;
  }
}

export function parseScreen(source, parser = new DOMParser()) {
  const full = /<html[\s>]/i.test(source);
  const doc = parser.parseFromString(full ? source : `<!doctype html>\n<html><head></head><body>\n${source}\n</body></html>`, "text/html");
  return { doc, full };
}

export function serializeScreen({ doc, full }) {
  if (full) return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  return doc.body.innerHTML.replace(/^\n/, "").replace(/\n$/, "");
}
