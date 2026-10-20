import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountKey } from "./vault.js";

const KEPT = [".credentials.json", ".claude.json"];

function digest(files) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

export function createHomes({ vault, root = process.env.SCREENBOOK_AI_HOME ?? join(tmpdir(), "screenbook-ai") }) {
  const known = new Map();

  function placesOf(login) {
    const base = join(root, accountKey(login));
    return { base, config: join(base, "config"), work: join(base, "work") };
  }

  async function readKept(config) {
    const files = {};
    for (const name of KEPT) {
      const text = await readFile(join(config, name), "utf8").catch(() => null);
      if (text) files[name] = text;
    }
    return files;
  }

  async function prepare(places) {
    await mkdir(places.config, { recursive: true, mode: 0o700 });
    await mkdir(places.work, { recursive: true, mode: 0o700 });
    const file = join(places.config, ".claude.json");
    let config = {};
    try {
      config = JSON.parse(await readFile(file, "utf8"));
    } catch {}
    config.hasCompletedOnboarding = true;
    config.projects = config.projects ?? {};
    config.projects[places.work] = { ...(config.projects[places.work] ?? {}), hasTrustDialogAccepted: true };
    await writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  return {
    placesOf,

    async restore(login) {
      const places = placesOf(login);
      if (!known.has(login)) {
        const saved = await vault.load(login);
        await mkdir(places.config, { recursive: true, mode: 0o700 });
        for (const [name, text] of Object.entries(saved ?? {})) {
          if (KEPT.includes(name)) await writeFile(join(places.config, name), text, { mode: 0o600 });
        }
        known.set(login, digest(await readKept(places.config)));
      }
      await prepare(places);
      return places;
    },

    async persist(login) {
      const places = placesOf(login);
      const files = await readKept(places.config);
      if (!files[".credentials.json"]) return false;
      const signature = digest(files);
      if (known.get(login) === signature) return false;
      await vault.save(login, files);
      known.set(login, signature);
      return true;
    },

    async status(login) {
      const places = await this.restore(login);
      const files = await readKept(places.config);
      let oauth = null;
      try {
        oauth = JSON.parse(files[".credentials.json"] ?? "null")?.claudeAiOauth ?? null;
      } catch {}
      if (!oauth?.refreshToken && !oauth?.accessToken) return { connected: false };
      let account = null;
      try {
        account = JSON.parse(files[".claude.json"] ?? "{}")?.oauthAccount?.emailAddress ?? null;
      } catch {}
      return { connected: true, account };
    },

    async forget(login) {
      known.delete(login);
      await vault.clear(login);
      await rm(placesOf(login).base, { recursive: true, force: true });
    },
  };
}
