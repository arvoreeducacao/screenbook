import { setTimeout as sleep } from "node:timers/promises";
import { bookOn, isMulti, listProducts, productBooks } from "./products.js";

async function pendingEverywhere(store, handle, product) {
  if (product) return (await (await productBooks(store)(product)).pendingMentions(handle)).map((mention) => ({ product, ...mention }));
  if (!(await isMulti(store))) return bookOn(store).pendingMentions(handle);
  const bookFor = productBooks(store);
  const lists = await Promise.all(
    (await listProducts(store)).map(async ({ id }) => (await (await bookFor(id)).pendingMentions(handle)).map((mention) => ({ product: id, ...mention }))),
  );
  return lists.flat();
}

function keyOf(mention) {
  return `${mention.product ?? ""}:${mention.comment}`;
}

export async function waitForMentions({
  store,
  handle,
  product,
  interval = 5000,
  timeout = 0,
  follow = false,
  out = process.stdout,
  signal,
  onListening = () => {},
}) {
  const started = Date.now();
  const delivered = new Set();
  let previous = null;
  while (!signal?.aborted) {
    const pending = await pendingEverywhere(store, handle, product);
    if (previous === null) onListening();
    const seenBefore = previous ?? new Set();
    previous = new Set(pending.map(keyOf));
    const fresh = pending.filter((mention) => seenBefore.has(keyOf(mention)) && !delivered.has(keyOf(mention)));
    for (const mention of fresh) {
      delivered.add(keyOf(mention));
      out.write(`${JSON.stringify(mention)}\n`);
    }
    if (fresh.length && !follow) return fresh;
    if (timeout && Date.now() - started >= timeout) return [];
    await sleep(interval, undefined, { signal }).catch(() => {});
  }
  return [];
}
