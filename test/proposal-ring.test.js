import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";

const chrome = process.env.SCREENBOOK_CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((path) => existsSync(path));

test("at 500% the proposal ring stays thin on screen and the screen name sits clear above it", { skip: !chrome && "no Chrome on this machine" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-ring-"));
  const store = localStore(dir);
  const book = new Book(store);
  await book.init({ name: "Notes" });
  await book.writeScreen({
    proposal: "p",
    name: "Meeting note · keep the question · dark",
    section: "Notes",
    html: `<body style="margin:0;background:#1b1b1b;color:#eee"><h1 data-el="title">Planning</h1></body>`,
  });
  const viewer = createViewerServer({ store, makeThumb: async () => Buffer.from("webp"), takeShot: async () => Buffer.alloc(0) });
  await new Promise((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${viewer.address().port}/?proposal=p`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".frame.proposal .cap");
    await page.evaluate(() => {
      for (let step = 0; step < 40 && document.querySelector("#zoom-pct").textContent !== "500%"; step++) document.querySelector("#zoom-in").click();
    });
    assert.equal(await page.textContent("#zoom-pct"), "500%");
    const geometry = await page.evaluate(() => {
      const frame = document.querySelector(".frame.proposal");
      const shot = frame.querySelector(".shot");
      const shotBox = shot.getBoundingClientRect();
      const ring = getComputedStyle(shot, "::after");
      const screenPerRingPx = shotBox.width / parseFloat(ring.width);
      const ringThickness = parseFloat(ring.outlineWidth) * screenPerRingPx;
      const ringTop = shotBox.top - (parseFloat(ring.outlineOffset) + parseFloat(ring.outlineWidth)) * screenPerRingPx;
      return { ringThickness, ringTop, nameBottom: frame.querySelector(".cap").getBoundingClientRect().bottom };
    });
    assert.ok(geometry.ringThickness > 0 && geometry.ringThickness <= 2, `ring is ${geometry.ringThickness}px thick on screen`);
    assert.ok(geometry.nameBottom <= geometry.ringTop, `name ends at ${geometry.nameBottom}, ring starts at ${geometry.ringTop}`);
  } finally {
    await browser.close();
    viewer.close();
  }
});
