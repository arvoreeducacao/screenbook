import { test } from "node:test";
import assert from "node:assert/strict";
import { box4, colorText, cssFor, firstFamily, fontLine, parseRgb, tokensByColor, visibleTokens } from "../viewer/inspect.js";
import { diffRegions, paintDiff, timeline } from "../viewer/history.js";
import { deviceOf, outgoing, playVersion, viewHeight } from "../viewer/present.js";
import { cropBox, fileName } from "../viewer/export.js";

const styles = {
  display: "flex", flexDirection: "column", flexWrap: "nowrap", justifyContent: "normal", alignItems: "center", gap: "8px",
  paddingTop: "12px", paddingRight: "16px", paddingBottom: "12px", paddingLeft: "16px",
  marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
  backgroundColor: "rgb(255, 255, 255)", backgroundImage: "none", color: "rgba(17, 17, 17, 0.5)", opacity: "1",
  borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px", borderTopStyle: "solid",
  borderTopColor: "rgb(234, 235, 238)", borderRightColor: "rgb(234, 235, 238)", borderBottomColor: "rgb(234, 235, 238)", borderLeftColor: "rgb(234, 235, 238)",
  borderTopLeftRadius: "8px", borderTopRightRadius: "8px", borderBottomRightRadius: "8px", borderBottomLeftRadius: "8px",
  boxShadow: "none", fontFamily: '"Inter", sans-serif', fontSize: "14px", fontWeight: "600", fontStyle: "normal", lineHeight: "20px",
  letterSpacing: "normal", textAlign: "start", textTransform: "none", textDecorationLine: "none",
};

test("colors read from computed styles become hex, with the alpha as a percent", () => {
  assert.deepEqual(parseRgb("rgba(17, 17, 17, 0.5)"), { r: 17, g: 17, b: 17, alpha: 0.5 });
  assert.equal(colorText("rgb(78, 111, 255)"), "#4E6FFF");
  assert.equal(colorText("rgba(17, 17, 17, 0.5)"), "#111111 50%");
});

test("four sides collapse into the shortest shorthand", () => {
  assert.equal(box4("0px", "0px", "0px", "0px"), null);
  assert.equal(box4("8px", "8px", "8px", "8px"), "8px");
  assert.equal(box4("12px", "16px", "12px", "16px"), "12px 16px");
  assert.equal(box4("4px", "0px", "8px", "0px"), "4px 0 8px");
  assert.equal(box4("1px", "2px", "3px", "4px"), "1px 2px 3px 4px");
});

test("the css of a piece keeps what matters and drops the defaults", () => {
  const css = cssFor({ box: { x: 0, y: 0, w: 120.5, h: 44 }, styles, ownText: true });
  assert.match(css, /^width: 120\.5px;\nheight: 44px;/);
  assert.match(css, /display: flex;\nflex-direction: column;\nalign-items: center;/);
  assert.match(css, /gap: 8px;/);
  assert.match(css, /padding: 12px 16px;/);
  assert.doesNotMatch(css, /margin/);
  assert.match(css, /background: #FFFFFF;/);
  assert.match(css, /border: 1px solid #EAEBEE;/);
  assert.match(css, /border-radius: 8px;/);
  assert.match(css, /color: rgba\(17, 17, 17, 0\.5\);/);
  assert.match(css, /font-weight: 600;/);
  assert.doesNotMatch(css, /letter-spacing|text-align|box-shadow|opacity/);
  assert.doesNotMatch(cssFor({ box: { x: 0, y: 0, w: 10, h: 10 }, styles, ownText: false }), /font-size/);
});

test("tokens are matched to colors, preferring the ones the screen uses", () => {
  const tokens = [
    { name: "--color-primary", color: "rgb(78, 111, 255)", used: "via" },
    { name: "--primary", color: "rgb(78, 111, 255)", used: "direct" },
    { name: "--radius", value: "8px", color: null, used: "direct" },
    { name: "--unused", color: "rgb(0, 0, 0)", used: null },
  ];
  assert.deepEqual(tokensByColor(tokens).get("#4E6FFF").map((token) => token.name), ["--primary", "--color-primary"]);
  assert.deepEqual(visibleTokens(tokens, "used").map((token) => token.name), ["--color-primary", "--primary", "--radius"]);
  assert.equal(visibleTokens(tokens, "all").length, 4);
});

test("fonts read as family, size over line height and weight", () => {
  assert.equal(firstFamily('"Newsreader", Georgia, serif'), "Newsreader");
  assert.equal(fontLine({ family: "Inter, sans-serif", size: "14px", lineHeight: "20px", weight: "600", style: "normal" }), "Inter · 14/20 · 600");
  assert.equal(fontLine({ family: "Inter", size: "13px", lineHeight: "normal", weight: "400", style: "italic" }), "Inter · 13/auto · 400 italic");
});

test("the timeline lists versions newest first with their proposal and marks", () => {
  const screen = { id: "list", official: 1, versions: [{ v: 1, proposal: "a", by: "claude", at: "2026-10-01" }, { v: 2, proposal: "b", by: "Marina", at: "2026-10-02", restoredFrom: 1 }] };
  const rows = timeline(screen, [{ id: "a", title: "Primeira", status: "approved" }, { id: "b", title: "Volta", status: "open" }]);
  assert.deepEqual(rows.map((row) => row.v), [2, 1]);
  assert.equal(rows[0].latest, true);
  assert.equal(rows[0].restoredFrom, 1);
  assert.equal(rows[0].proposal.label, "still open");
  assert.equal(rows[1].official, true);
  assert.equal(rows[1].proposal.title, "Primeira");
});

test("the diff finds the changed areas and paints them over a faded screen", () => {
  const width = 40;
  const height = 30;
  const before = new Uint8ClampedArray(width * height * 4).fill(255);
  const after = new Uint8ClampedArray(before);
  for (let y = 4; y < 8; y += 1) for (let x = 2; x < 6; x += 1) after.set([0, 0, 0, 255], (y * width + x) * 4);
  for (let y = 20; y < 22; y += 1) for (let x = 30; x < 34; x += 1) after.set([0, 0, 0, 255], (y * width + x) * 4);
  const { count, boxes, changed } = diffRegions(before, after, width, height, { cell: 4, gap: 1 });
  assert.equal(count, 16 + 8);
  assert.deepEqual(boxes, [{ x: 0, y: 4, w: 8, h: 4 }, { x: 28, y: 20, w: 8, h: 4 }]);
  const painted = paintDiff(after, changed, width, height);
  assert.notEqual(painted[(5 * width + 3) * 4], painted[(5 * width + 3) * 4 + 1]);
  assert.equal(painted[0], 255);
  assert.equal(diffRegions(before, before, width, height).boxes.length, 0);
});

test("presenting picks the proposal's version, then the official, then the latest", () => {
  const screen = { id: "list", official: 2, versions: [{ v: 1 }, { v: 2 }, { v: 3 }] };
  assert.equal(playVersion(screen, { screens: { list: 3 } }), 3);
  assert.equal(playVersion(screen, { screens: { list: 9 } }), 2);
  assert.equal(playVersion(screen, null), 2);
  assert.equal(playVersion({ ...screen, official: null }, null), 3);
});

test("the links out of a screen split into hotspots and loose links to known screens", () => {
  const screens = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const flows = [
    { from: "a", el: "row", to: "b" },
    { from: "a", el: "row", to: "c" },
    { from: "a", el: null, to: "c", label: "Depois" },
    { from: "a", el: "x", to: "gone" },
    { from: "b", el: "back", to: "a" },
  ];
  const { hotspots, loose } = outgoing(flows, screens, "a");
  assert.deepEqual([...hotspots.keys()], ["row"]);
  assert.equal(hotspots.get("row").to, "b");
  assert.deepEqual(loose.map((flow) => flow.to), ["c"]);
});

test("the device frame follows the screen width and the view is a real screen height", () => {
  assert.equal(deviceOf(390), "phone");
  assert.equal(deviceOf(820), "tablet");
  assert.equal(deviceOf(1280), "desktop");
  assert.equal(viewHeight({ width: 390, height: 2000 }), 844);
  assert.equal(viewHeight({ width: 1280, height: 2400 }), 800);
  assert.equal(viewHeight({ width: 1280, height: 600 }), 600);
});

test("exports get clean file names and crops stay inside the picture", () => {
  assert.equal(fileName("list", 3), "list-v3.png");
  assert.equal(fileName("list", 3, "Crème brûlée", "png"), "list-v3-creme-brulee.png");
  assert.equal(fileName("list", 3, "", "html"), "list-v3.html");
  assert.deepEqual(cropBox({ x: -4.5, y: 10.2, w: 50, h: 20 }, { width: 40, height: 100 }), { x: 0, y: 10, w: 40, h: 21 });
  assert.equal(cropBox({ x: 50, y: 0, w: 10, h: 10 }, { width: 40, height: 40 }), null);
});
