import { execFile } from "node:child_process";

const SOCKET = "screenbook";
const URL_WAIT_MS = 45000;
const CODE_WAIT_MS = 40000;
const WATCH_MS = 15 * 60 * 1000;

export function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

export function loginUrlIn(screen) {
  const matches = String(screen).match(/https:\/\/(?:claude\.ai|console\.anthropic\.com|claude\.com)\/[^\s"'<>]+/g);
  return matches ? matches.at(-1) : null;
}

export function loginFailedIn(screen) {
  const tail = String(screen).split("\n").slice(-8).join("\n");
  return /(OAuth error|Invalid code|Login failed|Authorization failed)/i.test(tail);
}

function quote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 20000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: `${stdout}${stderr}` });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLogins({ homes, claude = process.env.SCREENBOOK_CLAUDE ?? "claude", exec = run, pause = sleep, env = process.env }) {
  const waiting = new Map();
  const failures = new Map();
  const tmux = (...args) => exec("tmux", ["-L", SOCKET, ...args], { env: { PATH: env.PATH, HOME: env.HOME, TMUX_TMPDIR: env.TMUX_TMPDIR } });
  const session = (login) => `login-${login}`;
  const pane = async (login) => stripAnsi((await tmux("capture-pane", "-t", session(login), "-p", "-J", "-S", "-200")).out);

  async function stop(login) {
    waiting.delete(login);
    await tmux("kill-session", "-t", session(login));
  }

  async function watch(login, startedAt) {
    const deadline = startedAt + WATCH_MS;
    while (waiting.get(login) === startedAt && Date.now() < deadline) {
      await pause(2000);
      if (waiting.get(login) !== startedAt) return;
      const screen = await pane(login);
      if (/Login successful/i.test(screen)) return finish(login).catch(() => {});
      if (loginFailedIn(screen)) {
        failures.set(login, "Claude refused the sign-in; start again");
        return stop(login);
      }
    }
    if (waiting.get(login) === startedAt) await stop(login);
  }

  async function finish(login) {
    await stop(login);
    await homes.persist(login);
    return homes.status(login);
  }

  return {
    async start(login) {
      const places = await homes.restore(login);
      await stop(login);
      const command = `cd ${quote(places.work)} && env -i PATH=${quote(env.PATH ?? "")} HOME=${quote(places.base)} CLAUDE_CONFIG_DIR=${quote(places.config)} DISABLE_AUTOUPDATER=1 ${quote(claude)} auth login --claudeai; sleep 900`;
      const started = await tmux("new-session", "-d", "-s", session(login), "-x", "400", "-y", "60", command);
      if (!started.ok) throw new Error("could not open the Claude sign-in on this server");
      const startedAt = Date.now();
      failures.delete(login);
      waiting.set(login, startedAt);
      const deadline = Date.now() + URL_WAIT_MS;
      while (Date.now() < deadline) {
        await pause(1000);
        const screen = await pane(login);
        const url = loginUrlIn(screen);
        if (url) {
          watch(login, startedAt).catch(() => {});
          return { url };
        }
        if (/Login successful/i.test(screen)) return { done: await finish(login) };
      }
      await stop(login);
      throw new Error("Claude did not show the sign-in link in time; try again");
    },

    async code(login, code) {
      if (!waiting.has(login)) {
        const status = await homes.status(login);
        if (status.connected) return status;
        throw new Error(failures.get(login) ?? "the sign-in expired or the server restarted; start again");
      }
      const clean = String(code ?? "").trim();
      if (!clean || clean.length > 400 || /\s/.test(clean)) throw new Error("paste the whole code, without spaces");
      await tmux("send-keys", "-t", session(login), "-l", clean);
      await pause(500);
      await tmux("send-keys", "-t", session(login), "Enter");
      const deadline = Date.now() + CODE_WAIT_MS;
      while (Date.now() < deadline) {
        await pause(1000);
        if (!waiting.has(login)) {
          const status = await homes.status(login);
          if (status.connected) return status;
          throw new Error(failures.get(login) ?? "the sign-in was interrupted; start again");
        }
        const screen = await pane(login);
        if (/Login successful/i.test(screen)) return finish(login);
        if (loginFailedIn(screen)) {
          await stop(login);
          throw new Error("Claude refused the code; start the sign-in again");
        }
      }
      await stop(login);
      throw new Error("Claude did not confirm the sign-in in time; try again");
    },

    stop,
    waiting: (login) => waiting.has(login),
    failure: (login) => failures.get(login) ?? null,
  };
}
