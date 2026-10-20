import { loadImage } from "./export.js";
import { t } from "./i18n.js";

const STATUS = { approved: "approved", archived: "archived", open: "still open" };

export function timeline(screen, proposals = []) {
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const latest = screen.versions.at(-1)?.v;
  return [...screen.versions].reverse().map((entry) => {
    const proposal = byId.get(entry.proposal) ?? null;
    return {
      v: entry.v,
      by: entry.by,
      at: entry.at,
      width: entry.width,
      height: entry.height,
      official: screen.official === entry.v,
      latest: entry.v === latest,
      proposal: proposal ? { id: proposal.id, title: proposal.title, status: proposal.status, label: STATUS[proposal.status] ? t(STATUS[proposal.status]) : proposal.status } : entry.proposal ? { id: entry.proposal, title: entry.proposal, status: null, label: null } : null,
      restoredFrom: entry.restoredFrom ?? null,
    };
  });
}

export function diffRegions(before, after, width, height, { threshold = 40, cell = 8, gap = 2 } = {}) {
  const changed = new Uint8Array(width * height);
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells = new Uint8Array(columns * rows);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const delta = Math.abs(before[at] - after[at]) + Math.abs(before[at + 1] - after[at + 1]) + Math.abs(before[at + 2] - after[at + 2]) + Math.abs(before[at + 3] - after[at + 3]);
      if (delta <= threshold) continue;
      changed[y * width + x] = 1;
      cells[Math.floor(y / cell) * columns + Math.floor(x / cell)] = 1;
      count += 1;
    }
  }
  const seen = new Uint8Array(columns * rows);
  const boxes = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    while (stack.length) {
      const index = stack.pop();
      const cx = index % columns;
      const cy = Math.floor(index / columns);
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      for (let dy = -gap; dy <= gap; dy += 1) {
        for (let dx = -gap; dx <= gap; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
          const next = ny * columns + nx;
          if (cells[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    const x = minX * cell;
    const y = minY * cell;
    boxes.push({ x, y, w: Math.min(width, (maxX + 1) * cell) - x, h: Math.min(height, (maxY + 1) * cell) - y });
  }
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  return { changed, count, boxes };
}

export function paintDiff(after, changed, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const at = index * 4;
    if (changed[index]) {
      out[at] = Math.round(after[at] * 0.35 + 242 * 0.65);
      out[at + 1] = Math.round(after[at + 1] * 0.35 + 72 * 0.65);
      out[at + 2] = Math.round(after[at + 2] * 0.35 + 34 * 0.65);
    } else {
      const light = 0.299 * after[at] + 0.587 * after[at + 1] + 0.114 * after[at + 2];
      const faded = Math.round(255 - (255 - light) * 0.3);
      out[at] = faded;
      out[at + 1] = faded;
      out[at + 2] = faded;
    }
    out[at + 3] = 255;
  }
  return out;
}

function pixels(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

const MODES = [
  ["slide", "Slide"],
  ["side", "Side by side"],
  ["diff", "Difference"],
];

export function createHistory({ base, escapeHtml, timeAgo, frameUrl, shared }) {
  const diffs = new Map();
  let confirming = null;

  function render(container, { screen, proposals, version, compareWith, onOpen, onCompare, onRestore }) {
    const rows = timeline(screen, proposals);
    container.innerHTML = `<div class="head"><b>${t("History")}</b><span class="tag plain">${t(rows.length === 1 ? "{n} version" : "{n} versions", { n: rows.length })}</span></div>
      <p class="hint">${t("Click a version to see it. Compare two, or restore an old one as a new version.")}</p>
      <div class="dv-scroll hv-list">${rows
        .map((row) => {
          const viewing = row.v === version;
          const comparing = row.v === compareWith;
          const tags = [
            row.official ? `<span class="tag live"><i class="dot live"></i>${t("Official")}</span>` : "",
            row.latest && !row.official ? `<span class="tag plain">${t("Latest")}</span>` : "",
            viewing ? `<span class="tag prop">${t("Viewing")}</span>` : "",
            comparing ? `<span class="tag agent">${t("Comparing")}</span>` : "",
          ].join("");
          const proposal = row.proposal ? `${escapeHtml(row.proposal.title)}${row.proposal.label ? ` · ${row.proposal.label}` : ""}` : "";
          const actions = viewing
            ? ""
            : confirming === row.v
              ? `<div class="hv-confirm"><span>${t("Becomes v{v} in a new proposal. The official one does not change.", { v: screen.versions.at(-1).v + 1 })}</span><div class="row"><button type="button" class="btn sm" data-action="cancel">${t("Cancel")}</button><button type="button" class="btn sm primary" data-action="restore-yes">${t("Restore")}</button></div></div>`
              : `<div class="hv-actions"><button type="button" class="btn sm${comparing ? " on" : ""}" data-action="compare" title="${t("Compare with v{v}", { v: version })}">${comparing ? t("Comparing") : t("Compare")}</button>${
                  shared() || row.latest ? "" : `<button type="button" class="btn sm" data-action="restore">${t("Restore")}</button>`
                }</div>`;
          return `<div class="hv-row${viewing ? " on" : ""}${comparing ? " cmp" : ""}" data-v="${row.v}" role="button" tabindex="0">
            <span class="hv-rail"><i class="hv-dot${row.official ? " live" : ""}"></i></span>
            <div class="hv-thumb"><img src="${base}/api/screens/${escapeHtml(screen.id)}/v${row.v}.png" alt="" loading="lazy" onerror="this.remove()"></div>
            <div class="hv-info">
              <div class="hv-line"><b>v${row.v}</b>${tags}</div>
              <div class="muted hv-meta">${escapeHtml(row.by)} · ${escapeHtml(timeAgo(row.at))}${row.restoredFrom ? ` · ${t("back from v{v}", { v: row.restoredFrom })}` : ""}</div>
              ${proposal ? `<div class="muted hv-prop" title="${proposal}">${proposal}</div>` : ""}
              ${actions}
            </div>
          </div>`;
        })
        .join("")}</div>`;
    container.querySelectorAll(".hv-row").forEach((row) => {
      const v = Number(row.dataset.v);
      const open = (event) => {
        if (event.target.closest("button")) return;
        confirming = null;
        onOpen(v);
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => event.key === "Enter" && open(event));
      row.querySelector('[data-action="compare"]')?.addEventListener("click", () => onCompare(v === compareWith ? null : v));
      row.querySelector('[data-action="restore"]')?.addEventListener("click", () => {
        confirming = v;
        render(container, { screen, proposals, version, compareWith, onOpen, onCompare, onRestore });
      });
      row.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
        confirming = null;
        render(container, { screen, proposals, version, compareWith, onOpen, onCompare, onRestore });
      });
      row.querySelector('[data-action="restore-yes"]')?.addEventListener("click", async (event) => {
        event.target.disabled = true;
        confirming = null;
        await onRestore(v);
      });
    });
  }

  async function diffImage(screen, before, after) {
    const key = `${screen.id}/${before}/${after}`;
    if (diffs.has(key)) return diffs.get(key);
    const job = (async () => {
      const [a, b] = await Promise.all([loadImage(`${base}/api/screens/${screen.id}/v${before}.png`), loadImage(`${base}/api/screens/${screen.id}/v${after}.png`)]);
      if (!a || !b) return null;
      const width = Math.max(a.width, b.width);
      const height = Math.max(a.height, b.height);
      const pa = pixels(a, width, height);
      const pb = pixels(b, width, height);
      const regions = diffRegions(pa, pb, width, height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.putImageData(new ImageData(paintDiff(pb, regions.changed, width, height), width, height), 0, 0);
      context.strokeStyle = "#F24822";
      context.lineWidth = 2;
      for (const box of regions.boxes) context.strokeRect(box.x - 3, box.y - 3, box.w + 6, box.h + 6);
      return { url: canvas.toDataURL("image/png"), width, height, boxes: regions.boxes };
    })();
    diffs.set(key, job);
    job.then((result) => result || diffs.delete(key));
    return job;
  }

  function renderCompare(stage, { screen, entry, before, overlay, fit, sideFit }) {
    const mode = overlay.compareMode ?? "slide";
    const beforeLabel = before.official ? `<i class="dot live"></i> ${t("Official v{v}", { v: before.version })}` : `v${before.version}`;
    const toolbar = `<div class="hv-toolbar"><span class="seg">${MODES.map(([id, label]) => `<button type="button" data-mode="${id}" class="${mode === id ? "on" : ""}">${t(label)}</button>`).join("")}</span><span class="hv-pair mono">${beforeLabel} → v${overlay.version}</span></div>`;
    const sized = (src, width, height, scale, extra = "") =>
      `<iframe src="${src}" style="width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:0 0;${extra}"></iframe>`;
    const scale = fit;
    const width = Math.round(entry.width * scale);
    const height = Math.round(entry.height * scale);
    if (mode === "side") {
      const beforeEntry = screen.versions.find((item) => item.v === before.version) ?? entry;
      const s = sideFit;
      stage.innerHTML = `${toolbar}<div class="hv-side">
        <figure><figcaption>${beforeLabel}</figcaption><div class="ov-frame" style="width:${Math.round(beforeEntry.width * s)}px;height:${Math.round(beforeEntry.height * s)}px">${sized(frameUrl(screen.id, before.version), beforeEntry.width, beforeEntry.height, s, "position:absolute;left:0;top:0")}</div></figure>
        <figure><figcaption>v${overlay.version}</figcaption><div class="ov-frame" style="width:${Math.round(entry.width * s)}px;height:${Math.round(entry.height * s)}px">${sized(frameUrl(screen.id, overlay.version), entry.width, entry.height, s, "position:absolute;left:0;top:0")}</div></figure>
      </div>`;
    } else if (mode === "diff") {
      stage.innerHTML = `${toolbar}<div class="ov-frame hv-diff" style="width:${width}px;height:${height}px"><p class="hint hv-wait">${t("Comparing the pictures…")}</p></div><p class="hv-legend" hidden></p>`;
      diffImage(screen, before.version, overlay.version).then((result) => {
        const frame = stage.querySelector(".hv-diff");
        const legend = stage.querySelector(".hv-legend");
        if (!frame) return;
        if (!result) {
          frame.innerHTML = `<p class="hint hv-wait">${t("One of the versions has no picture yet. Use Slide or Side by side.")}</p>`;
          return;
        }
        const s = (entry.width * scale) / result.width;
        frame.style.height = `${Math.round(result.height * s)}px`;
        frame.innerHTML = `<img src="${result.url}" alt="${t("Difference between the versions")}" style="width:100%;height:100%;display:block">`;
        legend.hidden = false;
        legend.innerHTML = result.boxes.length
          ? `<i class="hv-key"></i>${t(result.boxes.length === 1 ? "{n} area changed from v{from} to v{to}" : "{n} areas changed from v{from} to v{to}", { n: result.boxes.length, from: before.version, to: overlay.version })}`
          : t("No visible difference between the two versions.");
      });
    } else {
      stage.innerHTML = `${toolbar}<div class="ov-frame compare" style="width:${width}px;height:${height}px;--split:${overlay.split}%">
        <div class="layer">${sized(frameUrl(screen.id, before.version), entry.width, entry.height, scale)}</div>
        <div class="layer after">${sized(frameUrl(screen.id, overlay.version), entry.width, entry.height, scale)}</div>
        <div class="divider"></div><div class="knob">⇆</div>
        <div class="catch"></div>
        <span class="lab l">${beforeLabel}</span>
        <span class="lab r">v${overlay.version}</span>
      </div>`;
      const frame = stage.querySelector(".ov-frame");
      const catcher = stage.querySelector(".catch");
      const move = (event) => {
        const box = frame.getBoundingClientRect();
        overlay.split = Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100));
        frame.style.setProperty("--split", `${overlay.split}%`);
      };
      catcher.addEventListener("pointerdown", (event) => {
        catcher.setPointerCapture(event.pointerId);
        move(event);
        catcher.addEventListener("pointermove", move);
        catcher.addEventListener("pointerup", () => catcher.removeEventListener("pointermove", move), { once: true });
      });
    }
    return stage.querySelectorAll("[data-mode]");
  }

  return { render, renderCompare };
}
