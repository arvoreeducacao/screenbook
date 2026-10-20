const CLIENT_ID = /^[\w-]{6,40}$/;

function event(response, name, data) {
  response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function cleanCursor(cursor) {
  if (!cursor || typeof cursor !== "object") return null;
  const number = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined);
  const screen = typeof cursor.screen === "string" && /^[\w-]{1,80}$/.test(cursor.screen) ? cursor.screen : undefined;
  return {
    screen,
    version: Number.isInteger(cursor.version) ? cursor.version : undefined,
    rx: number(cursor.rx),
    ry: number(cursor.ry),
    x: number(cursor.x),
    y: number(cursor.y),
    looking: cursor.looking === true || undefined,
    hand: cursor.hand === true || undefined,
    five: typeof cursor.five === "string" && CLIENT_ID.test(cursor.five) ? cursor.five : undefined,
    page: typeof cursor.page === "string" && /^[\w-]{1,120}$/.test(cursor.page) ? cursor.page : undefined,
  };
}

function cleanView(view) {
  if (!view || typeof view !== "object") return null;
  const values = [view.cx, view.cy, view.w, view.h];
  if (!values.every(Number.isFinite) || view.w <= 0 || view.h <= 0) return null;
  const [cx, cy, w, h] = values.map((value) => Math.round(value * 10) / 10);
  return { cx, cy, w, h };
}

function cleanFollowing(following) {
  return typeof following === "string" && CLIENT_ID.test(following) ? following : null;
}

const AGENT_FORGET_MS = 30 * 60 * 1000;
const AGENTS_PER_PRODUCT = 50;
const AGENT_NAME = /^[a-z][\w-]{0,39}$/;
const AGENT_SESSION = /^[\w-]{4,40}$/;
const SLUG = /^[\w-]{1,120}$/;

function cleanActivity(activity) {
  if (!activity || typeof activity !== "object") return null;
  const handle = String(activity.handle ?? "").toLowerCase();
  const session = String(activity.session ?? "");
  if (!AGENT_NAME.test(handle) || !AGENT_SESSION.test(session)) return null;
  const word = (value) => (typeof value === "string" && SLUG.test(value) ? value : undefined);
  return {
    handle,
    session,
    action: typeof activity.action === "string" && /^[a-z]{1,20}$/.test(activity.action) ? activity.action : "looking",
    screen: word(activity.screen),
    proposal: word(activity.proposal),
    version: Number.isInteger(activity.version) ? activity.version : undefined,
    name: typeof activity.name === "string" ? activity.name.slice(0, 120) : undefined,
    el: typeof activity.el === "string" && activity.el.trim() ? activity.el.slice(0, 120) : undefined,
    section: word(activity.section),
    page: word(activity.page),
    boardX: Number.isFinite(activity.boardX) ? Math.round(activity.boardX) : undefined,
    boardY: Number.isFinite(activity.boardY) ? Math.round(activity.boardY) : undefined,
    variantOf: word(activity.variantOf),
    after: word(activity.after),
    via: typeof activity.via === "string" && /^[a-z0-9][a-z0-9-]{0,38}$/.test(activity.via) ? activity.via : undefined,
    at: new Date().toISOString(),
  };
}

export function createLive({ pollMs = 1500, heartbeatMs = 20000 } = {}) {
  const rooms = new Map();
  const pushed = new Map();

  function roomFor(key, book) {
    if (!rooms.has(key)) rooms.set(key, { book, clients: new Map(), polled: [], agents: [], agentsSignature: "", timer: null, beat: null });
    return rooms.get(key);
  }

  function pushedFor(key) {
    const sessions = pushed.get(key) ?? new Map();
    for (const [session, activity] of sessions) {
      if (Date.now() - new Date(activity.at).getTime() > AGENT_FORGET_MS) sessions.delete(session);
    }
    return [...sessions.values()];
  }

  function share(room, key) {
    const agents = [...room.polled, ...pushedFor(key)];
    const signature = JSON.stringify(agents);
    if (signature === room.agentsSignature) return;
    room.agentsSignature = signature;
    room.agents = agents;
    broadcast(room, "agents", agents);
  }

  function broadcast(room, name, data, except) {
    for (const [id, client] of room.clients) if (id !== except) event(client.response, name, data);
  }

  async function pollAgents(room, key) {
    room.polled = await room.book.presence().catch(() => room.polled);
    share(room, key);
  }

  function start(room, key) {
    if (room.timer) return;
    room.timer = setInterval(() => pollAgents(room, key), pollMs);
    room.beat = setInterval(() => {
      for (const client of room.clients.values()) client.response.write(": ping\n\n");
    }, heartbeatMs);
  }

  function stop(key, room) {
    if (room.clients.size) return;
    clearInterval(room.timer);
    clearInterval(room.beat);
    rooms.delete(key);
  }

  return {
    async join({ key, book, id, person, request, response }) {
      if (!CLIENT_ID.test(id ?? "")) throw Object.assign(new Error("pass an id"), { status: 400 });
      const room = roomFor(key, book);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write("retry: 2000\n\n");
      const previous = room.clients.get(id);
      if (previous) previous.response.end();
      const client = { response, person: { id, ...person }, cursor: null, view: null, following: null };
      room.clients.set(id, client);
      if (!room.agentsSignature) await pollAgents(room, key);
      event(response, "snapshot", {
        people: [...room.clients.values()].filter((other) => other !== client).map((other) => ({ ...other.person, cursor: other.cursor, view: other.view, following: other.following })),
        agents: room.agents,
      });
      broadcast(room, "join", client.person, id);
      start(room, key);
      request.on("close", () => {
        if (room.clients.get(id) !== client) return;
        room.clients.delete(id);
        broadcast(room, "leave", { id });
        stop(key, room);
      });
    },

    agent({ key, activity }) {
      const clean = cleanActivity(activity);
      if (!clean) return false;
      if (!pushed.has(key)) pushed.set(key, new Map());
      const sessions = pushed.get(key);
      sessions.delete(clean.session);
      sessions.set(clean.session, clean);
      if (sessions.size > AGENTS_PER_PRODUCT) sessions.delete(sessions.keys().next().value);
      const room = rooms.get(key);
      if (room) share(room, key);
      return true;
    },

    move({ key, id, cursor, view, following }) {
      const client = rooms.get(key)?.clients.get(id);
      if (!client) return false;
      client.cursor = cleanCursor(cursor);
      client.view = cleanView(view);
      client.following = cleanFollowing(following);
      broadcast(rooms.get(key), "cursor", { id, cursor: client.cursor, view: client.view, following: client.following }, id);
      return true;
    },

    emit({ key, name, data, except }) {
      const room = rooms.get(key);
      if (room) broadcast(room, name, data, except);
    },

    rooms,
  };
}
