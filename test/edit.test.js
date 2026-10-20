import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEditOps, createEditHistory, sameAt, uniqueName } from "../viewer/edit-ops.js";
import { axisOf, cssValue, inverseOf, tokenName } from "../viewer/edit.js";
import { EDIT_BRIDGE } from "../src/edit-bridge.js";
import { INSPECT_BRIDGE } from "../src/inspect-bridge.js";

function element(tag, text = "") {
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    parentElement: null,
    attributes: {},
    props: {},
    text,
    style: {
      get length() {
        return Object.keys(node.props).length;
      },
      setProperty: (prop, value) => (node.props[prop] = value),
      removeProperty: (prop) => delete node.props[prop],
      getPropertyValue: (prop) => node.props[prop] ?? "",
    },
    get textContent() {
      return node.children.length ? node.children.map((child) => child.textContent).join("") : node.text;
    },
    set textContent(value) {
      node.children = [];
      node.text = value;
    },
    get outerHTML() {
      return `<${tag}>${node.textContent}</${tag}>`;
    },
    removeAttribute: (name) => delete node.attributes[name],
    insertBefore(child, before) {
      child.parentElement = node;
      const index = before ? node.children.indexOf(before) : -1;
      if (index === -1) node.children.push(child);
      else node.children.splice(index, 0, child);
    },
    remove() {
      const parent = node.parentElement;
      if (parent) parent.children.splice(parent.children.indexOf(node), 1);
      node.parentElement = null;
    },
  };
  return node;
}

function documentWith(...nodes) {
  const body = element("body");
  nodes.forEach((node) => body.insertBefore(node, null));
  return {
    body,
    createElement: () => ({
      content: { firstElementChild: null },
      set innerHTML(html) {
        const match = String(html).match(/^<(\w+)>(.*)<\/\1>$/);
        this.content.firstElementChild = match ? element(match[1], match[2]) : null;
      },
    }),
  };
}

const texts = (doc) => doc.body.children.map((node) => node.textContent);

test("every edit can be played back through its inverse", () => {
  const doc = documentWith(element("h1", "Title"), element("p", "One"), element("p", "Two"));
  const ops = [
    { kind: "text", at: [0], value: "New title" },
    { kind: "style", at: [1], prop: "padding-top", value: "24px" },
    { kind: "insert", at: [2], html: "<p>One</p>" },
    { kind: "move", at: [3], to: 0 },
    { kind: "remove", at: [1] },
  ];
  const inverse = [];
  for (const op of ops) {
    inverse.unshift(inverseOf(doc, op));
    applyEditOps(doc, [op]);
  }
  assert.deepEqual(texts(doc), ["Two", "One", "One"]);
  assert.equal(doc.body.children[1].style.getPropertyValue("padding-top"), "24px");
  applyEditOps(doc, inverse);
  assert.deepEqual(texts(doc), ["Title", "One", "Two"]);
  assert.equal(doc.body.children[1].style.length, 0);
});

test("an op that points nowhere changes nothing", () => {
  const doc = documentWith(element("p", "One"));
  applyEditOps(doc, [{ kind: "remove", at: [4, 1] }, { kind: "text", at: [], value: "x" }, null]);
  assert.deepEqual(texts(doc), ["One"]);
});

test("typing in one field is one step of undo, and a new step drops the redo", () => {
  const history = createEditHistory();
  history.push({ ops: [1], merge: "pt:0" });
  assert.ok(history.merge("pt:0", [2]));
  assert.equal(history.count, 1);
  assert.deepEqual(history.applied()[0].ops, [2]);
  history.seal();
  assert.equal(history.merge("pt:0", [3]), null);
  history.push({ ops: [3] });
  assert.equal(history.undo().ops[0], 3);
  assert.ok(history.canRedo);
  history.push({ ops: [4] });
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.applied().map((entry) => entry.ops[0]), [2, 4]);
  history.undo();
  history.undo();
  assert.equal(history.undo(), null);
  assert.equal(history.redo().ops[0], 2);
});

test("typed numbers get the unit, anything else passes through", () => {
  assert.equal(cssValue("16", "px"), "16px");
  assert.equal(cssValue("1.5", "px"), "1.5px");
  assert.equal(cssValue("600", ""), "600");
  assert.equal(cssValue("50%", "px"), "50%");
  assert.equal(cssValue("  ", "px"), "");
});

test("tokens and alignments read back from css values", () => {
  assert.equal(tokenName("var(--primary)"), "--primary");
  assert.equal(tokenName("var( --surface-cool , #fff)"), "--surface-cool");
  assert.equal(tokenName("#fff"), null);
  assert.equal(axisOf("flex-end"), "end");
  assert.equal(axisOf("center"), "center");
  assert.equal(axisOf("normal"), "start");
});

test("a copy gets a name no other piece uses", () => {
  assert.equal(uniqueName("cartao", new Set(["cartao"])), "cartao-2");
  assert.equal(uniqueName("cartao-2", new Set(["cartao", "cartao-2", "cartao-3"])), "cartao-4");
  assert.ok(sameAt([1, 2], [1, 2]));
  assert.equal(sameAt([1, 2], [1]), false);
});

test("the edit bridge is valid script and carries the same op player as the viewer", () => {
  const body = EDIT_BRIDGE.replace(/^<script>/, "").replace(/<\/script>$/, "");
  assert.doesNotThrow(() => new Function(body));
  assert.match(EDIT_BRIDGE, /function applyEditOps\(doc, ops\)/);
  assert.match(EDIT_BRIDGE, /__screenbook_edit/);
  assert.doesNotMatch(EDIT_BRIDGE, /fetch\(|XMLHttpRequest/);
  assert.match(INSPECT_BRIDGE, /screenbook:pick/);
  assert.match(INSPECT_BRIDGE, /sb-inspect-at/);
});
