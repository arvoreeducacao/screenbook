import { execFileSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = fileURLToPath(new URL("../skills/screenbook/", import.meta.url));
const PACKAGE = "github:arvoreeducacao/screenbook";

export async function install({ store, viewer, scope = "project", cwd = process.cwd(), log = console.log, run = execFileSync }) {
  if (!store) throw new Error("install needs --store");
  const target = scope === "user" ? join(homedir(), ".claude", "skills", "screenbook") : join(cwd, ".claude", "skills", "screenbook");
  await mkdir(target, { recursive: true });
  await cp(SKILL, target, { recursive: true });
  log(`skill copied to ${target}`);
  const targetScope = scope === "user" ? "user" : "project";
  for (const stale of ["local", targetScope]) {
    try {
      run("claude", ["mcp", "remove", "screenbook", "-s", stale], { cwd, stdio: "pipe" });
      log(`removed the old screenbook MCP registration (${stale})`);
    } catch {}
  }
  const args = ["mcp", "add", "screenbook", "--scope", targetScope, "--", "npx", "-y", PACKAGE, "mcp", "--store", store, ...(viewer ? ["--viewer", viewer] : [])];
  try {
    run("claude", args, { cwd, stdio: "pipe" });
    log(`screenbook MCP registered in Claude Code (${scope})`);
  } catch (error) {
    log(`could not register the MCP on my own (${String(error.message).split("\n")[0]}). Run:\n  claude ${args.join(" ")}`);
  }
  log("done: in a chat, use /screenbook");
}
