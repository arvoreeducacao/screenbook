import { lang, t, translate } from "./i18n.js";

const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"/><path d="M19 15c.2 1.8 1 2.6 2.8 2.8-1.8.2-2.6 1-2.8 2.8-.2-1.8-1-2.6-2.8-2.8 1.8-.2 2.6-1 2.8-2.8z"/></svg>';
const ICON = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  read: ICON('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  draw: ICON('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  measure: ICON('<path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z"/><path d="m7.5 10.5 2-2M10.5 13.5l2-2M13.5 16.5l2-2"/>'),
  find: ICON('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  guide: ICON('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
  talk: ICON('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  ask: ICON('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  shot: ICON('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
  canvas: ICON('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  check: ICON('<path d="M20 6 9 17l-5-5"/>'),
  cross: ICON('<path d="M18 6 6 18M6 6l12 12"/>'),
  chevron: ICON('<path d="m6 9 6 6 6-6"/>'),
  up: ICON('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  plus: ICON('<path d="M12 5v14M5 12h14"/>'),
  at: ICON('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  slash: ICON('<path d="M15 4 9 20"/>'),
};
const TOOL_ICON = {
  open_project: "canvas",
  read_screen: "read",
  read_proposal: "read",
  write_screen: "draw",
  write_part: "draw",
  inspect_screen: "measure",
  find_screens: "find",
  read_guide: "guide",
  write_guide: "guide",
  reply_comment: "talk",
  resolve_comment: "talk",
  annotate: "talk",
  ask_person: "ask",
  screenshot: "shot",
};
const TOOL_VERB = {
  open_project: "Opened the product",
  read_screen: "Read",
  read_proposal: "Read the proposal",
  write_screen: "Drew",
  write_part: "Saved the shared piece",
  inspect_screen: "Measured",
  find_screens: "Searched",
  read_guide: "Read the guide",
  write_guide: "Learned",
  reply_comment: "Replied",
  resolve_comment: "Resolved the thread",
  annotate: "Annotated",
  remove_annotation: "Removed a note",
  screenshot: "Checked the screenshot",
  link_screens: "Linked the screens",
  arrange: "Arranged the canvas",
  approve: "Approved the screen",
  archive: "Archived the screen",
  restore: "Restored",
  share: "Opened a link",
  ask_person: "Asked",
};
const LIVE_VERB = {
  open_project: "Opening the product",
  read_screen: "Reading",
  read_proposal: "Reading the proposal",
  write_screen: "Drawing",
  inspect_screen: "Measuring",
  find_screens: "Searching",
  read_guide: "Reading the guide",
  write_guide: "Learning",
  reply_comment: "Replying",
  annotate: "Annotating",
  screenshot: "Checking",
};
export const MODEL_INFO = {
  opus: { name: "Opus", hint: "the most careful" },
  sonnet: { name: "Sonnet", hint: "balanced" },
  haiku: { name: "Haiku", hint: "the fastest" },
};
export const COMMANDS = [
  { id: "variation", name: "variation", hint: "2 different takes on this screen", prompt: "Draw 2 variations of this screen, each one taking a very different path, as variant_of screens in the same proposal." },
  { id: "apply", name: "apply comments", hint: "does what the open comments ask", prompt: "Apply the open comments of this proposal, or of this screen if there is no proposal: read the whole proposal, draw what each comment asks for, then reply to and resolve each thread." },
  { id: "review", name: "review", hint: "compares with the guide and nearby screens", prompt: "Review this screen against the product guide and the nearby screens: measure what is off (tokens, spacing, type, tone) and leave each finding as an annotation on the screen, without redrawing." },
  { id: "explain", name: "explain", hint: "what it is for and what it decides", prompt: "Explain this screen in a few lines: what it is for, its main pieces and the decisions that show up in the comments. Do not draw anything." },
  { id: "learn", name: "learn", hint: "updates the product guide", prompt: "Read the product guide and what happened on the canvas since the last update, and update the guide with what it teaches." },
];

function fold(text) {
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function namesOf(command) {
  return [...new Set([command.id, command.name, t(command.name), translate("pt-BR", command.name)].map(fold))];
}

function slugOf(text) {
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function formatReply(text) {
  return escapeHtml(text)
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])@([\w-]+(?:\/[\w-]+)?)/g, '$1<span class="ai-cite">@$2</span>')
    .replace(/\n/g, "<br>");
}

export function contextOf(state) {
  const overlay = state.overlay;
  if (overlay) {
    const screen = state.data?.screens.find((item) => item.id === overlay.screenId);
    const version = screen?.versions.find((entry) => entry.v === overlay.version);
    return { view: "screen", screen: overlay.screenId, version: overlay.version, el: overlay.focusEl ?? undefined, proposal: version?.proposal ?? undefined, label: screen ? `${screen.number} · ${screen.name}` : overlay.screenId };
  }
  if (state.boardPage) {
    const page = (state.data?.project?.pages ?? []).find((entry) => entry.id === state.page);
    const items = state.boardSelection ?? [];
    return { view: "board", board: state.page, boardName: page?.name, items: items.length ? items : undefined, label: items.length ? `${page?.name ?? state.page} · ${items.length}` : (page?.name ?? state.page) };
  }
  const draft = state.note?.draft;
  if (draft?.item) {
    return { view: state.view, screen: draft.item.screen.id, version: draft.item.version, el: draft.els?.[0], proposal: draft.item.proposal?.id, label: `${draft.item.screen.number} · ${draft.item.screen.name}` };
  }
  const selected = state.selected;
  const focus = state.focus && state.focus !== "all" ? state.focus : undefined;
  if (selected) {
    const version = selected.screen.versions.find((entry) => entry.v === selected.version);
    return { view: state.view, screen: selected.screen.id, version: selected.version, proposal: version?.proposal ?? focus, label: `${selected.screen.number} · ${selected.screen.name}` };
  }
  if (focus) {
    const proposal = state.data?.proposals.find((item) => item.id === focus);
    return { view: state.view, proposal: focus, label: proposal?.title ?? focus };
  }
  return { view: state.view, label: t("the whole product") };
}

export function expandCommand(text) {
  const match = String(text).match(/^\/(\S[\s\S]*)$/);
  if (!match) return { prompt: text, command: null };
  const typed = match[1];
  const words = fold(typed).split(/\s+/);
  const named = COMMANDS.flatMap((item) => namesOf(item).map((name) => ({ item, name: name.split(/\s+/) })))
    .sort((a, b) => b.name.length - a.name.length)
    .find(({ name }) => name.every((word, at) => words[at] === word));
  const first = words[0];
  const command = named?.item ?? COMMANDS.find((item) => namesOf(item).some((name) => name.startsWith(first)));
  if (!command) return { prompt: text, command: null };
  const skip = named ? named.name.length : 1;
  const rest = typed.split(/(\s+)/).slice(skip * 2).join("").trim();
  return { prompt: rest ? `${command.prompt}\n\n${rest}` : command.prompt, command, rest };
}

export function mentionsIn(text, screens = []) {
  const known = new Set(screens.map((screen) => screen.id));
  const out = [];
  for (const match of String(text).matchAll(/(?:^|[\s(])@([\w-]+)(?:\/([\w-]+))?/g)) {
    if (!known.has(match[1]) || out.some((item) => item.screen === match[1] && item.el === match[2])) continue;
    out.push(match[2] ? { screen: match[1], el: match[2] } : { screen: match[1] });
  }
  return out.slice(0, 12);
}

export function trailSummary(message) {
  const tools = (message.trail ?? []).filter((item) => item.kind === "tool");
  const seconds = message.seconds;
  const time = seconds ? (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${String(seconds % 60).padStart(2, "0")}s`) : "";
  const count = tools.length ? t(tools.length === 1 ? "{n} step" : "{n} steps", { n: tools.length }) : "";
  return [time ? t("Worked for {time}", { time }) : t("Thought"), count].filter(Boolean).join(" · ");
}

function fromSaved(message) {
  if (message.role !== "assistant" || message.trail) return message;
  const trail = [];
  if (message.thinking) trail.push({ kind: "think", text: message.thinking });
  for (const tool of message.tools ?? []) trail.push({ kind: "tool", ...tool, done: true });
  if (!message.tools) for (const label of message.steps ?? []) trail.push({ kind: "tool", label, done: true });
  return { ...message, trail };
}

async function readLines(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer.trim()));
}

export function startAi({ base, state, refresh, toast, showProposal = () => {} }) {
  const ai = { open: false, tab: "chat", status: null, messages: [], running: false, login: null, error: null, guide: null, guideDraft: null, menu: null, startedAt: 0 };

  const panel = document.createElement("aside");
  panel.className = "fl ai-panel";
  panel.id = "ai-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", t("AI"));
  document.body.appendChild(panel);

  const opener = document.createElement("button");
  opener.className = "ai-open-btn";
  opener.id = "ai-toggle";
  opener.title = t("AI (I)");
  opener.setAttribute("aria-label", t("Open the AI"));
  opener.innerHTML = `${SPARK}<span>${t("AI")}</span>`;
  document.querySelector("#top-right")?.prepend(opener);
  opener.addEventListener("click", () => toggle());

  async function api(path, options = {}) {
    const response = await fetch(`${base}/api/ai/${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? t("the AI answered {status}", { status: response.status }));
    return body;
  }

  async function load() {
    try {
      ai.status = await api("status");
      if (ai.status.connected) {
        const chat = await api("chat");
        if (!ai.running) ai.messages = (chat.messages ?? []).map(fromSaved);
      }
      ai.error = null;
    } catch (error) {
      ai.error = error.message;
    }
    render();
  }

  async function loadGuide() {
    try {
      ai.guide = await api("guide");
    } catch (error) {
      ai.guide = { text: "", error: error.message, changes: [], lessons: [] };
    }
    render();
  }

  const overlayElement = document.querySelector("#overlay");
  const screenOpen = () => Boolean(overlayElement && !overlayElement.hidden);

  function place() {
    const column = overlayElement?.querySelector(".ov-panel");
    const docked = Boolean(ai.open && column && screenOpen());
    if (docked && panel.parentElement !== column) column.appendChild(panel);
    if (!docked && panel.parentElement !== document.body) document.body.appendChild(panel);
    panel.classList.toggle("docked", docked);
    panel.classList.toggle("fl", !docked);
    column?.classList.toggle("ai-docked", docked);
    column?.querySelector(".ai-tab")?.classList.toggle("on", docked);
    document.body.classList.toggle("ai-open", ai.open && !docked);
  }

  function toggle(open = !ai.open) {
    ai.open = open;
    panel.hidden = !open;
    opener.classList.toggle("on", open);
    place();
    if (open) {
      load();
      setTimeout(() => panel.querySelector("#ai-text")?.focus(), 30);
    }
  }

  const tabs = overlayElement?.querySelector("#ov-tabs");
  if (tabs) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "ai-tab";
    tab.setAttribute("role", "tab");
    tab.title = t("AI (Ctrl+J)");
    tab.innerHTML = `${SPARK}${t("AI")}`;
    tabs.appendChild(tab);
    tab.addEventListener("click", () => toggle(true));
    tabs.addEventListener("click", (event) => {
      if (event.target.closest("[data-panel]") && ai.open && screenOpen()) toggle(false);
    });
  }
  if (overlayElement) new MutationObserver(place).observe(overlayElement, { attributes: true, attributeFilter: ["hidden"] });

  function goTo(drew) {
    const url = new URL(location.href);
    if (drew.proposal) url.searchParams.set("proposal", drew.proposal);
    url.hash = `${drew.screen}/v${drew.version}`;
    history.replaceState(null, "", url);
    refresh(true).then(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  }

  const screens = () => state.data?.screens ?? [];
  const screenLabel = (id) => {
    const screen = screens().find((item) => item.id === id);
    return screen ? `${screen.number} · ${screen.name}` : id;
  };

  function chipTarget(item) {
    const detail = item.detail ?? {};
    const parts = [];
    if (detail.screen) parts.push(screenLabel(detail.screen));
    else if (detail.name) parts.push(detail.name);
    if (detail.el) parts.push(detail.el);
    if (detail.version && detail.screen) parts[0] = `${parts[0]} v${detail.version}`;
    if (!parts.length && detail.proposal) parts.push(detail.proposal);
    if (!parts.length && detail.query) parts.push(`“${detail.query}”`);
    if (!parts.length && detail.like) parts.push(t("similar to {name}", { name: screenLabel(detail.like) }));
    if (!parts.length && detail.change) parts.push(detail.change);
    return parts.join(" · ");
  }

  function chipHtml(item) {
    const name = item.name ?? "";
    const known = item.done ? TOOL_VERB[name] : LIVE_VERB[name] ?? TOOL_VERB[name];
    const verb = known ? t(known) : item.label ?? name;
    const target = item.detail ? chipTarget(item) : item.name ? "" : "";
    const extra = name === "write_screen" && item.detail?.lines ? `<span class="ai-chip-n">${t("{n} lines", { n: item.detail.lines })}</span>` : name === "write_screen" && item.detail?.edits ? `<span class="ai-chip-n">${t("{n} edits", { n: item.detail.edits })}</span>` : "";
    const status = !item.done ? `<span class="ai-spin" aria-label="${t("working")}"></span>` : item.error ? `<span class="ai-chip-s err" aria-label="${t("failed")}">${ICONS.cross}</span>` : `<span class="ai-chip-s" aria-label="${t("done")}">${ICONS.check}</span>`;
    return `<li class="ai-chip${item.done ? "" : " live"}${item.error ? " err" : ""}"><span class="ai-chip-i">${ICONS[TOOL_ICON[name] ?? "canvas"]}</span><span class="ai-chip-v">${escapeHtml(item.name ? verb : item.label)}</span>${target ? `<span class="ai-chip-t">${escapeHtml(target)}</span>` : ""}${extra}${status}</li>`;
  }

  function trailHtml(message, index) {
    const trail = message.trail ?? [];
    if (!message.live && !trail.length) return "";
    const open = message.live ? message.trailOpen !== false : Boolean(message.trailOpen);
    const live = message.live;
    const seconds = live ? Math.max(0, Math.round((Date.now() - ai.startedAt) / 1000)) : 0;
    const current = [...trail].reverse().find((item) => item.kind === "tool" && !item.done);
    const head = live ? `<span class="ai-shimmer">${escapeHtml(current ? `${LIVE_VERB[current.name] ? t(LIVE_VERB[current.name]) : current.label}${chipTarget(current) ? ` ${chipTarget(current)}` : ""}…` : message.text ? t("Writing…") : message.pondering || trail.length ? t("Thinking…") : t("Starting…"))}</span><span class="ai-trail-time" data-tick>${seconds}s</span>` : `<span>${escapeHtml(trailSummary(message))}</span>`;
    const body = trail
      .filter((item) => item.kind !== "think" || item.text.trim())
      .map((item) => (item.kind === "think" ? `<li class="ai-think"><span class="ai-chip-i">${SPARK}</span><p>${escapeHtml(item.text.trim().slice(-900))}</p></li>` : item.kind === "note" ? `<li class="ai-note">${formatReply(item.text)}</li>` : chipHtml(item)))
      .join("");
    return `<div class="ai-trail${open ? " open" : ""}${live ? " live" : ""}"><button type="button" class="ai-trail-head" data-trail="${index}" aria-expanded="${open}"><span class="ai-trail-spark">${SPARK}</span>${head}<span class="ai-trail-chev">${ICONS.chevron}</span></button>${open && body ? `<ol class="ai-trail-list">${body}</ol>` : ""}</div>`;
  }

  function askCard(message, index) {
    const asked = [...(message.trail ?? [])].reverse().find((item) => item.kind === "tool" && item.name === "ask_person" && item.detail?.question);
    if (!asked) return "";
    const last = index === ai.messages.length - 1;
    if (message.answer || !last || message.live) {
      return `<div class="ai-ask-card done"><p class="ai-ask-q">${escapeHtml(asked.detail.question)}</p>${message.answer ? `<p class="ai-ask-a">${ICONS.check}${escapeHtml(message.answer)}</p>` : ""}</div>`;
    }
    const options = asked.detail.options ?? [];
    return `<form class="ai-ask-card" data-ask="${index}">
      <p class="ai-ask-q">${escapeHtml(asked.detail.question)}</p>
      <div class="ai-ask-opts" role="radiogroup">${options
        .map((option, at) => `<label class="ai-opt"><input type="radio" name="ai-ask" value="${escapeHtml(option)}" ${at === 0 ? "checked" : ""}><span class="ai-radio"></span><span>${escapeHtml(option)}</span></label>`)
        .join("")}<label class="ai-opt other"><input type="radio" name="ai-ask" value=""><span class="ai-radio"></span><input type="text" class="ai-ask-other" placeholder="${t("Something else…")}" autocomplete="off"></label></div>
      <div class="ai-ask-foot"><span class="grow"></span><button type="button" class="btn sm" data-ai="skip">${t("Skip")}</button><button class="btn sm primary ai-go">${t("Continue")}</button></div>
    </form>`;
  }

  function messageHtml(message, index) {
    if (message.role === "user") {
      const about = message.context?.label ?? (message.context?.screen ? message.context.screen : "");
      const command = message.command ? `<span class="ai-cmd">/${escapeHtml(t(message.command))}</span>` : "";
      return `<div class="ai-msg ai-mine">${about ? `<span class="ai-about">${escapeHtml(about)}</span>` : ""}<div class="ai-bubble">${command}${formatReply(message.shown ?? message.text)}</div></div>`;
    }
    const images = message.images ?? [];
    const drew = (message.drew ?? []).filter((item, at, all) => all.findLastIndex((other) => other.screen === item.screen && other.version === item.version) === at);
    const live = message.live;
    return `<div class="ai-msg ai-bot">
      ${trailHtml(message, index)}
      ${message.text ? `<div class="ai-text">${formatReply(message.text)}${live ? '<span class="ai-caret"></span>' : ""}</div>` : ""}
      ${askCard(message, index)}
      ${drew.length ? `<div class="ai-drew">${drew.map((item) => `<button type="button" class="ai-drew-card" data-drew="${index}" data-screen="${escapeHtml(item.screen)}" data-version="${item.version}"><img src="${base}/api/screens/${encodeURIComponent(item.screen)}/v${item.version}.png" alt="" loading="lazy"><span class="ai-drew-name"><b>${escapeHtml(screenLabel(item.screen))}</b><small>v${item.version}${item.proposal ? ` · ${escapeHtml(item.proposal)}` : ""}</small></span><span class="ai-drew-go">${t("Open")}</span></button>`).join("")}</div>` : ""}
      ${images.length ? `<div class="ai-shots">${images.map((src, shot) => `<button type="button" class="ai-shot" data-shot="${index}:${shot}"><img src="${src}" alt="${t("Screenshot the AI took")}"></button>`).join("")}</div>` : ""}
      ${message.error ? `<div class="ai-error">${escapeHtml(t(message.error))}</div>` : ""}
    </div>`;
  }

  function connectHtml() {
    if (ai.login?.url) {
      return `<div class="ai-connect">
        <h3>${t("One more step")}</h3>
        <ol class="ai-howto"><li>${t("Open the Claude login and sign in with <b>your</b> account.")}</li><li>${t("Authorize. If it says \"all set\", you can close the tab: the connection finishes here by itself.")}</li><li>${t("If a code shows up, paste it below.")}</li></ol>
        <a class="btn" href="${escapeHtml(ai.login.url)}" target="_blank" rel="noopener noreferrer">${t("Open the Claude login")}</a>
        <form id="ai-code-form" class="ai-code"><input id="ai-code" autocomplete="off" spellcheck="false" placeholder="${t("Paste the code here")}" required><button class="btn primary" ${ai.login.busy ? "disabled" : ""}>${ai.login.busy ? t("Checking…") : t("Confirm")}</button></form>
        <button type="button" class="ai-link" data-ai="cancel-login">${t("Cancel")}</button>
      </div>`;
    }
    return `<div class="ai-connect">
      <div class="ai-badge">${SPARK}</div>
      <h3>${t("Draw by asking")}</h3>
      <p>${t("The AI draws right on this canvas: new screens, variations, whatever a comment asked for. It uses your own Claude account (Pro or Max), and what it draws goes under your name.")}</p>
      <button type="button" class="btn primary" data-ai="login" ${ai.login?.busy ? "disabled" : ""}>${ai.login?.busy ? t("Opening the login…") : t("Connect my Claude account")}</button>
      <p class="muted small">${t("The account is stored encrypted and only you use it. You can disconnect whenever you want.")}</p>
    </div>`;
  }

  function emptyHtml() {
    return `<div class="ai-empty">
      <div class="ai-empty-mark">${SPARK}</div>
      <p>${t("Ask for a screen, variations or a change. The AI sees what you are looking at, measures similar screens and follows the product guide.")}</p>
      <div class="ai-ideas">${COMMANDS.slice(0, 4)
        .map((command) => `<button type="button" class="ai-idea" data-command="${command.id}"><span class="ai-cmd">/${escapeHtml(t(command.name))}</span><span>${escapeHtml(t(command.hint))}</span></button>`)
        .join("")}</div>
    </div>`;
  }

  function contextChip() {
    const context = contextOf(state);
    return `<span class="ai-ctx" title="${t("What the AI is seeing")}">${ICONS.read}<b>${escapeHtml(context.label)}</b>${context.el ? `<span class="ai-ctx-el">${escapeHtml(context.el)}</span>` : ""}</span>`;
  }

  function composerHtml() {
    const model = MODEL_INFO[ai.status?.model] ?? MODEL_INFO.opus;
    return `<form class="ai-bar" id="ai-form">
      <div class="ai-bar-top">${contextChip()}</div>
      <textarea id="ai-text" rows="1" placeholder="${t("Ask the AI…   @ cites a screen, / a command")}" ${ai.running ? "disabled" : ""} aria-label="${t("Request for the AI")}"></textarea>
      <div class="ai-bar-row">
        <button type="button" class="ai-bar-btn" data-ai="at" title="${t("Cite a screen or piece (@)")}" aria-label="${t("Cite a screen")}">${ICONS.at}</button>
        <button type="button" class="ai-bar-btn" data-ai="slash" title="${t("Commands (/)")}" aria-label="${t("Commands")}">${ICONS.slash}</button>
        <span class="grow"></span>
        <button type="button" class="ai-model" data-ai="models" aria-haspopup="menu" aria-expanded="${ai.menu?.kind === "models"}">${escapeHtml(model.name)}${ICONS.chevron}</button>
        ${ai.running ? `<button type="button" class="ai-send stop" data-ai="stop" title="${t("Stop")}" aria-label="${t("Stop")}">${ICONS.stop}</button>` : `<button class="ai-send" title="${t("Send (Enter)")}" aria-label="${t("Send")}">${ICONS.up}</button>`}
      </div>
      ${menuHtml()}
    </form>`;
  }

  function menuItems() {
    const menu = ai.menu;
    if (!menu) return [];
    if (menu.kind === "models") return (ai.status?.models ?? Object.keys(MODEL_INFO)).map((id) => ({ id, label: MODEL_INFO[id]?.name ?? id, hint: MODEL_INFO[id] ? t(MODEL_INFO[id].hint) : "", on: id === ai.status?.model }));
    const query = menu.query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (menu.kind === "slash") return COMMANDS.filter((command) => !query || namesOf(command).some((name) => name.startsWith(query))).map((command) => ({ id: command.id, label: `/${t(command.name)}`, hint: t(command.hint) }));
    const context = contextOf(state);
    const items = [];
    if (context.screen) {
      for (const el of menu.pieces ?? []) items.push({ id: `${context.screen}/${el}`, label: el, hint: t("piece of this screen"), piece: true });
    }
    for (const screen of screens()) items.push({ id: screen.id, label: `${screen.number} · ${screen.name}`, hint: screen.route ?? "" });
    const words = query.split(/[\s/]+/).filter(Boolean);
    const plain = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return items.filter((item) => words.every((word) => plain(`${item.id} ${item.label}`).includes(word))).slice(0, 30);
  }

  function menuHtml() {
    const items = menuItems();
    if (!ai.menu) return "";
    const title = ai.menu.kind === "models" ? t("Model") : ai.menu.kind === "slash" ? t("Commands") : t("Cite");
    const active = Math.min(ai.menu.active ?? 0, Math.max(0, items.length - 1));
    const foot = ai.menu.kind === "models" ? `<div class="ai-menu-foot">${ai.status?.account ? `${escapeHtml(ai.status.account)} · ` : ""}<button type="button" class="ai-link" data-ai="logout">${t("disconnect")}</button></div>` : "";
    return `<div class="ai-menu ${ai.menu.kind}" role="menu"><div class="ai-menu-title">${title}</div>${
      items.length
        ? items.map((item, at) => `<button type="button" role="menuitem" class="ai-menu-item${at === active ? " active" : ""}${item.piece ? " piece" : ""}" data-pick="${escapeHtml(item.id)}"><span class="ai-menu-l">${escapeHtml(item.label)}</span><span class="ai-menu-h">${escapeHtml(item.hint)}</span>${item.on ? `<span class="ai-menu-on">${ICONS.check}</span>` : ""}</button>`).join("")
        : `<div class="ai-menu-empty">${t("Nothing with that name")}</div>`
    }${foot}</div>`;
  }

  function guideHtml() {
    const guide = ai.guide;
    if (!guide) return `<div class="ai-connect"><p class="muted">${t("Loading the guide…")}</p></div>`;
    const draft = ai.guideDraft ?? guide.text ?? "";
    const when = guide.updatedAt ? new Date(guide.updatedAt).toLocaleString(lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
    const lessons = guide.lessons?.length ?? 0;
    return `<div class="ai-guide">
      <p class="ai-guide-lead">${t("What the AI has learned about drawing this product. It reads this on every request and updates it when someone approves, refuses or corrects something.")}</p>
      ${lessons ? `<button type="button" class="ai-guide-news" data-command="learn">${SPARK}<span>${t(lessons === 1 ? "<b>{n} new thing</b> on the canvas since the last update" : "<b>{n} new things</b> on the canvas since the last update", { n: lessons })}</span><span class="ai-guide-go">${t("Learn")}</span></button>` : ""}
      <textarea id="ai-guide-text" spellcheck="false" placeholder="${t("## Visual&#10;- cards with radius 12 and the --surface token&#10;&#10;## Refused&#10;- colored stripe on one side of the card")}">${escapeHtml(draft)}</textarea>
      <div class="ai-guide-row"><span class="muted small grow">${when ? t("Updated by {name} · {when}", { name: escapeHtml(guide.updatedBy), when: escapeHtml(when) }) : t("Still empty")}</span>${ai.guideDraft !== null && ai.guideDraft !== guide.text ? `<button type="button" class="btn sm" data-ai="guide-undo">${t("Undo")}</button><button type="button" class="btn sm primary" data-ai="guide-save">${t("Save")}</button>` : ""}</div>
      ${guide.error ? `<div class="ai-error">${escapeHtml(t(guide.error))}</div>` : ""}
      ${guide.changes?.length ? `<div class="ai-guide-log"><div class="ai-menu-title">${t("Changes")}</div><ol>${guide.changes.slice(0, 8).map((change) => `<li><b>${escapeHtml(change.by)}</b><span>${escapeHtml(change.change ?? t("edited"))}</span><small>${escapeHtml(new Date(change.at).toLocaleDateString(lang, { day: "2-digit", month: "short" }))}</small></li>`).join("")}</ol></div>` : ""}
    </div>`;
  }

  function render() {
    if (!ai.open) return;
    const connected = ai.status?.connected;
    const list = panel.querySelector(".ai-list");
    const keepBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const box = panel.querySelector("#ai-text");
    const draft = box?.value ?? ai.draft ?? "";
    const caret = box && document.activeElement === box ? box.selectionStart : null;
    const guideBox = panel.querySelector("#ai-guide-text");
    if (guideBox) ai.guideDraft = guideBox.value;
    panel.innerHTML = `
      <header class="ai-head"><span class="ai-title">${SPARK}<b>${t("AI")}</b></span>${
        connected ? `<div class="ai-tabs" role="tablist"><button type="button" role="tab" class="${ai.tab === "chat" ? "on" : ""}" data-tab="chat" aria-selected="${ai.tab === "chat"}">${t("Chat")}</button><button type="button" role="tab" class="${ai.tab === "guide" ? "on" : ""}" data-tab="guide" aria-selected="${ai.tab === "guide"}">${t("Guide")}</button></div>` : ""
      }<span class="grow"></span>${
        connected && ai.messages.length && ai.tab === "chat" ? `<button type="button" class="icon-btn" data-ai="reset" title="${t("New chat")}" aria-label="${t("New chat")}">${ICONS.plus}</button>` : ""
      }<button type="button" class="icon-btn" data-ai="close" aria-label="${t("Close the AI")}">${ICONS.cross}</button></header>
      ${ai.error ? `<div class="ai-error top">${escapeHtml(t(ai.error))}</div>` : ""}
      ${ai.status && ai.status.ready === false ? `<div class="ai-error top">${t("The AI is still arriving on this server. You can connect your account, but requests will only run in a little while.")}</div>` : ""}
      ${
        !ai.status
          ? `<div class="ai-connect"><p class="muted">${t("Loading…")}</p></div>`
          : !connected
            ? connectHtml()
            : ai.tab === "guide"
              ? guideHtml()
              : `<div class="ai-list">${ai.messages.length ? ai.messages.map(messageHtml).join("") : emptyHtml()}</div>${composerHtml()}`
      }`;
    const text = panel.querySelector("#ai-text");
    if (text) {
      text.value = draft;
      grow(text);
      if (caret !== null) {
        text.focus();
        text.setSelectionRange(caret, caret);
      }
    }
    const fresh = panel.querySelector(".ai-list");
    if (fresh) fresh.scrollTop = keepBottom ? fresh.scrollHeight : list?.scrollTop ?? fresh.scrollHeight;
  }

  function grow(text) {
    text.style.height = "auto";
    text.style.height = `${Math.min(160, text.scrollHeight)}px`;
  }

  async function piecesOfCurrent() {
    const context = contextOf(state);
    if (!context.screen || !context.version) return [];
    try {
      const html = await (await fetch(`${base}/api/screens/${encodeURIComponent(context.screen)}/v${context.version}.html`)).text();
      return [...new Set([...html.matchAll(/data-el=["']([^"']+)["']/g)].map((match) => match[1]))].slice(0, 40);
    } catch {
      return [];
    }
  }

  async function openMenu(kind, query = "", from = null) {
    ai.menu = { kind, query, active: 0, from };
    if (kind === "at") ai.menu.pieces = await piecesOfCurrent();
    if (ai.menu?.kind === kind) render();
  }

  function closeMenu() {
    if (!ai.menu) return;
    ai.menu = null;
    render();
  }

  function triggerAt(text) {
    const before = text.value.slice(0, text.selectionStart);
    const match = before.match(/(^|\s)([@/])([\wÀ-ſ/-]*)$/);
    if (!match) return null;
    if (match[2] === "/" && before.trim() !== `/${match[3]}`) return null;
    return { kind: match[2] === "@" ? "at" : "slash", query: match[3], from: before.length - match[3].length - 1 };
  }

  function pick(id) {
    const menu = ai.menu;
    if (!menu) return;
    if (menu.kind === "models") {
      ai.menu = null;
      ai.status = { ...ai.status, model: id };
      render();
      api("model", { method: "POST", body: JSON.stringify({ model: id }) }).catch((error) => toast(t(error.message)));
      return;
    }
    const text = panel.querySelector("#ai-text");
    const value = text?.value ?? "";
    const chosen = COMMANDS.find((command) => command.id === id);
    const insert = menu.kind === "slash" ? `/${chosen ? t(chosen.name) : id} ` : `@${id} `;
    const from = menu.from ?? value.length;
    const to = text ? text.selectionStart : value.length;
    const next = menu.from === null ? `${value}${value && !value.endsWith(" ") ? " " : ""}${insert}` : `${value.slice(0, from)}${insert}${value.slice(to)}`;
    ai.menu = null;
    render();
    const box = panel.querySelector("#ai-text");
    if (box) {
      box.value = next;
      const at = menu.from === null ? next.length : from + insert.length;
      box.focus();
      box.setSelectionRange(at, at);
      grow(box);
    }
  }

  panel.addEventListener("input", (event) => {
    if (event.target.id === "ai-guide-text") {
      const before = ai.guideDraft;
      ai.guideDraft = event.target.value;
      if ((before === null || before === ai.guide?.text) !== (ai.guideDraft === ai.guide?.text)) {
        const at = event.target.selectionStart;
        render();
        const box = panel.querySelector("#ai-guide-text");
        box?.focus();
        box?.setSelectionRange(at, at);
      }
      return;
    }
    if (event.target.id !== "ai-text") return;
    grow(event.target);
    const found = triggerAt(event.target);
    if (found) {
      if (ai.menu?.kind === found.kind) {
        ai.menu.query = found.query;
        ai.menu.from = found.from;
        ai.menu.active = 0;
        render();
      } else openMenu(found.kind, found.query, found.from);
    } else if (ai.menu && ai.menu.kind !== "models") closeMenu();
  });

  panel.addEventListener("keydown", (event) => {
    if (event.target.id === "ai-guide-text") {
      if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        saveGuide();
      }
      return;
    }
    if (event.target.id !== "ai-text") return;
    if (ai.menu) {
      const items = menuItems();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        ai.menu.active = ((ai.menu.active ?? 0) + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
        return render();
      }
      if ((event.key === "Enter" || event.key === "Tab") && items.length) {
        event.preventDefault();
        return pick(items[Math.min(ai.menu.active ?? 0, items.length - 1)].id);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        return closeMenu();
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      panel.querySelector("#ai-form").requestSubmit();
    }
    if (event.key === "Escape") toggle(false);
  });

  document.addEventListener("pointerdown", (event) => {
    if (ai.menu && !event.target.closest(".ai-menu, [data-ai='models'], [data-ai='at'], [data-ai='slash'], #ai-text")) closeMenu();
  });

  async function saveGuide() {
    const text = panel.querySelector("#ai-guide-text")?.value ?? ai.guideDraft ?? "";
    try {
      ai.guide = { ...(await api("guide", { method: "PUT", body: JSON.stringify({ text }) })), lessons: ai.guide?.lessons ?? [] };
      ai.guideDraft = null;
      toast(t("Guide saved. The AI reads it on the next request."));
    } catch (error) {
      toast(t(error.message));
    }
    render();
  }

  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.tab) {
      ai.tab = button.dataset.tab;
      ai.menu = null;
      if (ai.tab === "guide") {
        ai.guideDraft = null;
        loadGuide();
      }
      return render();
    }
    if (button.dataset.pick) return pick(button.dataset.pick);
    if (button.dataset.trail) {
      const message = ai.messages[Number(button.dataset.trail)];
      const open = message.live ? message.trailOpen !== false : Boolean(message.trailOpen);
      message.trailOpen = !open;
      return render();
    }
    if (button.dataset.command) {
      const command = COMMANDS.find((item) => item.id === button.dataset.command);
      if (ai.tab === "guide") ai.tab = "chat";
      return ask(command.prompt, {}, { shown: "", command: command.name });
    }
    const action = button.dataset.ai;
    if (action === "close") return toggle(false);
    if (action === "login") return startLogin();
    if (action === "models") return ai.menu?.kind === "models" ? closeMenu() : openMenu("models");
    if (action === "at" || action === "slash") return ai.menu?.kind === action ? closeMenu() : openMenu(action, "", null);
    if (action === "guide-save") return saveGuide();
    if (action === "guide-undo") {
      ai.guideDraft = null;
      return render();
    }
    if (action === "skip") {
      const index = Number(button.closest("[data-ask]").dataset.ask);
      ai.messages[index].answer = t("skipped");
      return ask("You decide.", {}, { shown: t("You decide.") });
    }
    if (action === "cancel-login") {
      ai.login = null;
      return render();
    }
    if (action === "logout") {
      if (!confirm(t("Disconnect your Claude account from this Screenbook?"))) return;
      ai.menu = null;
      await api("logout", { method: "POST", body: "{}" }).catch((error) => toast(t(error.message)));
      ai.messages = [];
      return load();
    }
    if (action === "reset") {
      await api("reset", { method: "POST", body: "{}" }).catch((error) => toast(t(error.message)));
      ai.messages = [];
      return render();
    }
    if (action === "stop") return api("stop", { method: "POST", body: "{}" }).catch(() => {});
    if (button.dataset.drew) {
      const found = ai.messages[Number(button.dataset.drew)].drew.findLast((item) => item.screen === button.dataset.screen && item.version === Number(button.dataset.version));
      return found && goTo(found);
    }
    if (button.dataset.shot) {
      const [index, shot] = button.dataset.shot.split(":").map(Number);
      const viewer = window.open();
      if (viewer) viewer.document.body.innerHTML = `<img src="${ai.messages[index].images[shot]}" style="max-width:100%">`;
    }
  });

  panel.addEventListener("focusin", (event) => {
    if (event.target.classList?.contains("ai-ask-other")) {
      const radio = event.target.closest(".ai-opt")?.querySelector("input[type=radio]");
      if (radio) radio.checked = true;
    }
  });

  panel.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.target.id === "ai-code-form") return sendCode(panel.querySelector("#ai-code").value);
    if (event.target.dataset.ask) {
      const form = event.target;
      const chosen = form.querySelector("input[type=radio]:checked");
      const answer = (chosen?.value || form.querySelector(".ai-ask-other")?.value || "").trim();
      if (!answer) return form.querySelector(".ai-ask-other")?.focus();
      ai.messages[Number(form.dataset.ask)].answer = answer;
      return ask(answer);
    }
    if (event.target.id === "ai-form") {
      const typed = panel.querySelector("#ai-text").value.trim();
      if (!typed) return;
      const { prompt, command, rest } = expandCommand(typed);
      const shown = command ? rest : typed;
      ask(prompt, {}, { shown, command: command?.name });
    }
  });

  async function startLogin() {
    ai.login = { busy: true };
    render();
    try {
      const started = await api("login", { method: "POST", body: "{}" });
      if (started.done) {
        ai.login = null;
        return load();
      }
      ai.login = { url: started.url };
      watchLogin();
    } catch (error) {
      ai.login = null;
      ai.error = error.message;
    }
    render();
  }

  function watchLogin() {
    const started = ai.login;
    const timer = setInterval(async () => {
      if (ai.login !== started && !ai.login?.url) return clearInterval(timer);
      try {
        const status = await api("status");
        if (status.connected) {
          clearInterval(timer);
          ai.login = null;
          toast(t("Claude account connected."));
          await load();
        } else if (!status.waitingCode && status.loginError) {
          clearInterval(timer);
          ai.login = null;
          ai.error = status.loginError;
          render();
        }
      } catch {}
    }, 2500);
  }

  async function sendCode(code) {
    ai.login = { ...ai.login, busy: true };
    render();
    try {
      await api("code", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      ai.login = null;
      toast(t("Claude account connected."));
      await load();
    } catch (error) {
      ai.login = null;
      ai.error = error.message;
      render();
    }
  }

  async function ask(text, extra = {}, { shown, command } = {}) {
    if (ai.running) return;
    if (!ai.open) toggle(true);
    if (!ai.status?.connected) await load();
    if (!ai.status?.connected) return;
    ai.tab = "chat";
    ai.menu = null;
    const { label, ...context } = { ...contextOf(state), ...extra };
    const mentions = mentionsIn(`${shown ?? text}`, screens());
    if (mentions.length) context.mentions = mentions;
    const reply = { role: "assistant", text: "", live: true, trail: [], images: [], drew: [], model: ai.status.model };
    ai.messages = [...ai.messages, { role: "user", text, shown: shown ?? text, command: command ?? null, context: { ...context, label } }, reply];
    const box = panel.querySelector("#ai-text");
    if (box) box.value = "";
    ai.running = true;
    ai.error = null;
    ai.startedAt = Date.now();
    render();
    const steps = new Map();
    let paint = 0;
    const repaint = () => {
      if (paint) return;
      paint = requestAnimationFrame(() => {
        paint = 0;
        render();
      });
    };
    try {
      const response = await fetch(`${base}/api/ai/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, shown: shown ?? text, command: command ?? null, context: { ...context, label }, model: ai.status.model }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? t("the AI answered {status}", { status: response.status }));
      await readLines(response, (event) => {
        if (event.type === "text") reply.text += event.text;
        if (event.type === "thinking") {
          reply.pondering = true;
          const last = reply.trail.at(-1);
          if (!event.text) return repaint();
          if (last?.kind === "think") last.text += event.text;
          else reply.trail.push({ kind: "think", text: event.text });
          repaint();
        }
        if (event.type === "text" || event.type === "tool") reply.pondering = false;
        if (event.type === "tool") {
          if (reply.text.trim()) reply.trail.push({ kind: "note", text: reply.text.trim() });
          reply.text = "";
          const step = { kind: "tool", id: event.id, name: event.name, label: event.label, detail: event.detail, done: false };
          steps.set(event.id, step);
          reply.trail.push(step);
          if (event.name === "write_screen" && event.detail?.proposal) showProposal(slugOf(event.detail.proposal));
        }
        if (event.type === "tool_done") {
          const step = steps.get(event.id);
          if (step) Object.assign(step, { done: true, error: event.error });
        }
        if (event.type === "image") reply.images.push(event.data);
        if (event.type === "drew") {
          reply.drew = [...reply.drew.filter((item) => item.screen !== event.screen || item.version !== event.version), event];
          refresh(true).catch(() => {});
        }
        if (event.type === "result" && !event.ok) reply.error = event.error ?? t("the AI stopped");
        if (event.type !== "ping") repaint();
      });
    } catch (error) {
      reply.error = error.message;
    }
    reply.live = false;
    reply.seconds = Math.round((Date.now() - ai.startedAt) / 1000);
    for (const step of reply.trail) if (step.kind === "tool" && !step.done) step.done = true;
    reply.text = reply.text.trim();
    const lastNote = reply.trail.findLastIndex((item) => item.kind === "note");
    if (!reply.text && lastNote !== -1) reply.text = reply.trail.splice(lastNote, 1)[0].text;
    ai.running = false;
    render();
    refresh(true).catch(() => {});
    if (reply.error && /login|sign in|conect|connect/i.test(reply.error)) load();
  }

  setInterval(() => {
    if (!ai.running || !ai.open) return;
    const tick = panel.querySelector("[data-tick]");
    if (tick) tick.textContent = `${Math.max(0, Math.round((Date.now() - ai.startedAt) / 1000))}s`;
  }, 1000);

  function decorate() {
    if (document.body.classList.contains("shared")) return;
    for (const thread of document.querySelectorAll("#ov-side .thread[data-root]")) {
      if (!thread.querySelector(".waiting-line") || thread.querySelector(".ai-reply")) continue;
      thread.querySelector(".waiting-line").insertAdjacentHTML("afterend", `<button type="button" class="btn sm ai-reply">${SPARK}${t("Reply with the AI")}</button>`);
    }
    const note = document.querySelector("#note");
    if (note && !note.hidden && state.note?.root && note.querySelector(".waiting-line") && !note.querySelector(".ai-reply")) {
      note.querySelector(".waiting-line").insertAdjacentHTML("afterend", `<button type="button" class="btn sm ai-reply" data-root="${escapeHtml(state.note.root)}">${SPARK}${t("Reply with the AI")}</button>`);
    }
    const actions = note?.querySelector(".note-actions");
    if (actions && state.note?.draft && !actions.querySelector(".ai-ask")) {
      actions.insertAdjacentHTML("afterbegin", `<button type="button" class="btn sm ai-ask">${SPARK}${t("Ask the AI")}</button>`);
    }
  }

  new MutationObserver(decorate).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", (event) => {
    const reply = event.target.closest(".ai-reply");
    if (reply) {
      const root = reply.dataset.root ?? reply.closest(".thread")?.dataset.root;
      if (root) ask("Reply to this comment and do what it asks.", { comment: root });
      return;
    }
    const pickPiece = event.target.closest(".ai-ask");
    if (pickPiece && state.note?.draft) {
      const { item, els } = state.note.draft;
      const typed = document.querySelector("#note-text")?.value.trim();
      if (!typed) return toggle(true);
      const extra = { screen: item.screen.id, version: item.version, el: els[0], label: `${item.screen.number} · ${item.screen.name}` };
      ask(typed.replace(/@claude\b/gi, "").trim(), extra);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.closest?.("input, textarea, [contenteditable]")) return;
    if (document.body.classList.contains("shared")) return;
    if ((event.key === "i" || event.key === "I") && !event.metaKey && !event.ctrlKey && !event.altKey && !screenOpen()) {
      event.preventDefault();
      toggle();
    }
    if (event.key === "j" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      toggle();
    }
  });

  let lastContext = "";
  setInterval(() => {
    if (!ai.open || ai.running) return;
    const now = JSON.stringify(contextOf(state));
    if (now === lastContext) return;
    lastContext = now;
    const top = panel.querySelector(".ai-bar-top");
    if (top) top.innerHTML = contextChip();
  }, 400);

  return { toggle, ask };
}
