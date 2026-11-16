import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectContexts, resolvePrimaryContext } from "../src/detector/tree-walker.js";

test("Detector - Identifies Node.js project manifests and lockfiles", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-test-node-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");

    const contexts = detectContexts(tmpDir);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].ecosystem, "npm");
    assert.equal(contexts[0].manifestFile, "package.json");
    assert.equal(contexts[0].lockfile, "pnpm-lock.yaml");
    assert.equal(contexts[0].distance, 0);

    const { primary, conflicts } = resolvePrimaryContext(tmpDir);
    assert.ok(primary);
    assert.equal(primary.ecosystem, "npm");
    assert.equal(conflicts.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Detector - Identifies Python project with uv lockfile", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-test-python-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmpDir, "uv.lock"), "");

    const contexts = detectContexts(tmpDir);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].ecosystem, "pypi");
    assert.equal(contexts[0].lockfile, "uv.lock");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Detector - Upward traversal discovers parent manifest", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-test-subfolder-"));
  const subDir = path.join(tmpDir, "src", "nested");
  fs.mkdirSync(subDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    fs.writeFileSync(path.join(tmpDir, "Cargo.lock"), "");

    const contexts = detectContexts(subDir);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].ecosystem, "cargo");
    assert.equal(contexts[0].distance, 2);

    const { primary } = resolvePrimaryContext(subDir);
    assert.ok(primary);
    assert.equal(primary.ecosystem, "cargo");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Detector - Detects conflicts when multiple manifests reside in CWD", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-test-conflict-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "");

    const { primary, conflicts } = resolvePrimaryContext(tmpDir);
    assert.equal(primary, undefined);
    assert.equal(conflicts.length, 2);
    const ecosystems = conflicts.map((c) => c.ecosystem).sort();
    assert.deepEqual(ecosystems, ["npm", "pypi"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
