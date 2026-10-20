import { localStore } from "./local.js";
import { githubStore } from "./github.js";
import { s3Store } from "./s3.js";
import { remoteStore } from "../remote.js";

export async function openStore(spec) {
  if (!spec) throw new Error("missing store: pass --store dir:./book, github:owner/repo or s3://bucket/prefix");
  if (/^https?:\/\//.test(spec)) return remoteStore(spec);
  if (spec.startsWith("github:")) return githubStore(spec.slice("github:".length));
  if (spec.startsWith("s3://")) return s3Store(spec.slice("s3://".length));
  if (spec.startsWith("dir:")) return localStore(spec.slice("dir:".length));
  return localStore(spec);
}
