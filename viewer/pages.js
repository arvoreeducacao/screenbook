import { t } from "./i18n.js";

export const FIRST_PAGE = { id: "telas", name: "Screens" };

export const isBoard = (page) => page?.kind === "board";

export function homePage(pages) {
  return pages.find((page) => !isBoard(page)) ?? pages[0];
}

export function pagesOf(project) {
  const sectionIds = (project?.sections ?? []).map((section) => section.id);
  const known = new Set(sectionIds);
  const stored = Array.isArray(project?.pages) && project.pages.length ? project.pages : [{ ...FIRST_PAGE, sections: [] }];
  const taken = new Set();
  const pages = stored.map((page) => ({
    id: page.id,
    name: page.id === FIRST_PAGE.id && page.name === FIRST_PAGE.name ? t(FIRST_PAGE.name) : page.name,
    ...(isBoard(page) ? { kind: "board" } : {}),
    sections: isBoard(page) ? [] : (page.sections ?? []).filter((id) => known.has(id) && !taken.has(id) && taken.add(id)),
  }));
  const loose = sectionIds.filter((id) => !taken.has(id));
  const home = homePage(pages);
  if (!isBoard(home)) home.sections = [...home.sections, ...loose];
  return pages;
}

export function pageOfSection(pages, sectionId) {
  return pages.find((page) => page.sections.includes(sectionId)) ?? homePage(pages);
}

export function sectionsOnPage(pages, pageId) {
  const page = pages.find((entry) => entry.id === pageId) ?? pages[0];
  return { page, sections: new Set(page.sections), first: page === homePage(pages) && !isBoard(page) };
}

export function onPage(pages, pageId, sectionId) {
  const { sections, first } = sectionsOnPage(pages, pageId);
  return sectionId ? sections.has(sectionId) || (first && !pages.some((page) => page.sections.includes(sectionId))) : first;
}
