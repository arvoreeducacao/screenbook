import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "sbai.";
const LIFETIME_MS = 2 * 60 * 60 * 1000;

export function createInternalTokens({ secret = randomBytes(32), now = () => Date.now() } = {}) {
  const sign = (body) => createHmac("sha256", secret).update(body).digest("base64url");

  return {
    issue({ login, name, product }) {
      const body = Buffer.from(JSON.stringify({ login, name, product: product ?? null, exp: now() + LIFETIME_MS })).toString("base64url");
      return `${PREFIX}${body}.${sign(body)}`;
    },

    open(token) {
      if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
      const [body, signature = ""] = token.slice(PREFIX.length).split(".");
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      return claims.exp > now() ? claims : null;
    },

    fromRequest(request) {
      const token = String(request.headers.authorization ?? "").match(/^Bearer\s+(\S+)$/i)?.[1];
      const claims = this.open(token);
      if (!claims) return null;
      return { login: claims.login, name: `claude via ${claims.login}`, via: claims.login, product: claims.product };
    },
  };
}

const AUTHORED_FIELDS = ["by", "author"];
const POSITIONAL_BY = new Set(["approve", "reopen"]);

export function stampAuthor(method, args, label) {
  if (POSITIONAL_BY.has(method)) return args.map((arg, index) => (index === 1 ? label : arg));
  return args.map((arg) => {
    if (!arg || arg.constructor !== Object) return arg;
    const stamped = { ...arg };
    for (const field of AUTHORED_FIELDS) if (field in stamped) stamped[field] = label;
    return stamped;
  });
}
