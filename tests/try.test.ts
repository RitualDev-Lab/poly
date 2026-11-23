import assert from "node:assert/strict";
import test from "node:test";
import { commandExists } from "../src/sandbox/try.js";

test("Ephemeral Try - commandExists detection", () => {
  // node is guaranteed to exist in the test environment
  assert.equal(commandExists("node"), true);
  // completely random non-existent binary should return false
  assert.equal(commandExists("random_non_existent_binary_xyz_123"), false);
});
