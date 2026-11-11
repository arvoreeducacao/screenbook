export const SHOT_SCALE = 2;

export function shotStampOf(shown) {
  const parts = shown ? Object.entries(shown).map(([name, v]) => `${name}.${v}`) : [];
  return [`${SHOT_SCALE}x`, ...parts].join("-");
}
