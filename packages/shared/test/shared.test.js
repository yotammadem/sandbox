import assert from "node:assert/strict";
import test from "node:test";

import { greeting } from "../src/index.js";

test("builds a greeting", () => {
  assert.equal(greeting("world"), "Hello, world!");
});
