import { test } from "node:test";
import assert from "node:assert/strict";
import { annotationPreview, isAnnotation, splitAnnotations } from "../viewer/annotations.js";

test("annotations are agent notes, not agent replies", () => {
  assert.equal(isAnnotation({ kind: "annotation", replyTo: null }), true);
  assert.equal(isAnnotation({ kind: "agent", replyTo: null }), true);
  assert.equal(isAnnotation({ kind: "agent", replyTo: "abc" }), false);
  assert.equal(isAnnotation({ kind: "human", replyTo: null }), false);
});

test("splitAnnotations keeps replies with the note they answer", () => {
  const entries = [
    { id: "a", kind: "annotation", replyTo: null },
    { id: "b", kind: "human", replyTo: null },
    { id: "c", kind: "human", replyTo: "a" },
    { id: "d", kind: "agent", replyTo: "b" },
  ];
  const { annotations, comments } = splitAnnotations(entries);
  assert.deepEqual(annotations.map((entry) => entry.id), ["a", "c"]);
  assert.deepEqual(comments.map((entry) => entry.id), ["b", "d"]);
});

test("annotationPreview shows the first line without markup", () => {
  assert.equal(annotationPreview("\n**Option A**: the QR\nmore"), "Option A: the QR");
  assert.equal(annotationPreview("x".repeat(60), 10), `${"x".repeat(9)}…`);
});
