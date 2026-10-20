import { t } from "./i18n.js";

export function showsVersion(proposal, screen, version) {
  return version === proposal.screens[screen.id] || (Boolean(screen.official) && version === screen.official);
}

export function isClosed(proposal) {
  return Boolean(proposal) && proposal.status !== "open";
}

export function closedVersion(screen, version, proposals) {
  if (screen.official === version) return false;
  const owner = screen.versions.find((entry) => entry.v === version)?.proposal;
  return isClosed(proposals.find((proposal) => proposal.id === owner));
}

export function pinnedVersions(proposal, screens) {
  if (!proposal) return [];
  return screens
    .filter((screen) => screen.id in proposal.screens && screen.versions.some((entry) => entry.v === proposal.screens[screen.id]))
    .sort((first, second) => first.number - second.number)
    .map((screen) => ({ screenId: screen.id, version: proposal.screens[screen.id] }));
}

export function closedLabel(proposal) {
  if (proposal.status === "approved") return t("Approved");
  if (proposal.status === "archived") return t("Archived");
  return null;
}
