import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pickLang, translate } from "../viewer/i18n.js";

const SESSION_COOKIE = "screenbook_session";
const STATE_COOKIE = "screenbook_state";
const NEXT_COOKIE = "screenbook_next";
const SESSION_DAYS = 14;
const TOKEN_TRUST_MS = 10 * 60 * 1000;
const TOKEN_DOUBT_MS = 60 * 1000;
const TOKENS_REMEMBERED = 500;

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function sealSession(user, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...user, exp: now + SESSION_DAYS * 86400 * 1000 })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function openSession(token, secret, now = Date.now()) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return session.exp > now ? session : null;
}

function cookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))]),
  );
}

function cookie(name, value, { maxAge, secure }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function authFromEnvironment(env = process.env) {
  const clientId = env.SCREENBOOK_GITHUB_CLIENT_ID;
  const clientSecret = env.SCREENBOOK_GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (!env.SCREENBOOK_SESSION_SECRET) throw new Error("GitHub login needs SCREENBOOK_SESSION_SECRET");
  return {
    clientId,
    clientSecret,
    sessionSecret: env.SCREENBOOK_SESSION_SECRET,
    publicUrl: env.SCREENBOOK_PUBLIC_URL?.replace(/\/+$/, "") ?? null,
  };
}

export function createAuth({ clientId, clientSecret, sessionSecret, publicUrl, canRead, fetchImpl = fetch }) {
  function origin(request) {
    if (publicUrl) return publicUrl;
    const proto = request.headers["x-forwarded-proto"] ?? "http";
    return `${proto}://${request.headers.host}`;
  }

  function secure(request) {
    return origin(request).startsWith("https://");
  }

  function user(request) {
    return openSession(cookies(request)[SESSION_COOKIE], sessionSecret);
  }

  function redirect(response, location, headers = {}) {
    response.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers });
    response.end();
  }

  function deny(request, response, status, message, vars) {
    const language = pickLang(request.headers["accept-language"]);
    const tr = (text, values) => translate(language, text, values);
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(
      `<!doctype html><html lang="${language}"><meta charset="utf-8"><title>Screenbook</title><body style="font-family:system-ui;padding:48px;max-width:520px"><h1 style="font-weight:400">${tr("No access")}</h1><p>${tr(message, vars)}</p><p><a href="/auth/login">${tr("Sign in with another account")}</a></p></body>`,
    );
  }

  async function exchange(code, redirectUri) {
    const response = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const body = await response.json();
    if (!body.access_token) throw new Error(body.error_description ?? "GitHub did not return a token");
    return body.access_token;
  }

  async function profile(accessToken) {
    const response = await fetchImpl("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub /user answered ${response.status}`);
    return response.json();
  }

  const tokens = new Map();

  async function checkToken(token) {
    try {
      const account = await profile(token);
      if (canRead && !(await canRead(account.login))) return null;
      return { login: account.login, name: account.name || account.login, avatar: account.avatar_url };
    } catch {
      return null;
    }
  }

  async function userFromToken(request) {
    const token = String(request.headers.authorization ?? "").match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return null;
    const key = createHash("sha256").update(token).digest("hex");
    const known = tokens.get(key);
    if (known && known.until > Date.now()) return known.user;
    const found = await checkToken(token);
    if (tokens.size >= TOKENS_REMEMBERED) tokens.clear();
    tokens.set(key, { user: found, until: Date.now() + (found ? TOKEN_TRUST_MS : TOKEN_DOUBT_MS) });
    return found;
  }

  function safeNext(value) {
    const next = String(value ?? "");
    return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/auth/") ? next : "/";
  }

  async function handle(request, response, url) {
    if (url.pathname === "/auth/login") {
      const state = randomBytes(16).toString("base64url");
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", `${origin(request)}/auth/callback`);
      authorize.searchParams.set("state", state);
      return redirect(response, authorize.toString(), {
        "Set-Cookie": [
          cookie(STATE_COOKIE, state, { maxAge: 600, secure: secure(request) }),
          cookie(NEXT_COOKIE, safeNext(url.searchParams.get("next")), { maxAge: 600, secure: secure(request) }),
        ],
      });
    }
    if (url.pathname === "/auth/callback") {
      const expected = cookies(request)[STATE_COOKIE];
      if (!expected || expected !== url.searchParams.get("state")) return deny(request, response, 400, "Your sign-in expired. Try again.");
      const accessToken = await exchange(url.searchParams.get("code"), `${origin(request)}/auth/callback`);
      const account = await profile(accessToken);
      if (canRead && !(await canRead(account.login))) {
        return deny(request, response, 403, "The account <b>{login}</b> has no access to this Screenbook's repository.", { login: account.login });
      }
      const session = sealSession({ login: account.login, name: account.name || account.login, avatar: account.avatar_url }, sessionSecret);
      const next = safeNext(cookies(request)[NEXT_COOKIE]);
      return redirect(response, next, {
        "Set-Cookie": [
          cookie(SESSION_COOKIE, session, { maxAge: SESSION_DAYS * 86400, secure: secure(request) }),
          cookie(STATE_COOKIE, "", { maxAge: 0, secure: secure(request) }),
          cookie(NEXT_COOKIE, "", { maxAge: 0, secure: secure(request) }),
        ],
      });
    }
    if (url.pathname === "/auth/logout") {
      return redirect(response, "/auth/login", {
        "Set-Cookie": cookie(SESSION_COOKIE, "", { maxAge: 0, secure: secure(request) }),
      });
    }
    return deny(request, response, 404, "Page not found.");
  }

  return { user, userFromToken, handle, redirect };
}
