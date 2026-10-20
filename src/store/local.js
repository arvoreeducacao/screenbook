import { mkdir, readFile, readdir, writeFile, appendFile, stat } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";

export function localStore(root) {
  const base = resolve(root);

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
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
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
