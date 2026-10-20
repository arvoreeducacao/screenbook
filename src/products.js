import { Book, slug } from "./book.js";
import { scopedStore } from "./store/scoped.js";
import { remoteBook } from "./remote.js";

const PRODUCT = /^[a-z0-9][a-z0-9-]*$/;

const RESERVED = new Set(["api", "auth", "healthz"]);

export function bookOn(store, product = null) {
  if (store.kind === "remote") return remoteBook(store, product);
  return new Book(product ? scopedStore(store, product) : store);
}

export async function isMulti(store) {
  if (store.kind === "remote") return store.call(null, "isMulti");
  return !(await store.read("project.json"));
}

export async function createProduct(store, { name, id, head }) {
  if (store.kind === "remote") return store.call(null, "createProduct", [{ name, id, head }]);
  if (!String(name ?? "").trim()) throw new Error("a product needs a name");
  const product = slug(id ?? name);
  if (!PRODUCT.test(product) || RESERVED.has(product)) throw new Error(`"${product}" cannot be a product folder`);
  if (await store.read(`${product}/project.json`)) throw new Error(`product "${product}" already exists`);
  const book = new Book(scopedStore(store, product));
  return book.saving(`created the product ${name.trim()}`, async () => {
    await book.init({ name: name.trim() });
    if (head?.trim()) {
      await book.store.write("head.html", head);
      await book.writeJson("project.json", { ...(await book.project()), head: "head.html" });
    }
    return { id: product, name: name.trim() };
  });
}

export async function listProducts(store) {
  if (store.kind === "remote") return store.call(null, "listProducts");
  const paths = await store.list("");
  const ids = paths.map((path) => path.match(/^([a-z0-9][a-z0-9-]*)\/project\.json$/)?.[1]).filter(Boolean);
  const products = [];
  for (const id of ids) {
    const project = JSON.parse((await store.read(`${id}/project.json`)).toString("utf8"));
    products.push({ id, name: project.name ?? id });
  }
  return products.sort((a, b) => a.name.localeCompare(b.name));
}

export function productBooks(store) {
  const books = new Map();
  return async function bookFor(product) {
    if (!PRODUCT.test(String(product ?? ""))) throw new Error(`invalid product "${product}"`);
    if (store.kind === "remote") return remoteBook(store, product);
    if (!books.has(product)) {
      if (!(await store.read(`${product}/project.json`))) {
        const known = (await listProducts(store)).map((item) => item.id).join(", ") || "none";
        throw new Error(`no product called "${product}" (known: ${known})`);
      }
      books.set(product, new Book(scopedStore(store, product)));
    }
    return books.get(product);
  };
}

function coverOf(screens) {
  const dated = screens
    .map((meta) => ({ meta, last: meta.versions.at(-1) }))
    .filter(({ last }) => last)
    .sort((a, b) => String(b.last.at).localeCompare(String(a.last.at)));
  const official = dated.find(({ meta }) => meta.official);
  const pick = official ?? dated[0];
  if (!pick) return null;
  return { screen: pick.meta.id, version: pick.meta.official ?? pick.last.v };
}

export async function productSummaries(store) {
  const products = await listProducts(store);
  return Promise.all(
    products.map(async (product) => {
      const book = new Book(scopedStore(store, product.id));
      const [screens, proposals] = await Promise.all([book.screens(), book.proposals()]);
      const updatedAt = screens.map((meta) => meta.versions.at(-1)?.at).filter(Boolean).sort().at(-1) ?? null;
      return {
        ...product,
        screens: screens.length,
        openProposals: proposals.filter((record) => record.status === "open").length,
        updatedAt,
        cover: coverOf(screens),
      };
    }),
  );
}
