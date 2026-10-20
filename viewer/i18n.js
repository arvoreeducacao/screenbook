import pt from "./i18n-pt.js";

const DICTIONARIES = { "pt-BR": pt };
const ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"];

export function pickLang(languages) {
  const list = Array.isArray(languages) ? languages : String(languages ?? "").split(",").map((part) => part.split(";")[0].trim());
  const first = list.find(Boolean) ?? "";
  return first.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

export const lang = typeof navigator === "undefined" ? "en" : pickLang(navigator.languages?.length ? navigator.languages : [navigator.language]);

export function translate(language, text, vars) {
  const dictionary = DICTIONARIES[language];
  const found = (dictionary && dictionary[text]) || text;
  return vars ? found.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : found;
}

export function t(text, vars) {
  return translate(lang, text, vars);
}

export function translateDom(root, language = lang) {
  if (!DICTIONARIES[language]) return;
  const doc = root.ownerDocument ?? root;
  const walker = doc.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (text && DICTIONARIES[language][text]) node.nodeValue = node.nodeValue.replace(text, DICTIONARIES[language][text]);
  }
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value && DICTIONARIES[language][value]) element.setAttribute(attribute, DICTIONARIES[language][value]);
    }
  }
}
