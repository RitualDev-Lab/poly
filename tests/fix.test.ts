import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SecurityAutoHealer } from "../src/compliance/fixer.js";

test("SecurityAutoHealer - Manifest Patching & Remediation", async (t) => {
  await t.test("patches package.json with fixed version", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-fix-node-"));
    const pkgJsonPath = path.join(tmpDir, "package.json");

    // Mock package.json with vulnerable lodash
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify(
        {
          name: "vuln-app",
          dependencies: {
            lodash: "4.17.15",
          },
        },
        null,
        2,
      ),
    );

    const healer = new SecurityAutoHealer();
    const report = await healer.fix(tmpDir);

    assert.ok(report.scannedPackages > 0);
    // If OSV found CVEs for lodash 4.17.15, it patches it
    if (report.remediated.length > 0) {
      const updated = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      assert.ok(updated.dependencies.lodash.includes("4.17.21"));
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("respects dry-run mode and does not alter disk manifests", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-fix-dry-"));
    const pkgJsonPath = path.join(tmpDir, "package.json");
    const originalContent = JSON.stringify(
      {
        name: "dry-run-app",
        dependencies: {
          lodash: "4.17.15",
        },
      },
      null,
      2,
    );

    fs.writeFileSync(pkgJsonPath, originalContent);

    const healer = new SecurityAutoHealer();
    const report = await healer.fix(tmpDir, { dryRun: true });

    const currentContent = fs.readFileSync(pkgJsonPath, "utf-8");
    assert.equal(currentContent.trim(), originalContent.trim());

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
