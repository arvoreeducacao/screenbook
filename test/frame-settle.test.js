import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../src/store/local.js";
import { Book } from "../src/book.js";
import { createViewerServer } from "../src/server.js";

const chrome = process.env.SCREENBOOK_CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((path) => existsSync(path));

let browser = null;
let server = null;
after(async () => {
  await browser?.close();
  server?.close();
});

test("a screen answers settle only after its page has loaded and its fonts are ready", { skip: !chrome && "no Chrome on this machine" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "screenbook-settle-"));
  const store = localStore(dir);
  const book = new Book(store);
  await book.init({ name: "CRM" });
  await book.writeScreen({
    proposal: "p",
    name: "List",
    section: "Deals",
    html: `<head><style>@font-face { font-family: "Slow"; src: url("/missing-font.woff2"); } body { font-family: "Slow", sans-serif; }</style></head><body><p data-el="title">Deals</p></body>`,
  });
  server = createViewerServer({ store, makeThumb: async () => Buffer.from("webp"), takeShot: async () => Buffer.alloc(0) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { chromium } = await import("playwright-core");
  browser = await chromium.launch({ executablePath: chrome });
  const page = await browser.newPage();
  const src = `http://127.0.0.1:${server.address().port}/api/screens/list/v1.html`;
  await page.setContent(`<script>
    window.answer = new Promise((resolve) => {
      const seen = [];
      addEventListener("message", (event) => {
        const frame = document.getElementById("screen");
        if (!frame || event.source !== frame.contentWindow) return;
        seen.push(event.data.type);
        if (event.data.type === "ready") frame.contentWindow.postMessage({ type: "settle", id: "s1" }, "*");
        if (event.data.type === "settled") resolve({ seen, id: event.data.id });
      });
      setTimeout(() => resolve({ seen, id: null }), 5000);
    });
  </script><iframe id="screen" style="width:600px;height:400px" src="${src}"></iframe>`);
  const answer = await page.evaluate(() => window.answer);
  assert.equal(answer.id, "s1");
  assert.deepEqual(answer.seen.filter((type) => type === "ready" || type === "settled"), ["ready", "settled"]);
});
