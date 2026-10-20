export function isAnnotation(entry) {
  return entry?.kind === "annotation" || (entry?.kind === "agent" && !entry.replyTo);
}

export function splitAnnotations(entries) {
  const roots = new Set(entries.filter(isAnnotation).map((entry) => entry.id));
  const annotations = [];
  const comments = [];
  for (const entry of entries) (roots.has(entry.id) || roots.has(entry.replyTo) ? annotations : comments).push(entry);
  return { annotations, comments };
}

export function annotationPreview(text, limit = 42) {
  const line = String(text ?? "").split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  const plain = line.replace(/\*\*(.+?)\*\*/g, "$1");
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}
