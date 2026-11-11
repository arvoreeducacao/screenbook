import { test } from "node:test";
import assert from "node:assert/strict";
import { cardAt, planCardFrames, ringOf, LOAD_STALL_MS, RING_GRACE_MS } from "../viewer/card-frames.js";

const view = { width: 1000, height: 600 };

function row(count, { top = 100, width = 150, gap = 20, left = 0, prefix = "s" } = {}) {
  return Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, left: left + index * (width + gap), top, width, height: 200 }));
}

function statesOf(plan) {
  return Object.fromEntries([...plan].map(([key, decided]) => [key, decided.state]));
}

function ready(states) {
  return new Map(Object.entries(states).map(([key, state]) => [key, { state, ready: true, outsideSince: null }]));
}

test("far from the screens every card stays an image", () => {
  const plan = planCardFrames({ cards: row(4), view, scale: 0.5 });
  assert.deepEqual(statesOf(plan), { s0: "image", s1: "image", s2: "image", s3: "image" });
});

test("at 100% the visible cards turn live, nearest to the middle first, within the ceiling", () => {
  const cards = row(9, { left: -40, width: 100, gap: 10 });
  const previous = ready(Object.fromEntries(cards.map((card) => [card.key, "warm"])));
  const plan = planCardFrames({ cards, view, scale: 1, previous, limits: { live: 6, warm: 4, loading: 2 } });
  const states = statesOf(plan);
  assert.equal(Object.values(states).filter((state) => state === "live").length, 6);
  assert.equal(states.s4, "live");
  assert.equal(states.s5, "live");
  assert.equal(states.s0, "warm");
  assert.equal(states.s8, "warm");
});

test("cards past both ceilings fall back to the image", () => {
  const cards = row(14, { left: 0, width: 60, gap: 10 });
  const previous = ready(Object.fromEntries(cards.map((card) => [card.key, "live"])));
  const plan = planCardFrames({ cards, view, scale: 1, previous, limits: { live: 6, warm: 4, loading: 2 } });
  const counts = Object.values(statesOf(plan)).reduce((sum, state) => ({ ...sum, [state]: (sum[state] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { live: 6, warm: 4, image: 4 });
});

test("between 80% and 100% the visible cards warm up without turning live", () => {
  const plan = planCardFrames({ cards: row(2), view, scale: 0.85 });
  assert.deepEqual(statesOf(plan), { s0: "warm", s1: "warm" });
});

test("a live card stays live until the zoom drops below 70%", () => {
  const previous = ready({ s0: "live", s1: "warm" });
  assert.deepEqual(statesOf(planCardFrames({ cards: row(2), view, scale: 0.75, previous })), { s0: "live", s1: "warm" });
  assert.deepEqual(statesOf(planCardFrames({ cards: row(2), view, scale: 0.69, previous })), { s0: "image", s1: "image" });
});

test("below 80% an image card does not start warming", () => {
  assert.deepEqual(statesOf(planCardFrames({ cards: row(1), view, scale: 0.75 })), { s0: "image" });
});

test("the ring reaches further ahead of the movement than behind it", () => {
  const still = ringOf(view, { x: 0, y: 0 });
  const moving = ringOf(view, { x: 1, y: 0 });
  assert.ok(moving.right > still.right);
  assert.equal(moving.left, still.left);
  const cards = [
    { key: "behind", left: -500, top: 100, width: 150, height: 200 },
    { key: "ahead", left: 1400, top: 100, width: 150, height: 200 },
  ];
  const plan = planCardFrames({ cards, view, scale: 1, velocity: { x: 1, y: 0 } });
  assert.deepEqual(statesOf(plan), { behind: "image", ahead: "warm" });
});

test("no more than two screens load at the same time", () => {
  const cards = row(5, { left: 0, width: 150, gap: 20 });
  assert.equal(Object.values(statesOf(planCardFrames({ cards, view, scale: 1 }))).filter((state) => state !== "image").length, 2);
  const previous = new Map([
    ["s0", { state: "live", ready: false, outsideSince: null }],
    ["s1", { state: "live", ready: false, outsideSince: null }],
  ]);
  const plan = statesOf(planCardFrames({ cards, view, scale: 1, previous }));
  assert.deepEqual(plan, { s0: "live", s1: "live", s2: "image", s3: "image", s4: "image" });
});

test("a load that never finishes stops holding its slot after a while", () => {
  const cards = row(3);
  const stuck = (openedAt) => new Map([
    ["s0", { state: "warm", ready: false, outsideSince: null, openedAt }],
    ["s1", { state: "warm", ready: false, outsideSince: null, openedAt }],
  ]);
  assert.equal(statesOf(planCardFrames({ cards, view, scale: 1, previous: stuck(0), now: LOAD_STALL_MS - 1 })).s2, "image");
  assert.equal(statesOf(planCardFrames({ cards, view, scale: 1, previous: stuck(0), now: LOAD_STALL_MS })).s2, "live");
});

test("a screen in view takes the slot of a screen still loading out of view", () => {
  const cards = [
    { key: "below-a", left: 0, top: 700, width: 150, height: 200 },
    { key: "below-b", left: 200, top: 700, width: 150, height: 200 },
    { key: "seen", left: 100, top: 100, width: 150, height: 200 },
  ];
  const previous = new Map([
    ["below-a", { state: "warm", ready: false, outsideSince: null, openedAt: 0 }],
    ["below-b", { state: "warm", ready: false, outsideSince: null, openedAt: 0 }],
  ]);
  const plan = statesOf(planCardFrames({ cards, view, scale: 1, previous, now: 10 }));
  assert.equal(plan.seen, "live");
  assert.equal(Object.values(plan).filter((state) => state === "warm").length, 1);
});

test("a fast pan starts nothing new and keeps what is already loaded", () => {
  const cards = row(3);
  const previous = ready({ s0: "live" });
  const plan = statesOf(planCardFrames({ cards, view, scale: 1, velocity: { x: 3, y: 0 }, previous }));
  assert.deepEqual(plan, { s0: "live", s1: "image", s2: "image" });
});

test("the screen under the comment cursor turns live at any zoom, ahead of the queue", () => {
  const cards = row(4);
  const previous = new Map([
    ["s0", { state: "warm", ready: false, outsideSince: null }],
    ["s1", { state: "warm", ready: false, outsideSince: null }],
  ]);
  const plan = statesOf(planCardFrames({ cards, view, scale: 0.3, target: "s3", previous }));
  assert.equal(plan.s3, "live");
  assert.equal(plan.s2, "image");
});

test("a card that leaves the ring keeps its code for a moment before it goes back to the image", () => {
  const cards = [{ key: "gone", left: 5000, top: 100, width: 150, height: 200 }];
  const previous = ready({ gone: "live" });
  const first = planCardFrames({ cards, view, scale: 1, previous, now: 1000 });
  assert.deepEqual(first.get("gone"), { state: "warm", outsideSince: 1000 });
  const kept = new Map([["gone", { state: "warm", ready: true, outsideSince: 1000 }]]);
  assert.equal(planCardFrames({ cards, view, scale: 1, previous: kept, now: 1000 + RING_GRACE_MS - 1 }).get("gone").state, "warm");
  assert.equal(planCardFrames({ cards, view, scale: 1, previous: kept, now: 1000 + RING_GRACE_MS }).get("gone").state, "image");
});

test("the card under a point is found by its rectangle", () => {
  const cards = row(3);
  assert.equal(cardAt(cards, { x: 180, y: 150 }), "s1");
  assert.equal(cardAt(cards, { x: 160, y: 150 }), null);
  assert.equal(cardAt(cards, null), null);
});
