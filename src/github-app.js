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
