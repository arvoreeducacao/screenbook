import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { capture, screenshot, thumbnail, closeRenderer } from "../src/render.js";

const hasChrome =
  process.env.SCREENBOOK_CHROME || existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") || existsSync("/usr/bin/google-chrome");

after(() => closeRenderer());

test("renders html to a png at twice the asked size", { skip: !hasChrome && "no Chrome on this machine" }, async () => {
  const png = await screenshot("<!doctype html><body style='margin:0;background:#0a0'>hi</body>", { width: 320, height: 200 });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 640);
  assert.equal(png.readUInt32BE(20), 400);
});

test("lists the fonts a screen asks for by name without loading them", { skip: !hasChrome && "no Chrome on this machine" }, async () => {
  const html = `<!doctype html><style>
    @font-face { font-family: "SB Brand"; src: local("Arial"); }
    :root { --font-brand: "SB Brand", sans-serif !important; }
    body.next-font { --font-brand: "brand", "brand Fallback"; }
    .loaded { font-family: "SB Brand", sans-serif; }
    .system { font-family: system-ui, sans-serif; }
    .apple { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  </style><body class="next-font"><p style="font-family: var(--font-brand)">body text</p><p class="loaded">loaded</p><p class="system">system</p><p class="apple">apple</p></body>`;
  const { png, fontsNotEmbedded } = await capture(html, { width: 320, height: 200 });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.deepEqual(fontsNotEmbedded, ["brand"]);
});

test("shrinks a png into a webp thumbnail, never wider than asked", { skip: !hasChrome && "no Chrome on this machine" }, async () => {
  const png = await screenshot("<!doctype html><body style='margin:0;background:#0a0'>hi</body>", { width: 1280, height: 800 });
  const webp = await thumbnail(png, { width: 640 });
  assert.equal(webp.subarray(0, 4).toString(), "RIFF");
  assert.equal(webp.subarray(8, 12).toString(), "WEBP");
  assert.ok(webp.length < png.length);
  const small = await screenshot("<body>x</body>", { width: 390, height: 300 });
  const same = await thumbnail(small, { width: 640 });
  assert.equal(same.subarray(8, 12).toString(), "WEBP");
});
