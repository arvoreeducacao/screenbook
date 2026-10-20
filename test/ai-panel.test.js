import { test } from "node:test";
import assert from "node:assert/strict";
import { expandCommand, formatReply, mentionsIn, trailSummary } from "../viewer/ai.js";

test("a slash command turns into the full request and keeps what the person added", () => {
  const variation = expandCommand("/variation more compact");
  assert.equal(variation.command.id, "variation");
  assert.match(variation.prompt, /2 variations[\s\S]*more compact$/);
  assert.equal(variation.rest, "more compact");
  assert.equal(expandCommand("/apply comments").command.id, "apply");
  assert.equal(expandCommand("/rev").command.id, "review");
  assert.deepEqual(expandCommand("/none of that"), { prompt: "/none of that", command: null });
});

test("@ cites known screens and pieces only, once each", () => {
  const screens = [{ id: "deal" }, { id: "home" }];
  assert.deepEqual(mentionsIn("compare @deal with @home/top and @deal again, not @ghost", screens), [{ screen: "deal" }, { screen: "home", el: "top" }]);
  assert.match(formatReply("look at @deal/card"), /<span class="ai-cite">@deal\/card<\/span>/);
});

test("the trail sums up how long the AI worked and how many steps it took", () => {
  assert.equal(trailSummary({ seconds: 83, trail: [{ kind: "tool" }, { kind: "note" }, { kind: "tool" }] }), "Worked for 1min 23s · 2 steps");
  assert.equal(trailSummary({ seconds: 9, trail: [{ kind: "tool" }] }), "Worked for 9s · 1 step");
});
