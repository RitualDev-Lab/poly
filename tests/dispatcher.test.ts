import assert from "node:assert/strict";
import test from "node:test";
import { PolyDispatcher } from "../src/dispatcher/executor.js";

test("Dispatcher - which command returns engine metadata", () => {
  const dispatcher = new PolyDispatcher();
  const nodeInfo = dispatcher.which("npm");
  assert.equal(nodeInfo.engine, "node");
  assert.ok(["pnpm", "bun", "yarn", "npm"].includes(nodeInfo.effectiveCli));

  const pyInfo = dispatcher.which("pypi");
  assert.equal(pyInfo.engine, "python");
  assert.ok(["uv", "poetry", "pip"].includes(pyInfo.effectiveCli));

  const rustInfo = dispatcher.which("cargo");
  assert.equal(rustInfo.engine, "rust");
  assert.equal(rustInfo.effectiveCli, "rust");
});

test("Dispatcher - Error when resolving package without manifest or prefix", async () => {
  const dispatcher = new PolyDispatcher();
  // Using an empty non-existent directory
  await assert.rejects(async () => {
    await dispatcher.add("requests", { cwd: "C:\\NonExistentPath_Test_123" });
  }, /Could not determine ecosystem for 'requests'/);
});
