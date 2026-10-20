import { t } from "./i18n.js";

export const UNSECTIONED = { id: null, name: t("No section") };

export function baseOf(screen, byId) {
  const seen = new Set([screen.id]);
  let current = screen;
  while (current.variantOf && byId.has(current.variantOf) && !seen.has(current.variantOf)) {
    seen.add(current.variantOf);
    current = byId.get(current.variantOf);
  }
  return current;
}

export function arrange(sections, screens) {
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  const known = new Set(sections.map((section) => section.id));
  const rank = new Map();
  sections.forEach((section) => (section.screens ?? []).forEach((id, index) => rank.set(id, index)));
  const byPlace = (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.number - b.number;
  const bases = new Map();
  for (const screen of screens) {
    const base = baseOf(screen, byId);
    if (!bases.has(base.id)) bases.set(base.id, { screen: base, variants: [] });
    if (base !== screen) bases.get(base.id).variants.push(screen);
  }
  const groups = [...bases.values()].sort((a, b) => byPlace(a.screen, b.screen));
  groups.forEach((group) => group.variants.sort(byPlace));
  const all = groups.some((group) => !known.has(group.screen.section)) ? [...sections, UNSECTIONED] : sections;
  return all
    .map((section) => ({
      section,
      groups: groups.filter((group) => (section.id ? group.screen.section === section.id : !known.has(group.screen.section))),
    }))
    .filter((entry) => entry.groups.length);
}
