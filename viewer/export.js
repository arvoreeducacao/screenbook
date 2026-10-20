export function fileName(screenId, version, suffix = "", extension = "png") {
  const clean = (text) => String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${[clean(screenId), `v${version}`, clean(suffix)].filter(Boolean).join("-")}.${extension}`;
}

export function cropBox(box, size) {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const right = Math.min(size.width, Math.ceil(box.x + box.w));
  const bottom = Math.min(size.height, Math.ceil(box.y + box.h));
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function fetchBlob(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.blob();
}

export async function loadImage(url) {
  const blob = await fetchBlob(url);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob).catch(() => null);
  return bitmap;
}

export async function cropPng(url, box) {
  const image = await loadImage(url);
  if (!image) return null;
  const area = cropBox(box, image);
  if (!area) return null;
  const canvas = document.createElement("canvas");
  canvas.width = area.w;
  canvas.height = area.h;
  canvas.getContext("2d").drawImage(image, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  }
}
