import { t } from "./i18n.js";

const COLORS = ["#8728E6", "#4E6FFF", "#00A86B", "#E6007A", "#F59E0B", "#0EA5E9", "#7C3AED", "#14B8A6"];
const SEND_EVERY_MS = 50;
const AGENT_GONE_MS = 120000;
const AGENT_QUIET_MS = 20000;
const BUSY = new Set(["looking", "reading", "drawing", "checking", "linking", "arranging", "inspecting", "searching", "learning"]);
const VERBS = {
  looking: "looking at the canvas",
  reading: "reading",
  drawing: "drawing",
  checking: "checking",
  linking: "linking the flow of",
  arranging: "rearranging the canvas",
  replying: "replying on",
  annotating: "annotating",
  inspecting: "measuring",
  searching: "looking for similar screens",
  learning: "learning from the guide",
  asking: "waiting for your answer",
  approving: "approving",
  archiving: "archiving",
  drew: "drew",
};
const READ_MS = 9000;
const GHOST_GAP = 60;
const WAVE_STEP_PX = 6;
const WAVE_TURNS = 4;
const WAVE_WINDOW_MS = 800;
const WAVE_SPAN_PX = 160;
const HAND_UP_MS = 3500;
const HIGH_FIVE_PX = 60;
const HIGH_FIVE_COOLDOWN_MS = 2500;
const HIGH_FIVE_LINGER_MS = 700;
const ARROW = '<svg viewBox="0 0 22 24" aria-hidden="true"><path d="M3 2.2 19.2 10.3 12 12.2 8.6 19.6Z" fill="var(--c)" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';

function colorFor(key) {
  let hash = 0;
  for (const char of String(key)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
}

export function clientId() {
  try {
    const saved = sessionStorage.getItem("screenbook.live");
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem("screenbook.live", fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

export function agentSpot(activity, now = Date.now()) {
  const age = Math.max(0, now - new Date(activity.at).getTime());
  if (activity.action === "reading" || activity.action === "checking") {
    const line = Math.floor(age / 1400);
    const progress = (age % READ_MS) / READ_MS;
    return { rx: line % 2 ? 0.72 : 0.22, ry: 0.08 + progress * 0.8 };
  }
  if (activity.action === "drawing") {
    const stroke = Math.floor(age / 1400);
    const angle = stroke * 2.4;
    return { rx: 0.5 + Math.cos(angle) * 0.28, ry: 0.42 + Math.sin(angle * 1.3) * 0.26 };
  }
  return { rx: 0.62, ry: 0.36 };
}

export function ghostRect(activity, placed, frameWidth) {
  const width = frameWidth;
  const height = Math.round(frameWidth * (800 / 1280));
  const sameScreen = (entry, id) => entry.item.screen.id === id;
  const base = activity.variantOf ? placed.filter((entry) => sameScreen(entry, activity.variantOf)).at(-1) : null;
  if (base) {
    const below = placed.filter((entry) => entry.item.screen.variantOf === activity.variantOf || entry === base).sort((a, b) => b.y + b.height - (a.y + a.height))[0] ?? base;
    return { x: base.x, y: below.y + below.height + GHOST_GAP, width, height };
  }
  const after = activity.after ? placed.find((entry) => sameScreen(entry, activity.after)) : null;
  const inSection = activity.section ? placed.filter((entry) => entry.item.screen.section === activity.section && !entry.item.screen.variantOf) : [];
  const inProposal = activity.proposal ? placed.filter((entry) => entry.item.proposal?.id === activity.proposal) : [];
  const anchor = after ?? inProposal.at(-1) ?? inSection.sort((a, b) => a.x + a.width - (b.x + b.width)).at(-1) ?? placed.at(-1);
  if (!anchor) return { x: 0, y: 0, width, height };
  return { x: anchor.x + (anchor.reach ?? anchor.width) + GHOST_GAP, y: anchor.y, width, height };
}

export function startLive({ base, state, viewport, people, myName, screenName, onAgentDrew, applyView, onFollowLook, pieceBox = () => null }) {
  const id = clientId();
  const layer = document.createElement("div");
  layer.id = "cursors";
  document.body.appendChild(layer);
  const banner = document.createElement("div");
  banner.id = "following";
  banner.hidden = true;
  banner.innerHTML = `<span class="following-pill"><span class="following-label"></span><button type="button">${t("Stop")}</button></span>`;
  document.body.appendChild(banner);
  const others = new Map();
  const agents = new Map();
  let current = null;
  let following = null;
  let steering = false;
  let sentAt = 0;
  let timer = null;
  let lastPointer = null;
  let looking = null;
  let handUntil = 0;
  let handTimer = null;
  const wave = { dir: 0, edge: null, turns: [] };
  const fived = new Map();
  let fiving = null;
  const myHand = document.createElement("div");
  myHand.className = "cursor hand mine away";
  myHand.innerHTML = '<span class="cursor-hand">👋</span>';
  layer.appendChild(myHand);
  let seenDrew = "";

  function send(cursor) {
    current = cursor;
    schedule();
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, SEND_EVERY_MS - (Date.now() - sentAt)));
  }

  function myView() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return null;
    const center = toWorld(width / 2, height / 2);
    return { cx: center.x, cy: center.y, w: width / state.scale, h: height / state.scale };
  }

  function flush() {
    timer = null;
    sentAt = Date.now();
    fetch(`${base}/api/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, cursor: outgoingCursor(), view: myView(), following }),
    }).catch(() => {});
  }

  function toWorld(clientX, clientY) {
    return { x: (clientX - state.tx) / state.scale, y: (clientY - state.ty) / state.scale };
  }

  function toScreen(point) {
    return { left: state.tx + point.x * state.scale, top: state.ty + point.y * state.scale };
  }

  function placedFor(screen, version) {
    return (
      state.placed.find((entry) => entry.item.screen.id === screen && entry.item.version === version) ??
      state.placed.find((entry) => entry.item.screen.id === screen)
    );
  }

  function anchorOf(point) {
    const entry = state.placed.find((item) => point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height);
    if (!entry) return { x: point.x, y: point.y };
    return {
      x: point.x,
      y: point.y,
      screen: entry.item.screen.id,
      version: entry.item.version,
      rx: (point.x - entry.x) / entry.width,
      ry: (point.y - entry.y) / entry.height,
    };
  }

  function pointOf(cursor) {
    if (!cursor) return null;
    if (cursor.page && state.page && cursor.page !== state.page) return null;
    if (cursor.screen) {
      const entry = placedFor(cursor.screen, cursor.version);
      if (entry) return { x: entry.x + (cursor.rx ?? 0.5) * entry.width, y: entry.y + (cursor.ry ?? 0.5) * entry.height };
    }
    return Number.isFinite(cursor.x) ? { x: cursor.x, y: cursor.y } : null;
  }

  function cursorElement(color, agent) {
    const element = document.createElement("div");
    element.className = `cursor${agent ? " agent" : ""}`;
    element.style.setProperty("--c", color);
    element.innerHTML = `${ARROW}<span class="cursor-hand">👋</span><span class="cursor-name"></span>`;
    layer.appendChild(element);
    return element;
  }

  function place(element, point) {
    if (!point) {
      element.classList.add("away");
      return;
    }
    const { left, top } = toScreen(point);
    element.classList.remove("away");
    element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function personLabel(person) {
    const looked = person.cursor?.looking && person.cursor.screen ? `<em>vendo ${escapeHtml(screenName(person.cursor.screen))}</em>` : "";
    return `${escapeHtml(person.name)}${looked}`;
  }

  function outgoingCursor() {
    const paged = current && state.page ? { ...current, page: state.page } : current;
    if (!paged || !handUp()) return paged;
    return fiving ? { ...paged, hand: true, five: fiving } : { ...paged, hand: true };
  }

  function handUp() {
    return Date.now() < handUntil;
  }

  function raiseHand() {
    const wasUp = handUp();
    handUntil = Date.now() + HAND_UP_MS;
    clearTimeout(handTimer);
    handTimer = setTimeout(lowerHand, HAND_UP_MS);
    if (wasUp) return;
    viewport.classList.add("waving");
    placeMyHand();
    schedule();
  }

  function lowerHand() {
    clearTimeout(handTimer);
    handUntil = 0;
    fiving = null;
    viewport.classList.remove("waving");
    myHand.classList.add("away");
    schedule();
  }

  function placeMyHand() {
    if (!handUp() || !lastPointer) return myHand.classList.add("away");
    myHand.classList.remove("away");
    myHand.style.transform = `translate3d(${lastPointer.x}px, ${lastPointer.y}px, 0)`;
  }

  function trackWave(x, y) {
    const now = Date.now();
    if (!wave.edge) {
      wave.edge = { x, y };
      return;
    }
    const dx = x - wave.edge.x;
    if (!wave.dir) {
      if (Math.abs(dx) >= WAVE_STEP_PX) wave.dir = Math.sign(dx);
      wave.edge = Math.abs(dx) >= WAVE_STEP_PX ? { x, y } : wave.edge;
      return;
    }
    if (dx * wave.dir > 0) {
      wave.edge = { x, y };
      return;
    }
    if (-dx * wave.dir < WAVE_STEP_PX) return;
    wave.turns.push({ ...wave.edge, at: now });
    wave.dir = -wave.dir;
    wave.edge = { x, y };
    wave.turns = wave.turns.filter((turn) => now - turn.at <= WAVE_WINDOW_MS).slice(-WAVE_TURNS);
    if (wave.turns.length < WAVE_TURNS) return;
    const xs = wave.turns.map((turn) => turn.x);
    const ys = wave.turns.map((turn) => turn.y);
    if (Math.max(...xs) - Math.min(...xs) <= WAVE_SPAN_PX && Math.max(...ys) - Math.min(...ys) <= WAVE_SPAN_PX / 2) raiseHand();
  }

  function tryHighFive() {
    if (!handUp() || !lastPointer || looking) return;
    for (const person of others.values()) {
      if (!person.cursor?.hand || Date.now() - (fived.get(person.id) ?? 0) < HIGH_FIVE_COOLDOWN_MS) continue;
      const point = pointOf(person.cursor);
      if (!point) continue;
      const theirs = toScreen(point);
      if (Math.hypot(theirs.left - lastPointer.x, theirs.top - lastPointer.y) > HIGH_FIVE_PX) continue;
      slap(person, theirs);
      return;
    }
  }

  function slap(person, theirs) {
    fived.set(person.id, Date.now());
    const mine = lastPointer ?? theirs;
    highFive((theirs.left + mine.x) / 2, (theirs.top + mine.y) / 2, person.color);
    fiving = person.id;
    handUntil = Date.now() + HIGH_FIVE_LINGER_MS;
    clearTimeout(handTimer);
    handTimer = setTimeout(lowerHand, HIGH_FIVE_LINGER_MS);
    schedule();
  }

  function answerHighFive(person) {
    if (person.cursor?.five !== id || Date.now() - (fived.get(person.id) ?? 0) < HIGH_FIVE_COOLDOWN_MS) return;
    const point = pointOf(person.cursor);
    if (!point) return;
    const theirs = toScreen(point);
    slap(person, { left: theirs.left, top: theirs.top, x: theirs.left, y: theirs.top });
  }

  function highFive(left, top, color) {
    const burst = document.createElement("div");
    burst.className = "high-five";
    burst.style.setProperty("--c", color);
    burst.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    const sparks = Array.from({ length: 10 }, (_, index) => {
      const angle = (index / 10) * Math.PI * 2;
      return `<i style="--dx:${Math.round(Math.cos(angle) * 56)}px;--dy:${Math.round(Math.sin(angle) * 56)}px"></i>`;
    }).join("");
    burst.innerHTML = `<span class="five left">✋</span><span class="five right">✋</span>${sparks}`;
    layer.appendChild(burst);
    setTimeout(() => burst.remove(), 1200);
  }

  function drawPerson(person) {
    if (!person.element) person.element = cursorElement(person.color, false);
    person.element.classList.toggle("hand", person.cursor?.hand === true);
    person.element.querySelector(".cursor-name").innerHTML = personLabel(person);
    place(person.element, pointOf(person.cursor));
  }

  function upsertPerson(raw) {
    const known = others.get(raw.id);
    const person = known ?? { ...raw, color: colorFor(raw.login ?? raw.name ?? raw.id) };
    Object.assign(person, raw);
    others.set(raw.id, person);
    drawPerson(person);
  }

  function removePerson(personId) {
    others.get(personId)?.element?.remove();
    others.delete(personId);
    if (following === personId) stopFollowing();
  }

  function leaderLooking() {
    const cursor = others.get(following)?.cursor;
    return cursor?.looking && cursor.screen ? cursor : null;
  }

  function steer() {
    const leader = others.get(following);
    if (!leader) return stopFollowing();
    steering = true;
    try {
      if (leader.view) {
        state.manual = true;
        state.scale = Math.min(3, Math.max(0.05, Math.min(viewport.clientWidth / leader.view.w, viewport.clientHeight / leader.view.h)));
        state.tx = viewport.clientWidth / 2 - leader.view.cx * state.scale;
        state.ty = viewport.clientHeight / 2 - leader.view.cy * state.scale;
        applyView();
      } else {
        goTo(pointOf(leader.cursor));
      }
    } finally {
      steering = false;
    }
    const looked = leaderLooking();
    onFollowLook(looked?.screen ?? null, looked?.version);
  }

  function startFollowing(personId) {
    const leader = others.get(personId);
    if (!leader) return;
    following = personId;
    banner.style.setProperty("--c", leader.color);
    banner.querySelector(".following-label").textContent = t("Following {name}", { name: leader.name });
    banner.hidden = false;
    drawPeople();
    steer();
    schedule();
  }

  function stopFollowing() {
    if (!following) return;
    following = null;
    banner.hidden = true;
    drawPeople();
    schedule();
  }

  banner.querySelector("button").addEventListener("click", stopFollowing);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") stopFollowing();
  });
  window.addEventListener("resize", () => {
    if (following) steer();
  });

  function agentAge(activity) {
    return Date.now() - new Date(activity.at).getTime();
  }

  function screenTitle(id, fallback) {
    const screen = state.data?.screens.find((item) => item.id === id);
    return screen ? `${screen.number} · ${screen.name}` : screenName(id, fallback);
  }

  function pieceRect(entry, el) {
    if (!el) return null;
    const box = pieceBox(entry.item.screen.id, entry.item.version, el);
    if (!box) return null;
    return { x: entry.x + box.left * entry.width, y: entry.y + box.top * entry.height, width: Math.max(8, box.width * entry.width), height: Math.max(8, box.height * entry.height) };
  }

  function agentTarget(agent) {
    const activity = agent.activity;
    agent.entry = null;
    agent.piece = null;
    agent.ghost = null;
    if (activity.page && state.boardPage) {
      if (activity.page !== state.page) return agent.point ?? toWorld(viewport.clientWidth * 0.62, viewport.clientHeight * 0.45);
      if (Number.isFinite(activity.boardX)) {
        const sway = BUSY.has(activity.action) ? Math.floor(agentAge(activity) / 1400) : 0;
        return { x: activity.boardX + (sway % 2 ? 26 : -10), y: activity.boardY + (sway % 3) * 14 };
      }
    }
    if (activity.screen) {
      const entry = placedFor(activity.screen, activity.version);
      if (entry) {
        agent.entry = entry;
        const piece = pieceRect(entry, activity.el);
        if (piece) {
          agent.piece = piece;
          return { x: piece.x + Math.min(piece.width * 0.55, piece.width - 4), y: piece.y + Math.min(piece.height * 0.6, piece.height - 4) };
        }
        const spot = agentSpot(activity);
        return { x: entry.x + spot.rx * entry.width, y: entry.y + spot.ry * entry.height };
      }
      if (activity.action === "drawing" && state.placed.length) {
        const ghost = ghostRect(activity, state.placed, state.placed[0].width);
        agent.ghost = ghost;
        const spot = agentSpot(activity);
        return { x: ghost.x + spot.rx * ghost.width, y: ghost.y + spot.ry * ghost.height };
      }
    }
    if (activity.proposal) {
      const inProposal = state.placed.filter((entry) => entry.item.proposal?.id === activity.proposal);
      const entry = inProposal[Math.floor(agentAge(activity) / 2800) % Math.max(1, inProposal.length)];
      if (entry) {
        agent.entry = entry;
        return { x: entry.x + entry.width * 0.5, y: entry.y + entry.height * 0.3 };
      }
    }
    if ((activity.action === "looking" || activity.action === "searching") && state.placed.length) {
      const hop = Math.floor(agentAge(activity) / 1400);
      const entry = state.placed[(hop * 7919) % state.placed.length];
      agent.entry = entry;
      return { x: entry.x + entry.width * 0.5, y: entry.y + entry.height * 0.25 };
    }
    return agent.point ?? toWorld(viewport.clientWidth * 0.62, viewport.clientHeight * 0.45);
  }

  function agentLabel(agent) {
    const activity = agent.activity;
    const quiet = !BUSY.has(activity.action) && activity.action !== "asking" && agentAge(activity) > AGENT_QUIET_MS;
    let target = "";
    if (activity.action === "drawing" && agent.ghost) target = activity.name ? `“${activity.name}”` : t("a new screen");
    else if (activity.screen && activity.action !== "searching") target = t("the screen {name}", { name: screenTitle(activity.screen, activity.name) });
    if (activity.el && activity.screen) target = `${target} · ${activity.el}`;
    if (!activity.screen && activity.proposal && activity.action === "reading") target = t("the proposal {id}", { id: activity.proposal });
    if (activity.page && !activity.screen && state.boardPage) target = activity.action === "drawing" || activity.action === "drew" ? t("on the board") : t("the board");
    const doing = quiet ? "" : `<em>${VERBS[activity.action] ? t(VERBS[activity.action]) : activity.action}${target ? ` ${escapeHtml(target)}` : ""}${BUSY.has(activity.action) ? "…" : ""}</em>`;
    return `<b class="spark">✦</b>@${escapeHtml(activity.handle)}${activity.via ? ` <small>via ${escapeHtml(activity.via)}</small>` : ""}${doing}`;
  }

  function placeAgent(agent) {
    const { left, top } = toScreen(agent.point);
    const margin = 24;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const clampedLeft = Math.min(Math.max(left, margin), width - 260);
    const clampedTop = Math.min(Math.max(top, 56), height - 60);
    const outside = clampedLeft !== left || clampedTop !== top;
    agent.element.classList.toggle("edge", outside);
    agent.element.classList.remove("away");
    agent.element.style.transform = `translate3d(${clampedLeft}px, ${clampedTop}px, 0)`;
  }

  function overlayFor(agent, kind) {
    const key = kind === "ghost" ? "ghostElement" : "pieceElement";
    if (!agent[key]) {
      agent[key] = document.createElement("div");
      agent[key].className = kind === "ghost" ? "agent-ghost" : "agent-piece";
      agent[key].innerHTML = kind === "ghost" ? '<span class="agent-ghost-label"></span><i></i><i></i><i></i>' : "<span></span>";
      layer.prepend(agent[key]);
    }
    return agent[key];
  }

  function placeRect(element, rect) {
    if (!rect) {
      element.classList.add("away");
      return;
    }
    const { left, top } = toScreen(rect);
    element.classList.remove("away");
    element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    element.style.width = `${rect.width * state.scale}px`;
    element.style.height = `${rect.height * state.scale}px`;
  }

  function drawOverlays(agent) {
    const ghost = overlayFor(agent, "ghost");
    ghost.querySelector(".agent-ghost-label").textContent = agent.ghost ? (agent.activity.name ? t("Drawing “{name}”", { name: agent.activity.name }) : t("Drawing a new screen")) : "";
    placeRect(ghost, agent.ghost);
    const piece = overlayFor(agent, "piece");
    piece.querySelector("span").textContent = agent.activity.el ?? "";
    placeRect(piece, agent.piece);
  }

  function drawAgent(agent) {
    const activity = agent.activity;
    const gone = agentAge(activity) > AGENT_GONE_MS;
    if (!agent.element) agent.element = cursorElement("var(--agent)", true);
    agent.element.classList.toggle("busy", BUSY.has(activity.action) && !gone);
    if (gone) {
      agent.element.classList.add("away");
      agent.ghost = null;
      agent.piece = null;
      drawOverlays(agent);
      highlight(agent, null);
      return;
    }
    agent.point = agentTarget(agent);
    agent.element.querySelector(".cursor-name").innerHTML = agentLabel(agent);
    placeAgent(agent);
    drawOverlays(agent);
    highlight(agent, ["drawing", "reading", "inspecting", "checking", "drew"].includes(activity.action) && !agent.piece ? agent.entry : null);
  }

  function highlight(agent, entry) {
    if (agent.lit && agent.lit !== entry?.element) agent.lit.classList.remove("agent-here");
    agent.lit = entry?.element ?? null;
    agent.lit?.classList.add("agent-here");
  }

  function agentKey(activity) {
    return activity.session ?? activity.handle;
  }

  function setAgents(list) {
    const keys = new Set(list.map(agentKey));
    for (const [key, agent] of agents) {
      if (keys.has(key)) continue;
      agent.element?.remove();
      agent.ghostElement?.remove();
      agent.pieceElement?.remove();
      highlight(agent, null);
      agents.delete(key);
    }
    for (const activity of list) {
      const agent = agents.get(agentKey(activity)) ?? {};
      agent.activity = activity;
      agents.set(agentKey(activity), agent);
      drawAgent(agent);
      const mark = `${agentKey(activity)}:${activity.screen}:${activity.version}:${activity.at}`;
      if (activity.action === "drew" && mark !== seenDrew && agentAge(activity) < AGENT_QUIET_MS) {
        seenDrew = mark;
        onAgentDrew(activity);
      }
    }
    drawPeople();
  }

  function drawPeople() {
    const avatars = [];
    for (const agent of agents.values()) {
      if (agentAge(agent.activity) > AGENT_GONE_MS) continue;
      avatars.push(`<button class="presence agent" data-agent="${escapeHtml(agentKey(agent.activity))}" title="@${escapeHtml(agent.activity.handle)}"><span class="spark">✦</span></button>`);
    }
    for (const person of others.values()) {
      const face = person.avatar ? `<img src="${escapeHtml(person.avatar)}" alt="">` : escapeHtml(initials(person.name));
      const leading = following === person.id;
      const watching = person.following === id;
      const classes = ["presence", leading && "on", watching && "watching"].filter(Boolean).join(" ");
      const title = leading ? t("Stop following {name}", { name: person.name }) : t(watching ? "Follow {name} (following you)" : "Follow {name}", { name: person.name });
      avatars.push(`<button class="${classes}" style="--c:${person.color}" data-person="${escapeHtml(person.id)}" title="${escapeHtml(title)}" aria-pressed="${leading}">${face}</button>`);
    }
    const shown = avatars.slice(0, 6).join("");
    const extra = avatars.length > 6 ? `<span class="presence more">+${avatars.length - 6}</span>` : "";
    people.innerHTML = shown + extra;
    people.hidden = !avatars.length;
  }

  function goTo(point) {
    if (!point) return;
    state.manual = true;
    state.tx = viewport.clientWidth / 2 - point.x * state.scale;
    state.ty = viewport.clientHeight / 2 - point.y * state.scale;
    applyView();
  }

  people.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.agent) goTo(agents.get(button.dataset.agent)?.point);
    if (button.dataset.person) {
      if (following === button.dataset.person) stopFollowing();
      else startFollowing(button.dataset.person);
    }
  });

  viewport.addEventListener("pointermove", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (event.pointerType !== "touch" && !event.buttons && !looking) trackWave(event.clientX, event.clientY);
    placeMyHand();
    if (!looking) send(anchorOf(toWorld(event.clientX, event.clientY)));
    tryHighFive();
  });
  document.documentElement.addEventListener("pointerleave", () => {
    lastPointer = null;
    lowerHand();
    if (!looking) send(null);
  });

  setInterval(() => {
    for (const agent of agents.values()) {
      if (BUSY.has(agent.activity.action) || agentAge(agent.activity) < AGENT_QUIET_MS) drawAgent(agent);
    }
  }, 1400);

  const query = new URLSearchParams({ id, name: myName() ?? "Visitante" });
  const stream = new EventSource(`${base}/api/live?${query}`);
  stream.addEventListener("snapshot", (message) => {
    const data = JSON.parse(message.data);
    for (const personId of [...others.keys()]) removePerson(personId);
    data.people.forEach(upsertPerson);
    setAgents(data.agents);
    if (following) steer();
    if (looking) send(looking);
    else schedule();
  });
  stream.addEventListener("join", (message) => {
    upsertPerson({ ...JSON.parse(message.data), cursor: null });
    drawPeople();
  });
  stream.addEventListener("leave", (message) => {
    removePerson(JSON.parse(message.data).id);
    drawPeople();
  });
  stream.addEventListener("cursor", (message) => {
    const { id: personId, cursor, view, following: theirs } = JSON.parse(message.data);
    const person = others.get(personId);
    if (!person) return;
    const watchingChanged = (person.following === id) !== (theirs === id);
    Object.assign(person, { cursor, view, following: theirs });
    drawPerson(person);
    answerHighFive(person);
    tryHighFive();
    if (watchingChanged) drawPeople();
    if (personId === following) steer();
  });
  stream.addEventListener("agents", (message) => setAgents(JSON.parse(message.data)));

  return {
    id,

    listen(name, handler) {
      stream.addEventListener(name, (message) => handler(JSON.parse(message.data)));
    },

    reposition() {
      if (following && !steering) stopFollowing();
      layer.classList.add("instant");
      for (const person of others.values()) place(person.element, pointOf(person.cursor));
      for (const agent of agents.values()) {
        if (!agent.element || agent.element.classList.contains("away") || !agent.point) continue;
        placeAgent(agent);
        if (agent.ghostElement) placeRect(agent.ghostElement, agent.ghost);
        if (agent.pieceElement) placeRect(agent.pieceElement, agent.piece);
      }
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.remove("instant")));
      if (lastPointer && !looking) send(anchorOf(toWorld(lastPointer.x, lastPointer.y)));
      else schedule();
    },

    rerender() {
      for (const person of others.values()) drawPerson(person);
      for (const agent of agents.values()) drawAgent(agent);
    },

    look(screen, version) {
      const leader = leaderLooking();
      if (following && (leader?.screen ?? null) !== (screen ?? null)) stopFollowing();
      looking = screen ? { screen, version, rx: 0.5, ry: 0.42, looking: true } : null;
      send(looking);
    },
  };
}
