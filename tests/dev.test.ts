import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSimplePolyToml } from "../src/workspace/config.js";
import {
  DevMatrixSession,
  WorkspaceRunner,
  findMatchingMember,
  terminateProcessTree,
} from "../src/workspace/runner.js";

test("Cross-Service Dev Matrix - Configuration Parsing", async (t) => {
  await t.test("parses [scripts] table with parallel array definition", () => {
    const tomlContent = `
[workspace]
members = ["apps/*", "services/*"]

[scripts]
dev = { parallel = ["web:dev", "api:dev", "worker:dev"] }
test = { parallel = ["web:test", "api:test", "worker:test"] }
`;
    const config = parseSimplePolyToml(tomlContent);

    assert.ok(config.scripts);
    assert.ok(config.scripts.dev);
    assert.deepEqual((config.scripts.dev as { parallel: string[] }).parallel, [
      "web:dev",
      "api:dev",
      "worker:dev",
    ]);

    assert.ok(config.scripts.test);
    assert.deepEqual((config.scripts.test as { parallel: string[] }).parallel, [
      "web:test",
      "api:test",
      "worker:test",
    ]);

    // Tasks aliases scripts
    assert.deepEqual(config.tasks?.dev, config.scripts.dev);
  });
});

test("Cross-Service Dev Matrix - Member Matching", async (t) => {
  const members = [
    {
      relativeDir: "apps/web",
      absoluteDir: "/workspace/apps/web",
      context: {
        directory: "/workspace/apps/web",
        ecosystem: "npm" as const,
        manifestFile: "package.json",
        distance: 1,
      },
    },
    {
      relativeDir: "services/api",
      absoluteDir: "/workspace/services/api",
      context: {
        directory: "/workspace/services/api",
        ecosystem: "pypi" as const,
        manifestFile: "requirements.txt",
        distance: 1,
      },
    },
    {
      relativeDir: "crates/worker",
      absoluteDir: "/workspace/crates/worker",
      context: {
        directory: "/workspace/crates/worker",
        ecosystem: "cargo" as const,
        manifestFile: "Cargo.toml",
        distance: 1,
      },
    },
  ];

  await t.test("matches by exact relative directory", () => {
    const match = findMatchingMember(members, "apps/web");
    assert.equal(match?.relativeDir, "apps/web");
  });

  await t.test("matches by basename", () => {
    const matchWeb = findMatchingMember(members, "web");
    assert.equal(matchWeb?.relativeDir, "apps/web");

    const matchApi = findMatchingMember(members, "api");
    assert.equal(matchApi?.relativeDir, "services/api");

    const matchWorker = findMatchingMember(members, "worker");
    assert.equal(matchWorker?.relativeDir, "crates/worker");
  });

  await t.test("returns undefined for unknown service", () => {
    const match = findMatchingMember(members, "unknown-service");
    assert.equal(match, undefined);
  });
});

test("Cross-Service Dev Matrix - Target Resolution & Session Management", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-dev-matrix-test-"));

  // Create workspace structure
  fs.writeFileSync(
    path.join(tmpDir, "poly.toml"),
    `
[workspace]
members = ["apps/web", "services/api"]

[scripts]
dev = { parallel = ["web:dev", "api:dev"] }
`,
    "utf-8",
  );

  const webDir = path.join(tmpDir, "apps", "web");
  const apiDir = path.join(tmpDir, "services", "api");
  fs.mkdirSync(webDir, { recursive: true });
  fs.mkdirSync(apiDir, { recursive: true });

  fs.writeFileSync(
    path.join(webDir, "package.json"),
    JSON.stringify({ name: "web", scripts: { dev: "vite" } }),
    "utf-8",
  );
  fs.writeFileSync(path.join(apiDir, "requirements.txt"), "fastapi==0.115.0\n", "utf-8");

  await t.test("resolves configured dev targets from poly.toml", () => {
    const runner = new WorkspaceRunner();
    const targets = runner.resolveDevTargets(tmpDir);

    assert.equal(targets.length, 2);
    assert.equal(targets[0].label, "web");
    assert.equal(targets[0].ecosystem, "npm");
    assert.deepEqual(targets[0].args, ["run", "dev"]);

    assert.equal(targets[1].label, "api");
    assert.equal(targets[1].ecosystem, "pypi");
  });

  await t.test("DevMatrixSession registers and terminates cleanly", async () => {
    const session = new DevMatrixSession();
    assert.equal(session.getActiveProcesses().length, 0);

    // Should complete without error when no processes registered
    await session.terminateAll();
    assert.equal(session.getActiveProcesses().length, 0);
  });

  await t.test("terminateProcessTree handles non-existent PID gracefully", async () => {
    // Should resolve without rejecting
    await terminateProcessTree(999999);
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
