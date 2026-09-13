import assert from "node:assert/strict";
import test from "node:test";

import { greeting } from "@sandbox/shared";

test("uses the shared package", () => {
  assert.equal(greeting("monorepo"), "Hello, monorepo!");
});
