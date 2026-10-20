export function scopedStore(store, folder) {
  const prefix = `${folder}/`;
  return {
    kind: store.kind,
    describe: () => `${store.describe()}/${folder}`,
    read: (path) => store.read(prefix + path),
    write: (path, data) => store.write(prefix + path, data),
    append: (path, text) => store.append(prefix + path, text),
    async list(start) {
      const found = await store.list(prefix + start);
      return found.map((path) => path.slice(prefix.length));
    },
    canRead: store.canRead ? (login) => store.canRead(login) : undefined,
    transaction: store.transaction
      ? (message, work) =>
          store.transaction((result) => {
            const label = typeof message === "function" ? message(result) : message;
            return label ? `${folder}: ${label}` : null;
          }, work)
      : undefined,
    token: store.token,
  };
}
