import { test } from "node:test";
import assert from "node:assert/strict";
import { chatHandlesIn, fold, handlesIn, insertMention, matchPeople, mentionQueryAt, peopleMap, photoOf, pickerOptions, replaceHandles, tagsLogin } from "../viewer/mentions.js";

const people = peopleMap([
  { login: "marinacosta", name: "Marina Costa", avatar: "https://avatars.example/marina.png" },
  { login: "jvieira", name: "João Vieira" },
  { login: "laram", name: "Lara Mendes", avatar: null },
  { login: "Tiago-A", name: "" },
  { name: "nobody" },
]);

test("fold drops accents and case", () => {
  assert.equal(fold("João ÁRVORE"), "joao arvore");
});

test("the people map is keyed by lowercase login and fills missing names with the login", () => {
  assert.deepEqual([...people.keys()], ["marinacosta", "jvieira", "laram", "tiago-a"]);
  assert.equal(people.get("tiago-a").name, "Tiago-A");
  assert.equal(people.get("jvieira").avatar, null);
});

test("handles are found once each, lowercased, and e-mails are not handles", () => {
  assert.deepEqual(handlesIn("@Marinacosta e @claude, fala com @claude. ana@example.com"), ["marinacosta", "claude"]);
});

test("only handles that are not people ask a chat", () => {
  assert.deepEqual(chatHandlesIn("@marinacosta @claude @codex", people), ["claude", "codex"]);
  assert.deepEqual(chatHandlesIn("@marinacosta look", people), []);
  assert.deepEqual(chatHandlesIn("@claude look"), ["claude"]);
});

test("a text tags a login whatever the case", () => {
  assert.equal(tagsLogin("hey @LaraM", "laram"), true);
  assert.equal(tagsLogin("hey @lara", "laram"), false);
  assert.equal(tagsLogin("hey @laram", null), false);
});

test("people match by name word prefix and login substring, without accents", () => {
  assert.deepEqual(matchPeople(people, "joa").map((person) => person.login), ["jvieira"]);
  assert.deepEqual(matchPeople(people, "vie").map((person) => person.login), ["jvieira"]);
  assert.deepEqual(matchPeople(people, "costa").map((person) => person.login), ["marinacosta"]);
  assert.deepEqual(matchPeople(people, "ram").map((person) => person.login), ["laram"]);
  assert.deepEqual(matchPeople(people, "osta").map((person) => person.login), ["marinacosta"]);
  assert.deepEqual(matchPeople(people, "zzz"), []);
});

test("a login or full name prefix ranks above a word or substring match", () => {
  const ranked = peopleMap([
    { login: "xmar", name: "Ana Mar" },
    { login: "omarx", name: "Bruno" },
    { login: "marta", name: "Zé" },
  ]);
  assert.deepEqual(matchPeople(ranked, "mar").map((person) => person.login), ["marta", "xmar", "omarx"]);
});

test("an empty query lists people by name, then the chat", () => {
  const options = pickerOptions(people, ["claude"], "");
  assert.deepEqual(options.map((option) => option.handle), ["jvieira", "laram", "marinacosta", "Tiago-A", "claude"]);
  assert.equal(options.at(-1).kind, "chat");
  assert.deepEqual(pickerOptions(people, ["claude"], "cla").map((option) => option.handle), ["claude"]);
});

test("the query is the word after an @ right before the caret", () => {
  assert.deepEqual(mentionQueryAt("hello @mar", 10), { query: "mar", from: 6 });
  assert.deepEqual(mentionQueryAt("@", 1), { query: "", from: 0 });
  assert.deepEqual(mentionQueryAt("oi @joã", 7), { query: "joã", from: 3 });
  assert.equal(mentionQueryAt("ana@exa", 7), null);
  assert.equal(mentionQueryAt("@mar and", 8), null);
});

test("picking replaces the typed query with the login and a space", () => {
  assert.deepEqual(insertMention("hello @mar", 6, 10, "marinacosta"), { value: "hello @marinacosta ", caret: 19 });
  assert.deepEqual(insertMention("@ma look", 0, 3, "marinacosta"), { value: "@marinacosta look", caret: 13 });
});

test("handles are rewritten in place, keeping what comes before them", () => {
  assert.equal(replaceHandles("(@claude) and @bia", (handle) => `[${handle}]`), "([claude]) and [bia]");
});

test("a photo comes from the people list, then from GitHub, and never for local or missing logins", () => {
  assert.equal(photoOf("MarinaCosta", people), "https://avatars.example/marina.png");
  assert.equal(photoOf("laram", people), "https://github.com/laram.png?size=64");
  assert.equal(photoOf("local", people), null);
  assert.equal(photoOf(undefined, people), null);
});
