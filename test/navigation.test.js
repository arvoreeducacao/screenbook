import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesScreen } from "../viewer/layers.js";
import { rankItems } from "../viewer/palette.js";
import { boundsOf } from "../viewer/zoom.js";

const screen = { id: "order-receipt", number: 28, name: "Café order: the cart becomes a receipt", route: "/deals/[dealId]" };

test("a screen is found by name without accents, by number and by route", () => {
  assert.equal(matchesScreen(screen, "cafe receipt"), true);
  assert.equal(matchesScreen(screen, "28"), true);
  assert.equal(matchesScreen(screen, "/deals"), true);
  assert.equal(matchesScreen(screen, "refund"), false);
});

test("the palette hides screens until something is typed and puts prefix hits first", () => {
  const items = [
    { group: "Actions", label: "Adjust all" },
    { group: "Screens", label: screen.name, screen, searchOnly: true, rank: 2 },
    { group: "Sections", label: "Orders", rank: 1 },
  ];
  assert.deepEqual(rankItems(items, "").map((item) => item.label), ["Adjust all", "Orders"]);
  assert.deepEqual(rankItems(items, "ord").map((item) => item.label), ["Orders", screen.name]);
  assert.deepEqual(rankItems(items, "adj").map((item) => item.label), ["Adjust all"]);
});

test("bounds wrap every box", () => {
  assert.equal(boundsOf([]), null);
  assert.deepEqual(boundsOf([{ left: 10, top: 0, right: 20, bottom: 5 }, { left: -5, top: 3, right: 8, bottom: 40 }]), { left: -5, top: 0, right: 20, bottom: 40 });
});
