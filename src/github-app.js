import { createSign } from "node:crypto";

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function appJwt({ appId, privateKey, now = Date.now() }) {
  const seconds = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: String(appId) }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

export function installationTokenProvider({ appId, privateKey, owner, repo, fetchImpl = fetch }) {
  let cached = null;
  let installationId = null;

  async function request(method, path, jwt) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub app ${method} ${path} answered ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  return async function token() {
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
    const jwt = appJwt({ appId, privateKey });
    if (!installationId) {
      const installation = await request("GET", `/repos/${owner}/${repo}/installation`, jwt);
      installationId = installation.id;
    }
    const issued = await request("POST", `/app/installations/${installationId}/access_tokens`, jwt);
    cached = { token: issued.token, expiresAt: new Date(issued.expires_at).getTime() };
    return cached.token;
  };
}

export function appFromEnvironment(env = process.env) {
  if (!env.SCREENBOOK_GITHUB_APP_ID || !env.SCREENBOOK_GITHUB_APP_PRIVATE_KEY) return null;
  return {
    appId: env.SCREENBOOK_GITHUB_APP_ID,
    privateKey: env.SCREENBOOK_GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}

export function repoAccess({ repo, app = appFromEnvironment(), fetchImpl = fetch }) {
  const [owner, name] = String(repo).split("/");
  if (!owner || !name || !app) return null;
  const token = installationTokenProvider({ ...app, owner, repo: name, fetchImpl });
  return async function canRead(login) {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}/collaborators/${encodeURIComponent(login)}/permission`, {
      headers: { Authorization: `Bearer ${await token()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) return false;
    const { permission } = await response.json();
    return ["admin", "maintain", "write", "triage", "read"].includes(permission);
  };
}

const PEOPLE_TTL_MS = 10 * 60 * 1000;
const NAME_LOOKUPS_AT_ONCE = 8;

function nextPage(link) {
  const next = String(link ?? "").match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  return next?.startsWith("https://api.github.com/") ? next : null;
}

export function repoPeople({ repo, app = appFromEnvironment(), fetchImpl = fetch, now = () => Date.now() }) {
  const [owner, name] = String(repo).split("/");
  if (!owner || !name || !app) return null;
  const token = installationTokenProvider({ ...app, owner, repo: name, fetchImpl });
  const names = new Map();
  let cached = null;
  let loading = null;

  async function get(url) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${await token()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${new URL(url).pathname}`);
    return { body: await response.json(), next: nextPage(response.headers.get("link")) };
  }

  async function nameOf(login) {
    if (names.has(login)) return names.get(login);
    const { body } = await get(`https://api.github.com/users/${encodeURIComponent(login)}`);
    const found = body?.name || login;
    names.set(login, found);
    return found;
  }

  async function load() {
    const collaborators = [];
    for (let url = `https://api.github.com/repos/${owner}/${name}/collaborators?affiliation=all&per_page=100`; url; ) {
      const page = await get(url);
      collaborators.push(...(Array.isArray(page.body) ? page.body : []));
      url = page.next;
    }
    const valid = collaborators.filter((person) => typeof person?.login === "string");
    const list = [];
    for (let start = 0; start < valid.length; start += NAME_LOOKUPS_AT_ONCE) {
      const batch = valid.slice(start, start + NAME_LOOKUPS_AT_ONCE);
      list.push(...(await Promise.all(batch.map(async (person) => ({ login: person.login, name: await nameOf(person.login).catch(() => person.login), avatar: person.avatar_url ?? null })))));
    }
    cached = { at: now(), list };
    return list;
  }

  return async function people() {
    if (cached && now() - cached.at < PEOPLE_TTL_MS) return cached.list;
    loading ??= load().finally(() => (loading = null));
    return loading;
  };
}
