import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { screenshot, closeRenderer } from "../src/render.js";

const hasChrome =
  process.env.SCREENBOOK_CHROME || existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") || existsSync("/usr/bin/google-chrome");

after(() => closeRenderer());

test("renders html to a png of the asked size", { skip: !hasChrome && "no Chrome on this machine" }, async () => {
  const png = await screenshot("<!doctype html><body style='margin:0;background:#0a0'>hi</body>", { width: 320, height: 200 });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 320);
  assert.equal(png.readUInt32BE(20), 200);
});
