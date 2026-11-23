export const SHOT_SCALE = 2;

export function shotStampOf(shown, drawnAt = null) {
  const parts = shown ? Object.entries(shown).map(([name, v]) => `${name}.${v}`) : [];
  const drawn = Date.parse(drawnAt ?? "");
  const revision = Number.isFinite(drawn) ? [drawn.toString(36)] : [];
  return [`${SHOT_SCALE}x`, ...revision, ...parts].join("-");
}
