import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WorkspaceDispatcher,
  generateCompositeLockfile,
  parseSimplePolyToml,
  readCompositeLockfile,
  resolveWorkspaceMembers,
  verifyCompositeLockfile,
  writeCompositeLockfile,
} from "../src/workspace/index.js";

test("Workspace Config - Parses poly.toml correctly", () => {
  const toml = `
    name = "enterprise-suite"
    version = "1.0.0"

    [workspace]
    members = ["apps/*", "services/backend", "crates/core"]

    [engines]
    python = "uv"
    node = "pnpm"
    concurrency = 8

    [tasks]
    dev = { parallel = ["apps/web:dev", "services/backend:dev"] }
    test = "npm test"
  `;

  const config = parseSimplePolyToml(toml);
  assert.equal(config.name, "enterprise-suite");
  assert.equal(config.version, "1.0.0");
  assert.deepEqual(config.members, ["apps/*", "services/backend", "crates/core"]);
  assert.equal(config.engines?.python, "uv");
  assert.equal(config.engines?.node, "pnpm");
  assert.equal(config.engines?.concurrency, 8);
  assert.ok(config.tasks?.dev);
});

test("Workspace Discovery - Expands glob members into polyglot components", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-ws-glob-"));
  try {
    // Create apps/web (Node)
    const webDir = path.join(tmpDir, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "package.json"),
      '{"name":"web","dependencies":{"react":"18.3.1"}}',
    );
    fs.writeFileSync(path.join(webDir, "pnpm-lock.yaml"), "lock-content-1");

    // Create apps/docs (Node)
    const docsDir = path.join(tmpDir, "apps", "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "package.json"), '{"name":"docs"}');

    // Create services/ai (Python)
    const aiDir = path.join(tmpDir, "services", "ai");
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(
      path.join(aiDir, "pyproject.toml"),
      'dependencies = [\n  "fastapi>=0.110.0",\n]',
    );
    fs.writeFileSync(path.join(aiDir, "uv.lock"), "uv-lock-content");

    // Create poly.toml
    fs.writeFileSync(
      path.join(tmpDir, "poly.toml"),
      `
      [workspace]
      members = ["apps/*", "services/ai"]
    `,
    );

    const members = resolveWorkspaceMembers(tmpDir);
    assert.equal(members.length, 3);

    const paths = members.map((m) => m.relativeDir).sort();
    assert.deepEqual(paths, ["apps/docs", "apps/web", "services/ai"]);

    const web = members.find((m) => m.relativeDir === "apps/web");
    assert.ok(web);
    assert.equal(web.context.ecosystem, "npm");
    assert.equal(web.context.lockfile, "pnpm-lock.yaml");

    const ai = members.find((m) => m.relativeDir === "services/ai");
    assert.ok(ai);
    assert.equal(ai.context.ecosystem, "pypi");
    assert.equal(ai.context.lockfile, "uv.lock");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Composite Lockfile - Generates, Writes, and Reads poly.lock", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-lockfile-"));
  try {
    const webDir = path.join(tmpDir, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "package.json"),
      '{"name":"web","dependencies":{"zod":"3.22.4"}}',
    );
    fs.writeFileSync(path.join(webDir, "pnpm-lock.yaml"), "mock-pnpm-lock");

    fs.writeFileSync(
      path.join(tmpDir, "poly.toml"),
      `
      [workspace]
      members = ["apps/web"]
    `,
    );

    const generated = writeCompositeLockfile(tmpDir);
    assert.equal(generated.members.length, 1);
    assert.equal(generated.members[0].path, "apps/web");
    assert.ok(generated.members[0].manifestHash.startsWith("sha256:"));
    assert.ok(generated.members[0].lockfileHash?.startsWith("sha256:"));

    assert.ok(fs.existsSync(path.join(tmpDir, "poly.lock")));

    // Read back and verify integrity
    const parsed = readCompositeLockfile(tmpDir);
    assert.ok(parsed);
    assert.equal(parsed.members.length, 1);
    assert.equal(parsed.members[0].path, "apps/web");
    assert.equal(parsed.members[0].manifestHash, generated.members[0].manifestHash);
    assert.equal(parsed.members[0].lockfileHash, generated.members[0].lockfileHash);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Drift Detection - Detects out-of-band tampering and enforces zero-drift", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-drift-"));
  try {
    const webDir = path.join(tmpDir, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    const pkgJsonPath = path.join(webDir, "package.json");
    fs.writeFileSync(pkgJsonPath, '{"name":"web","dependencies":{"react":"18.0.0"}}');
    fs.writeFileSync(path.join(webDir, "package-lock.json"), "original-lock");

    fs.writeFileSync(
      path.join(tmpDir, "poly.toml"),
      `
      [workspace]
      members = ["apps/web"]
    `,
    );

    // Initial clean lockfile
    writeCompositeLockfile(tmpDir);

    const initialVerify = verifyCompositeLockfile(tmpDir);
    assert.equal(initialVerify.isDrifted, false);
    assert.equal(initialVerify.issues.length, 0);

    // 1. Tamper with manifest (add dependency)
    fs.writeFileSync(
      pkgJsonPath,
      '{"name":"web","dependencies":{"react":"18.0.0","axios":"1.0.0"}}',
    );
    const tamperedVerify = verifyCompositeLockfile(tmpDir);
    assert.equal(tamperedVerify.isDrifted, true);
    assert.equal(tamperedVerify.issues.length, 1);
    assert.equal(tamperedVerify.issues[0].file, "package.json");
    assert.ok(tamperedVerify.issues[0].reason.includes("modified out-of-band"));

    // 2. Frozen mode throws on drift
    const dispatcher = new WorkspaceDispatcher();
    assert.rejects(async () => {
      await dispatcher.syncWorkspace(tmpDir, { frozen: true });
    }, /FROZEN DRIFT ERROR/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
