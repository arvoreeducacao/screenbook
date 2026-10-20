import { randomUUID } from "node:crypto";

function safeForToken(url) {
  const { protocol, hostname } = new URL(url);
  return protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function presenceSender({ viewer, token, handle, session = randomUUID().slice(0, 8), fetchImpl = fetch }) {
  const base = viewer.replace(/\/+$/, "");
  const signed = token && safeForToken(base);
  return async function send(product, activity) {
    const credential = signed ? await token() : null;
    const response = await fetchImpl(`${base}${product ? `/${product}` : ""}/api/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
      body: JSON.stringify({ ...activity, handle, session }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`the viewer answered ${response.status} to presence`);
  };
}
