import { t } from "./i18n.js";
import { escapeHtml } from "./menu.js";

export const LOCAL_LOGIN = "local";
const HANDLE = /(^|[^\w@])@([a-z][\w-]*)/gi;
const QUERY = /(?:^|[^\w@])@([\p{L}\p{N}_.-]*)$/u;
const PICKER_LIMIT = 8;
const PICKER_ID = "mention-picker";

export function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
}

export function handlesIn(text) {
  return [...new Set([...String(text ?? "").matchAll(HANDLE)].map((match) => match[2].toLowerCase()))];
}

export function replaceHandles(html, render) {
  return String(html).replace(HANDLE, (match, before, handle) => `${before}${render(handle)}`);
}

export function peopleMap(list) {
  const people = new Map();
  for (const person of Array.isArray(list) ? list : []) {
    if (typeof person?.login !== "string" || !person.login) continue;
    people.set(person.login.toLowerCase(), { login: person.login, name: String(person.name || person.login), avatar: typeof person.avatar === "string" ? person.avatar : null });
  }
  return people;
}

export function chatHandlesIn(text, people = new Map()) {
  return handlesIn(text).filter((handle) => !people.has(handle));
}

export function tagsLogin(text, login) {
  return Boolean(login) && handlesIn(text).includes(String(login).toLowerCase());
}

export function personScore(person, query) {
  const wanted = fold(query);
  if (!wanted) return 1;
  const login = fold(person.login);
  const name = fold(person.name);
  if (login.startsWith(wanted) || name.startsWith(wanted)) return 4;
  if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(wanted))) return 3;
  if (login.includes(wanted)) return 2;
  return 0;
}

export function matchPeople(people, query, limit = PICKER_LIMIT) {
  return [...people.values()]
    .map((person) => ({ person, score: personScore(person, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name, undefined, { sensitivity: "base" }))
    .slice(0, limit)
    .map((entry) => entry.person);
}

export function matchChats(chats, query) {
  const wanted = fold(query);
  return chats.filter((handle) => fold(handle).includes(wanted));
}

export function pickerOptions(people, chats, query) {
  return [...matchPeople(people, query).map((person) => ({ kind: "person", handle: person.login, person })), ...matchChats(chats, query).map((handle) => ({ kind: "chat", handle }))];
}

export function mentionQueryAt(value, caret) {
  const before = String(value).slice(0, caret);
  const match = before.match(QUERY);
  if (!match) return null;
  return { query: match[1], from: before.length - match[1].length - 1 };
}

export function insertMention(value, from, caret, handle) {
  const insert = `@${handle} `;
  return { value: `${value.slice(0, from)}${insert}${value.slice(caret).replace(/^ /, "")}`, caret: from + insert.length };
}

const brokenPhotos = new Set();

export function photoOf(login, people) {
  if (typeof login !== "string" || !login || login === LOCAL_LOGIN) return null;
  const url = people?.get(login.toLowerCase())?.avatar || `https://github.com/${encodeURIComponent(login)}.png?size=64`;
  return brokenPhotos.has(url) ? null : url;
}

export function photoHtml(url, fallback = "") {
  return `<img class="photo" src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${escapeHtml(fallback)}">`;
}

export function watchPhotos(root) {
  root.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (image?.tagName !== "IMG" || !image.classList.contains("photo")) return;
      brokenPhotos.add(image.getAttribute("src"));
      image.closest(".has-photo")?.classList.remove("has-photo");
      image.replaceWith(image.dataset.fallback ?? "");
    },
    true,
  );
}

let open = null;

function pickerElement() {
  const existing = document.getElementById(PICKER_ID);
  if (existing) return existing;
  const element = document.createElement("div");
  element.className = "mention-picker";
  element.id = PICKER_ID;
  element.setAttribute("role", "listbox");
  element.setAttribute("aria-label", t("Tag someone"));
  element.hidden = true;
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (option && open) choose(Number(option.dataset.index));
  });
  document.body.appendChild(element);
  return element;
}

export function closeMentionPicker() {
  if (!open) return;
  open.field.setAttribute("aria-expanded", "false");
  open.field.removeAttribute("aria-activedescendant");
  open = null;
  pickerElement().hidden = true;
}

function optionHtml(option, index) {
  const on = index === open.active;
  const head = `<button type="button" tabindex="-1" class="mp-option${on ? " on" : ""}" id="${PICKER_ID}-${index}" role="option" aria-selected="${on}" data-index="${index}">`;
  if (option.kind === "chat") return `${head}<span class="avatar agent">✦</span><span class="mp-name">${escapeHtml(option.handle)}</span><span class="mp-hint">${escapeHtml(t("asks for the change"))}</span></button>`;
  const { person } = option;
  const url = photoOf(person.login, open.source.people());
  const photo = url ? `<span class="avatar has-photo">${photoHtml(url, initials(person.name))}</span>` : `<span class="avatar">${escapeHtml(initials(person.name))}</span>`;
  return `${head}${photo}<span class="mp-name">${escapeHtml(person.name)}</span><span class="mp-login">${escapeHtml(person.login)}</span></button>`;
}

function placePicker(element, field) {
  const box = field.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const below = box.bottom + 4;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 4) : below;
  element.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
  element.style.top = `${top}px`;
}

function drawPicker() {
  const element = pickerElement();
  const group = (kind, label) => {
    const rows = open.options.map((option, index) => (option.kind === kind ? optionHtml(option, index) : "")).join("");
    return rows ? `<div class="mp-group">${escapeHtml(label)}</div>${rows}` : "";
  };
  element.innerHTML = `${group("person", t("People"))}${group("chat", t("AI chat"))}<div class="mp-foot">${escapeHtml(t("↑ ↓ choose · Enter tags · Esc closes"))}</div>`;
  element.hidden = false;
  open.field.setAttribute("aria-expanded", "true");
  open.field.setAttribute("aria-activedescendant", `${PICKER_ID}-${open.active}`);
  placePicker(element, open.field);
}

function updatePicker(field, source) {
  const found = field.isConnected ? mentionQueryAt(field.value, field.selectionStart ?? field.value.length) : null;
  const options = found ? pickerOptions(source.people(), source.chats(), found.query) : [];
  if (!options.length) {
    if (open?.field === field) closeMentionPicker();
    return;
  }
  if (open && open.field !== field) closeMentionPicker();
  const kept = open?.field === field && open.query === found.query ? Math.min(open.active, options.length - 1) : 0;
  open = { field, source, options, from: found.from, query: found.query, active: kept };
  drawPicker();
}

function choose(index) {
  const { field, options, from } = open;
  const option = options[index];
  if (!option) return;
  const next = insertMention(field.value, from, field.selectionStart ?? field.value.length, option.handle);
  closeMentionPicker();
  field.value = next.value;
  field.focus();
  field.setSelectionRange(next.caret, next.caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const STEPS = { ArrowDown: 1, ArrowUp: -1 };

export function attachMentionPicker(field, source) {
  if (!field) return;
  pickerElement();
  field.setAttribute("aria-autocomplete", "list");
  field.setAttribute("aria-controls", PICKER_ID);
  field.setAttribute("aria-expanded", "false");
  field.addEventListener("input", () => updatePicker(field, source));
  field.addEventListener("click", () => updatePicker(field, source));
  field.addEventListener("blur", () => open?.field === field && closeMentionPicker());
  field.addEventListener(
    "keydown",
    (event) => {
      if (open?.field !== field || event.isComposing) return;
      if (event.key in STEPS) {
        open.active = (open.active + STEPS[event.key] + open.options.length) % open.options.length;
        drawPicker();
      } else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") choose(open.active);
      else if (event.key === "Escape") closeMentionPicker();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
