import assert from "node:assert/strict";
import test from "node:test";

import {
  buildViewModel,
  isDateTime,
  validateArtifact,
  validateTypeDefinition,
} from "../src/core.js";

const definition = {
  kind: "safeartifact/type-definition",
  specVersion: "0.1",
  name: "test.note",
  version: "1.0.0",
  contentSchema: {
    type: "object",
    additionalProperties: false,
    required: ["message", "at"],
    properties: {
      message: { type: "string" },
      at: { type: "dateTime" },
    },
  },
  view: {
    kind: "stack",
    children: [
      { kind: "text", value: { path: "/message" } },
      { kind: "dateTime", value: { path: "/at" } },
    ],
  },
};

const artifact = {
  specVersion: "0.1",
  id: "note-1",
  type: { name: "test.note", version: "1.0.0", digest: "sha256-test" },
  title: "A note",
  createdAt: "2026-09-13T09:00:00Z",
  content: { message: "Visible message", at: "2026-09-13T09:01:02.123Z" },
};

test("dateTime accepts canonical real UTC dates", () => {
  assert.equal(isDateTime("2024-02-29T23:59:59Z"), true);
  assert.equal(isDateTime("2026-09-13T09:01:02.123456789Z"), true);
});

test("dateTime rejects invalid or non-canonical dates", () => {
  assert.equal(isDateTime("2026-02-29T09:00:00Z"), false);
  assert.equal(isDateTime("2026-09-13T09:00:00+03:00"), false);
  assert.equal(isDateTime("2026-09-13 09:00:00Z"), false);
  assert.equal(isDateTime("2026-09-13T09:00:60Z"), false);
});

test("validates a Type Definition and matching artifact", () => {
  assert.deepEqual(validateTypeDefinition(definition), []);
  assert.deepEqual(validateArtifact(artifact, definition), []);
});

test("reports schema and envelope violations", () => {
  const invalid = structuredClone(artifact);
  invalid.content.at = "tomorrow";
  invalid.content.extra = "hidden";
  const errors = validateArtifact(invalid, definition);
  assert.equal(errors.some((error) => error.path === "/content/at"), true);
  assert.equal(errors.some((error) => error.path === "/content/extra"), true);
});

test("coverage succeeds when every content string is bound", () => {
  const result = buildViewModel(artifact.content, definition.view);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missing, []);
});

test("coverage identifies text omitted by the View Definition", () => {
  const incompleteView = { kind: "text", value: { path: "/message" } };
  const result = buildViewModel(artifact.content, incompleteView);
  assert.deepEqual(result.missing, ["/content/at"]);
});

test("table bindings resolve relative to each row", () => {
  const content = { rows: [{ name: "first" }, { name: "second" }] };
  const view = {
    kind: "table",
    rows: { path: "/rows" },
    columns: [{ header: "Name", value: { path: "/name" } }],
  };
  const result = buildViewModel(content, view);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.model.rows.map((row) => row[0].value), ["first", "second"]);
});

test("time bar chart covers canonical times and preserves fixed buckets", () => {
  const content = {
    buckets: [
      { at: "2026-09-13T12:00:00Z", value: 2.5 },
      { at: "2026-09-13T12:05:00Z", value: 7.25 },
      { at: "2026-09-13T12:10:00Z", value: 4 },
    ],
  };
  const view = {
    kind: "timeBarChart",
    title: "Queue time",
    items: { path: "/buckets" },
    time: { path: "/at" },
    value: { path: "/value" },
    bucket: { size: 5, unit: "minute" },
  };
  const result = buildViewModel(content, view);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.model.points.map((point) => point.value), [2.5, 7.25, 4]);
});

test("time bar chart rejects gaps that violate its fixed bucket size", () => {
  const content = {
    buckets: [
      { at: "2026-09-13T12:00:00Z", value: 1 },
      { at: "2026-09-13T12:06:00Z", value: 2 },
    ],
  };
  const view = {
    kind: "timeBarChart",
    title: "Queue time",
    items: { path: "/buckets" },
    time: { path: "/at" },
    value: { path: "/value" },
    bucket: { size: 5, unit: "minute" },
  };
  const result = buildViewModel(content, view);
  assert.equal(result.errors.some((error) => error.message.includes("not separated by exactly 5 minute")), true);
});
