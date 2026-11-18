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

test("a screen measures its pieces only after its page has loaded, so a late image or font does not move them", { skip: !chrome && "no Chrome on this machine" }, async () => {
  const { createServer } = await import("node:http");
  const slow = createServer((request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="40"></svg>');
    }, 400);
  });
  await new Promise((resolve) => slow.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(join(tmpdir(), "screenbook-boxes-"));
  const store = localStore(dir);
  const book = new Book(store);
  await book.init({ name: "CRM" });
  await book.writeScreen({
    proposal: "p",
    name: "Order",
    section: "Orders",
    html: `<body style="margin:0"><div style="display:flex"><img src="http://127.0.0.1:${slow.address().port}/logo.svg"><button data-el="resend-link" style="margin:0">Resend</button></div></body>`,
  });
  const viewer = createViewerServer({ store, makeThumb: async () => Buffer.from("webp"), takeShot: async () => Buffer.alloc(0) });
  await new Promise((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  const { chromium } = await import("playwright-core");
  const own = await chromium.launch({ executablePath: chrome });
  try {
    const page = await own.newPage();
    const src = `http://127.0.0.1:${viewer.address().port}/api/screens/order/v1.html`;
    await page.setContent(`<script>
      window.answer = new Promise((resolve) => {
        addEventListener("message", (event) => {
          const frame = document.getElementById("screen");
          if (!frame || event.source !== frame.contentWindow) return;
          if (event.data.type === "ready") frame.contentWindow.postMessage({ type: "boxes", id: "b1" }, "*");
          if (event.data.type === "boxes") resolve(event.data.boxes);
        });
        setTimeout(() => resolve(null), 5000);
      });
    </script><iframe id="screen" style="width:600px;height:400px;border:0" src="${src}"></iframe>`);
    const boxes = await page.evaluate(() => window.answer);
    assert.ok(boxes?.["resend-link"], "the frame answered with the piece's box");
    assert.equal(Math.round(boxes["resend-link"].left * 600), 300);
  } finally {
    await own.close();
    viewer.close();
    slow.close();
  }
});
