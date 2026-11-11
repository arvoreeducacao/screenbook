import { mkdir, readFile, readdir, writeFile, appendFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, relative, sep } from "node:path";

const WRITING = ".writing";

export function localStore(root) {
  const base = resolve(root);
  let writes = 0;

  function full(path) {
    const target = resolve(base, path);
    if (target !== base && !target.startsWith(base + sep)) {
      throw new Error(`path escapes the store: ${path}`);
    }
    return target;
  }

  return {
    kind: "local",
    describe: () => `dir:${base}`,

    async read(path) {
      try {
        return await readFile(full(path));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },

    async write(path, data) {
      const target = full(path);
      const pending = join(base, WRITING, `${process.pid}-${++writes}-${basename(target)}`);
      await mkdir(dirname(target), { recursive: true });
      await mkdir(dirname(pending), { recursive: true });
      await writeFile(pending, data);
      await rename(pending, target);
    },

    async append(path, text) {
      const target = full(path);
      await mkdir(dirname(target), { recursive: true });
      await appendFile(target, text);
    },

    async list(prefix) {
      const start = full(prefix);
      const found = [];
      async function walk(dir) {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        for (const entry of entries) {
          if (dir === base && entry.name === WRITING) continue;
          const path = join(dir, entry.name);
          if (entry.isDirectory()) await walk(path);
          else found.push(relative(base, path).split(sep).join("/"));
        }
      }
      const info = await stat(start).catch(() => null);
      if (info?.isDirectory()) await walk(start);
      return found.sort();
    },
  };
}
