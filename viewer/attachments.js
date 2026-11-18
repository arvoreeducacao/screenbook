export const IMAGES_PER_COMMENT = 4;
export const IMAGE_BYTES = 5_000_000;
export const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
export const ATTACHMENT_FILE = /^[\w-]+\.(png|jpg|webp|gif)$/;

const FITTED_SIDE = 2000;
const FITTED_BYTES = 4_000_000;

function startsWith(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function imageExtensionOf(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  return null;
}

export function attachmentPath(screen, file) {
  return `attachments/${screen}/${file}`;
}

function encoded(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function fitImage(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.max(bitmap.width, bitmap.height);
  if (side <= FITTED_SIDE && file.size <= FITTED_BYTES && Object.values(IMAGE_TYPES).includes(file.type)) {
    bitmap.close();
    return file;
  }
  const ratio = Math.min(1, FITTED_SIDE / side);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = await encoded(canvas, "image/webp", 0.9);
  return webp?.type === "image/webp" ? webp : encoded(canvas, "image/jpeg", 0.9);
}

export function base64Of(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function imagesFrom(transfer) {
  return [...(transfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
}
