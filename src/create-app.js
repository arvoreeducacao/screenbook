import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:48px;max-width:560px;line-height:1.5">${body}</body>`;
}

export function appManifest({ name, publicUrl, localPort }) {
  return {
    name,
    url: publicUrl,
    redirect_url: `http://127.0.0.1:${localPort}/created`,
    callback_urls: [`${publicUrl}/auth/callback`, "http://127.0.0.1:4600/auth/callback"],
    public: false,
    default_permissions: { contents: "write", metadata: "read" },
  };
}

export async function createGithubApp({ org, publicUrl, name = "Screenbook", out, port = 4699, fetchImpl = fetch, log = console.log }) {
  const state = randomBytes(12).toString("hex");
  const manifest = appManifest({ name, publicUrl: publicUrl.replace(/\/+$/, ""), localPort: port });
  const action = `https://github.com/organizations/${org}/settings/apps/new?state=${state}`;

  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      try {
        if (url.pathname === "/") {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(
            page(
              "Create the Screenbook app",
              `<p>Taking you to GitHub to create the app <b>${name}</b> in the organization <b>${org}</b>…</p>
              <form id="f" method="post" action="${action}"><input type="hidden" name="manifest" id="m"><button>Continue</button></form>
              <script>document.getElementById("m").value = ${JSON.stringify(JSON.stringify(manifest))}; document.getElementById("f").submit();</script>`,
            ),
          );
          return;
        }
        if (url.pathname === "/created") {
          if (url.searchParams.get("state") !== state) throw new Error("state does not match; start again");
          const conversion = await fetchImpl(`https://api.github.com/app-manifests/${url.searchParams.get("code")}/conversions`, {
            method: "POST",
            headers: { Accept: "application/vnd.github+json" },
          });
          if (!conversion.ok) throw new Error(`GitHub answered ${conversion.status}: ${await conversion.text()}`);
          const app = await conversion.json();
          const credentials = {
            appId: app.id,
            slug: app.slug,
            clientId: app.client_id,
            clientSecret: app.client_secret,
            privateKey: app.pem,
            htmlUrl: app.html_url,
          };
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
          const install = `https://github.com/apps/${app.slug}/installations/new`;
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(
            page(
              "App created",
              `<h1 style="font-weight:400">App created.</h1><p>One click left: <a href="${install}">install the app on the screens repository</a>, choosing only that repository.</p><p>You can close this tab afterwards.</p>`,
            ),
          );
          log(`app created: ${app.html_url}\ncredentials in ${out}\ninstall it at: ${install}`);
          server.close();
          resolve(credentials);
          return;
        }
        response.writeHead(404);
        response.end();
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page("Error", `<p>${String(error.message).replace(/</g, "&lt;")}</p>`));
        server.close();
        reject(error);
      }
    });
    server.listen(port, "127.0.0.1", () => log(`open http://127.0.0.1:${port} to create the app on GitHub`));
  });
}
