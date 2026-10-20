export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

export function keyLabel(keys) {
  return keys
    .replace(/Mod \+ /g, MAC ? "⌘ + " : "Ctrl + ")
    .replace(/Mod\+/g, MAC ? "⌘" : "Ctrl+")
    .replace(/Shift\+/g, MAC ? "⇧" : "Shift+")
    .replace(/Alt\+/g, MAC ? "⌥" : "Alt+");
}

export function openMenu({ menu, close, event, title, entries, anchor }) {
  menu.innerHTML = `${title ? `<div class="fm-title">${escapeHtml(title)}</div>` : ""}${entries
    .map((entry, index) =>
      entry
        ? `<button class="fm-item${entry.on ? " on" : ""}" data-index="${index}"${entry.disabled ? " disabled" : ""}><span>${escapeHtml(entry.label)}</span>${entry.keys ? `<kbd>${escapeHtml(keyLabel(entry.keys))}</kbd>` : ""}</button>`
        : '<div class="fm-sep"></div>',
    )
    .join("")}`;
  menu.hidden = false;
  const box = anchor ?? (event.type === "contextmenu" ? null : event.currentTarget?.getBoundingClientRect?.());
  const x = box ? box.left : event.clientX;
  const y = box ? (box.top > window.innerHeight / 2 ? box.top - menu.offsetHeight - 6 : box.bottom + 6) : event.clientY;
  menu.style.left = `${Math.max(12, Math.min(x, window.innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(y, window.innerHeight - menu.offsetHeight - 12))}px`;
  menu.querySelectorAll("[data-index]").forEach((button) =>
    button.addEventListener("click", () => {
      close();
      entries[Number(button.dataset.index)].run();
    }),
  );
}
