import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFlow, FLOW } from "../viewer/flow.js";

const node = (id, extra = {}) => ({ id, height: 200, ...extra });
const link = (from, to, label = null) => ({ from, to, el: `${from}-to-${to}`, label });
const column = (layout, id) => Math.round((layout.positions.get(id).x - FLOW.pad) / (FLOW.frameWidth + FLOW.columnGap));

test("a journey reads left to right, one column per step", () => {
  const layout = layoutFlow({ nodes: ["list", "detail", "edit"].map((id) => node(id)), flows: [link("list", "detail"), link("detail", "edit")] });
  assert.deepEqual(["list", "detail", "edit"].map((id) => column(layout, id)), [0, 1, 2]);
  assert.equal(layout.groups.length, 1);
  assert.equal(layout.edges.filter((edge) => !edge.back).length, 2);
});

test("a link back to an earlier screen does not push it to the right", () => {
  const layout = layoutFlow({ nodes: ["list", "detail"].map((id) => node(id)), flows: [link("detail", "list", "Back"), link("list", "detail")] });
  assert.equal(column(layout, "list"), 0);
  assert.equal(column(layout, "detail"), 1);
  const back = layout.edges.find((edge) => edge.from === "detail");
  assert.equal(back.back, true);
  assert.match(back.path, /^M /);
});

test("screens tied only by a cycle start at the one that comes first on the canvas", () => {
  const layout = layoutFlow({ nodes: ["a", "b", "c"].map((id) => node(id)), flows: [link("c", "a"), link("b", "c"), link("a", "b")] });
  assert.deepEqual(["a", "b", "c"].map((id) => column(layout, id)), [0, 1, 2]);
});

test("separate journeys get separate groups and unlinked screens wait apart", () => {
  const layout = layoutFlow({
    nodes: ["a", "b", "x", "y", "lonely"].map((id) => node(id)),
    flows: [link("a", "b"), link("x", "y")],
  });
  assert.deepEqual(layout.groups.map((group) => [group.ids, group.loose]), [
    [["a", "b"], false],
    [["x", "y"], false],
    [["lonely"], true],
  ]);
});

test("links to screens that are not drawn, to themselves or repeated are dropped", () => {
  const layout = layoutFlow({
    nodes: ["a", "b"].map((id) => node(id)),
    flows: [link("a", "b", "Open"), { from: "a", el: "other", to: "b", label: null }, link("a", "gone"), link("b", "b")],
  });
  assert.equal(layout.edges.length, 1);
  assert.equal(layout.edges[0].label, "Open");
});

test("an unlinked variation stacks under its screen instead of floating apart", () => {
  const layout = layoutFlow({
    nodes: [node("list"), node("list-empty", { variantOf: "list" }), node("detail")],
    flows: [link("list", "detail")],
  });
  const base = layout.positions.get("list");
  const variant = layout.positions.get("list-empty");
  assert.equal(variant.x, base.x);
  assert.equal(variant.y, base.y + FLOW.caption + 200 + FLOW.variantGap);
  assert.equal(layout.groups.length, 1);
  assert.equal(layout.groups[0].screens, 3);
});

test("screens of a step never overlap, whatever their height", () => {
  const layout = layoutFlow({
    nodes: [node("hub"), node("tall", { height: 1400 }), node("short"), node("next")],
    flows: [link("hub", "tall"), link("hub", "short"), link("hub", "next")],
  });
  const boxes = ["tall", "short", "next"].map((id) => ({ id, ...layout.positions.get(id) }));
  const heights = { tall: 1400, short: 200, next: 200 };
  boxes.sort((a, b) => a.y - b.y);
  for (let index = 1; index < boxes.length; index++) {
    const above = boxes[index - 1];
    assert.ok(boxes[index].y >= above.y + FLOW.caption + heights[above.id], `${boxes[index].id} overlaps ${above.id}`);
  }
});

test("arrows leaving one screen start at different heights", () => {
  const layout = layoutFlow({
    nodes: ["hub", "a", "b", "c"].map((id) => node(id)),
    flows: [link("hub", "a"), link("hub", "b"), link("hub", "c")],
  });
  const starts = layout.edges.map((edge) => edge.start.y);
  assert.equal(new Set(starts).size, 3);
});

test("a screen that only leads somewhere sits right before where it leads", () => {
  const layout = layoutFlow({
    nodes: ["a", "b", "c", "d", "shortcut"].map((id) => node(id)),
    flows: [link("a", "b"), link("b", "c"), link("c", "d"), link("shortcut", "d")],
  });
  assert.equal(column(layout, "a"), 0);
  assert.equal(column(layout, "d"), 3);
  assert.equal(column(layout, "shortcut"), 2);
});
