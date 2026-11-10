import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { repoPeople } from "../src/github-app.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const app = { appId: "1", privateKey };

function fakeGithub() {
  const calls = [];
  const answer = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
  async function fetchImpl(url) {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push(path);
    if (path === "/repos/org/screens/installation") return answer({ id: 7 });
    if (path === "/app/installations/7/access_tokens") return answer({ token: "t", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (path === "/repos/org/screens/collaborators?affiliation=all&per_page=100") {
      return answer([{ login: "ana", avatar_url: "https://avatars/ana" }], { Link: '<https://api.github.com/repos/org/screens/collaborators?affiliation=all&per_page=100&page=2>; rel="next"' });
    }
    if (path === "/repos/org/screens/collaborators?affiliation=all&per_page=100&page=2") return answer([{ login: "bia", avatar_url: "https://avatars/bia" }]);
    if (path === "/users/ana") return answer({ login: "ana", name: "Ana Lima" });
    if (path === "/users/bia") return answer({ login: "bia", name: null });
    return new Response("{}", { status: 404 });
  }
  return { calls, fetchImpl };
}

test("the repository's people come from every page of collaborators, with their names, and stay cached for a while", async () => {
  const github = fakeGithub();
  let clock = 0;
  const people = repoPeople({ repo: "org/screens", app, fetchImpl: github.fetchImpl, now: () => clock });
  const first = await people();
  assert.deepEqual(first, [
    { login: "ana", name: "Ana Lima", avatar: "https://avatars/ana" },
    { login: "bia", name: "bia", avatar: "https://avatars/bia" },
  ]);
  const looked = github.calls.length;
  clock = 9 * 60 * 1000;
  assert.deepEqual(await people(), first);
  assert.equal(github.calls.length, looked);
  clock = 11 * 60 * 1000;
  await people();
  assert.equal(github.calls.filter((path) => path.startsWith("/users/")).length, 2);
  assert.equal(github.calls.filter((path) => path.startsWith("/repos/org/screens/collaborators")).length, 4);
});

test("without a repository or an app there is no people list", () => {
  assert.equal(repoPeople({ repo: "", app }), null);
  assert.equal(repoPeople({ repo: "org/screens", app: null }), null);
});
