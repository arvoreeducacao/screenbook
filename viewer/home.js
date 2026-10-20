import { lang, t } from "./i18n.js";

var grid = document.getElementById("home-grid");
var cards = Array.prototype.slice.call(grid.querySelectorAll(".card"));
var search = document.getElementById("home-search");
var empty = document.getElementById("home-empty");
var title = document.getElementById("home-title");
var state = { view: "recent", sort: "updated", layout: "grid" };
var RECENT_DAYS = 30;

function load(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

state.sort = load("screenbook.home.sort", "updated");
state.layout = load("screenbook.home.layout", "grid");

function isRecent(card) {
  var at = Date.parse(card.dataset.updated);
  return at && Date.now() - at < RECENT_DAYS * 86400000;
}

function render() {
  var query = search.value.trim().toLowerCase();
  var recentCount = cards.filter(isRecent).length;
  var useRecent = state.view === "recent" && recentCount > 0;
  var sorted = cards.slice().sort(function (a, b) {
    if (state.sort === "name") return a.dataset.name.localeCompare(b.dataset.name, lang);
    return (b.dataset.updated || "").localeCompare(a.dataset.updated || "");
  });
  var shown = 0;
  sorted.forEach(function (card) {
    var visible = (!useRecent || isRecent(card)) && (!query || card.dataset.name.indexOf(query) !== -1);
    card.hidden = !visible;
    if (visible) shown++;
    grid.appendChild(card);
  });
  grid.classList.toggle("list", state.layout === "list");
  title.textContent = state.view === "recent" ? t("Recent") : t("All products");
  empty.hidden = shown > 0;
  if (!shown) empty.textContent = cards.length ? t("No product by that name.") : t("No products yet. Create the first one or ask for it in a chat.");
  document.querySelectorAll("[data-view]").forEach(function (b) { b.classList.toggle("on", b.dataset.view === state.view); });
  document.querySelectorAll("[data-sort]").forEach(function (b) { b.classList.toggle("on", b.dataset.sort === state.sort); b.setAttribute("aria-pressed", b.dataset.sort === state.sort); });
  document.querySelectorAll("[data-layout]").forEach(function (b) { b.classList.toggle("on", b.dataset.layout === state.layout); b.setAttribute("aria-pressed", b.dataset.layout === state.layout); });
}

document.querySelectorAll("[data-view]").forEach(function (b) {
  b.addEventListener("click", function () { state.view = b.dataset.view; document.body.classList.remove("side-open"); render(); });
});
document.querySelectorAll("[data-sort]").forEach(function (b) {
  b.addEventListener("click", function () { state.sort = b.dataset.sort; save("screenbook.home.sort", state.sort); render(); });
});
document.querySelectorAll("[data-layout]").forEach(function (b) {
  b.addEventListener("click", function () { state.layout = b.dataset.layout; save("screenbook.home.layout", state.layout); render(); });
});
search.addEventListener("input", render);

document.addEventListener("keydown", function (e) {
  if (e.key === "/" && document.activeElement !== search && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); }
  if (e.key === "Escape") { closePop(); document.body.classList.remove("side-open"); }
});

document.getElementById("home-menu").addEventListener("click", function (e) {
  e.stopPropagation();
  document.body.classList.toggle("side-open");
});
document.querySelector(".home-main").addEventListener("click", function () { document.body.classList.remove("side-open"); });

document.getElementById("home-theme").addEventListener("click", function () {
  var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  save("screenbook.theme", next);
});

var pop = document.getElementById("home-pop");
var nameInput = document.getElementById("home-new-name");
var error = document.getElementById("home-pop-error");
function openPop() {
  document.body.classList.remove("side-open");
  pop.hidden = false;
  error.hidden = true;
  nameInput.focus();
}
function closePop() {
  pop.hidden = true;
  nameInput.value = "";
}
document.getElementById("home-create").addEventListener("click", function (e) { e.stopPropagation(); pop.hidden ? openPop() : closePop(); });
document.getElementById("home-create-side").addEventListener("click", function (e) { e.stopPropagation(); openPop(); });
document.getElementById("home-pop-cancel").addEventListener("click", closePop);
pop.addEventListener("click", function (e) { e.stopPropagation(); });
document.addEventListener("click", function () { if (!pop.hidden) closePop(); });
pop.addEventListener("submit", async function (e) {
  e.preventDefault();
  var name = nameInput.value.trim();
  if (!name) return;
  try {
    var response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name }) });
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || t("Could not create it."));
    location.href = "/" + body.id + "/";
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

render();
