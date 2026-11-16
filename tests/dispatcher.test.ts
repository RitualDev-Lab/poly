import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-empty-isolated-"));
  // Create an empty .git folder to bound the upward traversal
  fs.mkdirSync(path.join(emptyDir, ".git"));

  try {
    await assert.rejects(async () => {
      await dispatcher.add("requests", { cwd: emptyDir });
    }, /Could not determine ecosystem for 'requests'/);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
