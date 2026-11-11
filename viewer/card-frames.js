export const CARD_FRAME_LIMITS = { live: 6, warm: 4, loading: 2 };
export const WARM_SCALE = 0.8;
export const LIVE_SCALE = 1;
export const DROP_SCALE = 0.7;
export const RING_GRACE_MS = 2000;
export const FAST_PAN = 1.5;
export const LOAD_STALL_MS = 3000;

const RING_MARGIN = 0.2;
const LOOKAHEAD_MS = 400;
const MAX_LEAD = 0.8;
const TARGET_LOOKAHEAD_MS = 250;
const SWAP_MS = 150;

function leadOf(speed, size) {
  return Math.sign(speed) * Math.min(size * MAX_LEAD, Math.abs(speed) * LOOKAHEAD_MS);
}

export function ringOf(view, velocity) {
  const leadX = leadOf(velocity.x, view.width);
  const leadY = leadOf(velocity.y, view.height);
  return {
    left: -view.width * RING_MARGIN + Math.min(0, leadX),
    right: view.width * (1 + RING_MARGIN) + Math.max(0, leadX),
    top: -view.height * RING_MARGIN + Math.min(0, leadY),
    bottom: view.height * (1 + RING_MARGIN) + Math.max(0, leadY),
  };
}

function overlaps(card, area) {
  return card.left < area.right && card.left + card.width > area.left && card.top < area.bottom && card.top + card.height > area.top;
}

export function cardAt(cards, point) {
  if (!point) return null;
  const hit = cards.find((card) => point.x >= card.left && point.x <= card.left + card.width && point.y >= card.top && point.y <= card.top + card.height);
  return hit?.key ?? null;
}

function wantedState(row, scale, target, now) {
  if (row.card.key === target) return "live";
  if (scale < DROP_SCALE) return "image";
  if (!row.inRing) return row.held && now - row.outsideSince < RING_GRACE_MS ? "warm" : "image";
  if (row.visible && (scale >= LIVE_SCALE || row.before?.state === "live")) return "live";
  if (scale >= WARM_SCALE || row.held) return "warm";
  return "image";
}

export function planCardFrames({ cards, view, scale, velocity = { x: 0, y: 0 }, target = null, previous = new Map(), now = 0, limits = CARD_FRAME_LIMITS }) {
  const ring = ringOf(view, velocity);
  const screen = { left: 0, top: 0, right: view.width, bottom: view.height };
  const focus = { x: view.width / 2 + leadOf(velocity.x, view.width), y: view.height / 2 + leadOf(velocity.y, view.height) };
  const fast = Math.hypot(velocity.x, velocity.y) > FAST_PAN;
  const rows = cards.map((card) => {
    const before = previous.get(card.key);
    const inRing = overlaps(card, ring);
    const row = {
      card,
      before,
      held: Boolean(before && before.state !== "image"),
      visible: overlaps(card, screen),
      inRing,
      outsideSince: inRing ? null : before?.outsideSince ?? now,
      distance: Math.hypot(card.left + card.width / 2 - focus.x, card.top + card.height / 2 - focus.y),
    };
    row.want = wantedState(row, scale, target, now);
    return row;
  });
  const byPriority = (a, b) => Number(b.card.key === target) - Number(a.card.key === target) || a.distance - b.distance;
  rows.filter((row) => row.want === "live").sort(byPriority).slice(limits.live).forEach((row) => (row.want = "warm"));
  rows.filter((row) => row.want === "warm").sort(byPriority).slice(limits.warm).forEach((row) => (row.want = "image"));
  const loadingRows = rows.filter((row) => row.held && row.want !== "image" && !row.before.ready && now - (row.before.openedAt ?? now) < LOAD_STALL_MS);
  let loading = loadingRows.length;
  const evictable = loadingRows.filter((row) => !row.visible && row.card.key !== target).sort(byPriority).reverse();
  for (const row of rows.filter((entry) => entry.want !== "image" && !entry.held).sort(byPriority)) {
    if (row.card.key !== target && fast) row.want = "image";
    else if (row.card.key === target || loading < limits.loading) loading++;
    else if (row.visible && evictable.length) evictable.shift().want = "image";
    else row.want = "image";
  }
  return new Map(rows.map((row) => [row.card.key, { state: row.want, outsideSince: row.outsideSince }]));
}

export function createCardFrames({ frameUrl, cards, view, scale, translation, commenting, limits = CARD_FRAME_LIMITS, clock = () => performance.now() }) {
  const frames = new Map();
  const parking = document.createElement("div");
  parking.className = "card-frames-parking";
  document.body.appendChild(parking);
  let last = null;
  let velocity = { x: 0, y: 0 };
  let pointer = null;
  let pointerVelocity = { x: 0, y: 0 };
  let scheduled = 0;
  let deadline = 0;
  let asks = 0;

  function measureVelocity(now) {
    const { x, y } = translation();
    const zoom = scale();
    if (last && last.scale === zoom && now > last.at) {
      const gap = now - last.at;
      const blend = Math.min(1, gap / 100);
      velocity = { x: velocity.x * (1 - blend) + ((last.x - x) / gap) * blend, y: velocity.y * (1 - blend) + ((last.y - y) / gap) * blend };
    } else {
      velocity = { x: 0, y: 0 };
    }
    last = { x, y, scale: zoom, at: now };
  }

  function targetOf(list) {
    if (!commenting() || !pointer) return null;
    const ahead = { x: pointer.x + pointerVelocity.x * TARGET_LOOKAHEAD_MS, y: pointer.y + pointerVelocity.y * TARGET_LOOKAHEAD_MS };
    return cardAt(list, pointer) ?? cardAt(list, ahead);
  }

  function open(card) {
    const holder = document.createElement("div");
    holder.className = "code-frame";
    const iframe = document.createElement("iframe");
    iframe.tabIndex = -1;
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.width = `${card.screenWidth}px`;
    iframe.style.height = `${card.screenHeight}px`;
    iframe.style.transform = `scale(${card.boxWidth / card.screenWidth})`;
    holder.appendChild(iframe);
    const frame = { key: card.key, screen: card.screen, version: card.version, holder, iframe, box: null, state: "warm", ready: false, outsideSince: null, openedAt: clock(), waiters: new Map() };
    iframe.src = frameUrl(card.screen, card.version);
    frames.set(card.key, frame);
    return frame;
  }

  function place(frame, box) {
    if (frame.box === box && frame.holder.parentElement === box) return;
    frame.box?.classList.remove("has-code", "code-live");
    frame.box = box;
    box.classList.add("has-code");
    if (frame.holder.isConnected && typeof box.moveBefore === "function") box.moveBefore(frame.holder, box.firstChild);
    else box.prepend(frame.holder);
  }

  function close(frame) {
    frames.delete(frame.key);
    frame.waiters.forEach((resolve) => resolve(null));
    const box = frame.box;
    box?.classList.remove("code-live");
    setTimeout(() => {
      frame.holder.remove();
      if (box && ![...frames.values()].some((other) => other.box === box)) box.classList.remove("has-code");
    }, SWAP_MS);
  }

  function show(frame) {
    frame.box?.classList.toggle("code-live", frame.state === "live" && frame.ready);
  }

  function tick() {
    scheduled = 0;
    const now = clock();
    measureVelocity(now);
    const list = cards();
    const plan = planCardFrames({ cards: list, view: view(), scale: scale(), velocity, target: targetOf(list), previous: frames, now, limits });
    const byKey = new Map(list.map((card) => [card.key, card]));
    for (const frame of [...frames.values()]) {
      if (plan.get(frame.key)?.state && plan.get(frame.key).state !== "image") continue;
      close(frame);
    }
    for (const [key, decided] of plan) {
      if (decided.state === "image") continue;
      const card = byKey.get(key);
      const frame = frames.get(key) ?? open(card);
      frame.state = decided.state;
      frame.outsideSince = decided.outsideSince;
      place(frame, card.box);
      show(frame);
    }
    if (Math.hypot(velocity.x, velocity.y) > 0.01) schedule();
    else wakeAtNextDeadline(now);
  }

  function wakeAtNextDeadline(now) {
    clearTimeout(deadline);
    const due = [...frames.values()].flatMap((frame) => [
      frame.outsideSince === null ? Infinity : frame.outsideSince + RING_GRACE_MS,
      frame.ready ? Infinity : frame.openedAt + LOAD_STALL_MS,
    ]);
    const next = Math.min(...due);
    if (Number.isFinite(next)) deadline = setTimeout(schedule, Math.max(0, next - now) + 16);
  }

  function schedule() {
    if (!scheduled) scheduled = requestAnimationFrame(tick);
  }

  function frameOf(source) {
    for (const frame of frames.values()) if (frame.iframe.contentWindow === source) return frame;
    return null;
  }

  window.addEventListener("message", (event) => {
    const frame = frameOf(event.source);
    if (!frame) return;
    const data = event.data ?? {};
    if (data.type === "ready") frame.iframe.contentWindow?.postMessage({ type: "settle" }, "*");
    if (data.type === "settled") {
      frame.ready = true;
      show(frame);
      schedule();
    }
    if (data.id && frame.waiters.has(data.id)) {
      frame.waiters.get(data.id)(data);
      frame.waiters.delete(data.id);
    }
  });

  return {
    update: schedule,
    point(position) {
      const now = clock();
      if (position && pointer && now > pointer.at) pointerVelocity = { x: (position.x - pointer.x) / (now - pointer.at), y: (position.y - pointer.y) / (now - pointer.at) };
      else if (!position) pointerVelocity = { x: 0, y: 0 };
      pointer = position ? { x: position.x, y: position.y, at: now } : null;
      schedule();
    },
    park() {
      for (const frame of frames.values()) {
        if (!frame.holder.isConnected) continue;
        if (typeof parking.moveBefore === "function") parking.moveBefore(frame.holder, null);
        frame.box?.classList.remove("has-code", "code-live");
        frame.box = null;
      }
    },
    adopt() {
      const byKey = new Map(cards().map((card) => [card.key, card]));
      for (const frame of [...frames.values()]) {
        const card = byKey.get(frame.key);
        if (!card || !frame.holder.isConnected) {
          frames.delete(frame.key);
          frame.holder.remove();
          continue;
        }
        place(frame, card.box);
        show(frame);
      }
      schedule();
    },
    ask(screen, version, message, timeout) {
      const frame = [...frames.values()].find((entry) => entry.screen === screen && entry.version === version && entry.ready);
      if (!frame) return null;
      const id = `card-frame-${++asks}`;
      const answer = new Promise((resolve) => {
        frame.waiters.set(id, resolve);
        frame.iframe.contentWindow?.postMessage({ ...message, id }, "*");
      });
      return Promise.race([answer, new Promise((resolve) => setTimeout(() => resolve(null), timeout))]);
    },
  };
}
