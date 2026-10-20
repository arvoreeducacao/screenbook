import { test } from "node:test";
import assert from "node:assert/strict";
import { stickyAnchor, stickyPlace } from "../viewer/stickies.js";

const sections = [{ id: "login", box: { left: 0, top: 100, right: 500, bottom: 400 } }];

test("a sticky dropped inside a section rides with it, outside it stays put", () => {
  const inside = stickyAnchor({ x: 50, y: 150 }, sections);
  assert.deepEqual(inside, { section: "login", x: 50, y: 50 });
  assert.deepEqual(stickyPlace(inside, [{ id: "login", box: { left: 0, top: 900, right: 500, bottom: 1200 } }]), { x: 50, y: 950 });
  const outside = stickyAnchor({ x: 900, y: 20 }, sections);
  assert.deepEqual(outside, { section: null, x: 900, y: 20 });
  assert.deepEqual(stickyPlace(outside, sections), { x: 900, y: 20 });
  assert.equal(stickyPlace({ section: "gone", x: 0, y: 0 }, sections), null);
});
