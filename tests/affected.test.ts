import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import {
  GLOBAL_TRIGGER_PATTERNS,
  buildWorkspaceDependencyGraph,
  getGitChangedFiles,
  resolveAffectedMembers,
} from "../src/workspace/affected.js";
import type { ResolvedMember } from "../src/workspace/config.js";
import { WorkspaceRunner } from "../src/workspace/runner.js";

describe("Affected-Only Execution & Monorepo Graph", () => {
  test("GLOBAL_TRIGGER_PATTERNS contains monorepo critical configs", () => {
    assert.ok(GLOBAL_TRIGGER_PATTERNS.includes("poly.toml"));
    assert.ok(GLOBAL_TRIGGER_PATTERNS.includes("package.json"));
    assert.ok(GLOBAL_TRIGGER_PATTERNS.includes("poly.lock"));
    assert.ok(GLOBAL_TRIGGER_PATTERNS.includes(".github/"));
  });

  test("getGitChangedFiles returns file paths without throwing", () => {
    const files = getGitChangedFiles(process.cwd());
    assert.ok(Array.isArray(files));
    // Verify all paths use forward slashes
    for (const f of files) {
      assert.ok(!f.includes("\\"), `Path ${f} should use forward slashes`);
    }
  });

  test("detects directly modified workspace member", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-affected-test-"));
    try {
      // Create poly.toml with 2 members
      fs.writeFileSync(
        path.join(tempDir, "poly.toml"),
        `
[workspace]
members = ["apps/web", "services/api"]
`,
      );

      // Create member directories with package.json
      fs.mkdirSync(path.join(tempDir, "apps", "web"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "apps", "web", "package.json"),
        JSON.stringify({ name: "@acme/web", version: "1.0.0" }),
      );

      fs.mkdirSync(path.join(tempDir, "services", "api"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "services", "api", "package.json"),
        JSON.stringify({ name: "@acme/api", version: "1.0.0" }),
      );

      // Only web modified
      const res = resolveAffectedMembers(tempDir, {
        changedFiles: ["apps/web/src/App.tsx"],
      });

      assert.strictEqual(res.isAllAffected, false);
      assert.strictEqual(res.affectedMembers.length, 1);
      assert.strictEqual(res.affectedMembers[0].relativeDir, "apps/web");
      assert.ok(res.affectedReasons.has("apps/web"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("triggers all members when root poly.toml or package.json changes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-affected-root-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "poly.toml"),
        `
[workspace]
members = ["packages/auth", "packages/core"]
`,
      );

      fs.mkdirSync(path.join(tempDir, "packages", "auth"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "packages", "auth", "package.json"),
        JSON.stringify({ name: "@acme/auth", version: "1.0.0" }),
      );

      fs.mkdirSync(path.join(tempDir, "packages", "core"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "packages", "core", "package.json"),
        JSON.stringify({ name: "@acme/core", version: "1.0.0" }),
      );

      // Root poly.toml modified
      const res = resolveAffectedMembers(tempDir, {
        changedFiles: ["poly.toml"],
      });

      assert.strictEqual(res.isAllAffected, true);
      assert.strictEqual(res.affectedMembers.length, 2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("propagates changes downstream to dependent packages in dependency graph", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-affected-graph-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "poly.toml"),
        `
[workspace]
members = ["packages/ui", "apps/web", "services/backend"]
`,
      );

      // packages/ui
      fs.mkdirSync(path.join(tempDir, "packages", "ui"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "packages", "ui", "package.json"),
        JSON.stringify({ name: "@acme/ui", version: "1.0.0" }),
      );

      // apps/web depends on @acme/ui
      fs.mkdirSync(path.join(tempDir, "apps", "web"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "apps", "web", "package.json"),
        JSON.stringify({
          name: "@acme/web",
          version: "1.0.0",
          dependencies: {
            "@acme/ui": "workspace:*",
          },
        }),
      );

      // services/backend is independent
      fs.mkdirSync(path.join(tempDir, "services", "backend"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "services", "backend", "package.json"),
        JSON.stringify({ name: "@acme/backend", version: "1.0.0" }),
      );

      // Verify dependency graph
      const members: ResolvedMember[] = [
        {
          relativeDir: "packages/ui",
          absoluteDir: path.join(tempDir, "packages", "ui"),
          context: { ecosystem: "npm", manifestFile: "package.json", distance: 0 },
        },
        {
          relativeDir: "apps/web",
          absoluteDir: path.join(tempDir, "apps", "web"),
          context: { ecosystem: "npm", manifestFile: "package.json", distance: 0 },
        },
        {
          relativeDir: "services/backend",
          absoluteDir: path.join(tempDir, "services", "backend"),
          context: { ecosystem: "npm", manifestFile: "package.json", distance: 0 },
        },
      ];
      const graph = buildWorkspaceDependencyGraph(tempDir, members);
      assert.ok(graph.get("apps/web")?.has("packages/ui"));
      assert.strictEqual(graph.get("services/backend")?.size, 0);

      // Modifying ui should affect BOTH ui and web, but NOT backend
      const res = resolveAffectedMembers(tempDir, {
        changedFiles: ["packages/ui/src/button.tsx"],
      });

      assert.strictEqual(res.isAllAffected, false);
      const affectedDirs = res.affectedMembers.map((m) => m.relativeDir).sort();
      assert.deepStrictEqual(affectedDirs, ["apps/web", "packages/ui"]);
      assert.ok(!affectedDirs.includes("services/backend"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("WorkspaceRunner returns empty array when 0 members affected", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-affected-runner-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "poly.toml"),
        `
[workspace]
members = ["packages/a"]
`,
      );

      fs.mkdirSync(path.join(tempDir, "packages", "a"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "packages", "a", "package.json"),
        JSON.stringify({ name: "pkg-a" }),
      );

      const runner = new WorkspaceRunner();
      // Changed file in irrelevant folder
      const results = await runner.runTask(tempDir, "test", {
        affected: true,
        changedFiles: ["docs/readme.md"],
        silent: true,
      });

      assert.strictEqual(results.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
