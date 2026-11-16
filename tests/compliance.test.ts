import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  type AuditReport,
  CrossStackAuditor,
  LicenseAuditor,
  SbomGenerator,
  generateSarifReport,
} from "../src/compliance/index.js";
import { writeCompositeLockfile } from "../src/workspace/lockfile.js";

test("Auditor - Queries dependencies and generates structured report", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-audit-"));
  try {
    const webDir = path.join(tmpDir, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "package.json"),
      '{"name":"web","dependencies":{"zod":"3.22.4"}}',
    );
    fs.writeFileSync(path.join(tmpDir, "poly.toml"), '[workspace]\nmembers = ["apps/web"]\n');

    writeCompositeLockfile(tmpDir);

    const auditor = new CrossStackAuditor();
    const report = await auditor.audit(tmpDir, { failOn: "HIGH" });

    assert.ok(report.scannedPackages >= 1);
    assert.equal(typeof report.durationMs, "number");
    assert.ok(Array.isArray(report.findings));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SARIF Generator - Exports valid OASIS SARIF v2.1.0 log", () => {
  const mockReport: AuditReport = {
    scannedPackages: 2,
    vulnerablePackages: 1,
    totalFindings: 1,
    durationMs: 120,
    hasFailure: true,
    findings: [
      {
        id: "GHSA-test-1234",
        packageName: "axios",
        ecosystem: "npm",
        installedVersion: "0.21.1",
        severity: "HIGH",
        summary: "Server-Side Request Forgery in axios",
        details: "Detailed explanation of SSRF",
        fixedVersion: "0.21.2",
        referenceUrl: "https://osv.dev/GHSA-test-1234",
        memberPath: "apps/web",
      },
    ],
  };

  const sarifRaw = generateSarifReport(mockReport);
  const sarif = JSON.parse(sarifRaw);

  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs.length, 1);
  assert.equal(sarif.runs[0].tool.driver.name, "poly");
  assert.equal(sarif.runs[0].results.length, 1);
  assert.equal(sarif.runs[0].results[0].ruleId, "GHSA-test-1234");
  assert.equal(sarif.runs[0].results[0].level, "error");
});

test("License Auditor - Identifies permissive and copyleft licenses", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-license-"));
  try {
    const webDir = path.join(tmpDir, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "package.json"),
      '{"name":"web","dependencies":{"react":"18.3.1"}}',
    );
    fs.writeFileSync(path.join(tmpDir, "poly.toml"), '[workspace]\nmembers = ["apps/web"]\n');

    writeCompositeLockfile(tmpDir);

    const auditor = new LicenseAuditor();
    const report = auditor.scan(tmpDir, { deny: ["AGPL-3.0", "GPL-3.0"] });

    assert.equal(report.totalPackages, 1);
    assert.equal(report.deniedCount, 0);
    assert.equal(report.isCompliant, true);
    assert.equal(report.packages[0].category, "Permissive");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SBOM Generator - Exports compliant CycloneDX v1.5 and SPDX v2.3", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-sbom-"));
  try {
    const webDir = path.join(tmpDir, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "package.json"),
      '{"name":"web","dependencies":{"zod":"3.22.4"}}',
    );
    fs.writeFileSync(path.join(tmpDir, "poly.toml"), '[workspace]\nmembers = ["apps/web"]\n');

    writeCompositeLockfile(tmpDir);

    const generator = new SbomGenerator();

    // 1. CycloneDX v1.5
    const cdxRaw = generator.generate(tmpDir, { format: "cyclonedx" });
    const cdx = JSON.parse(cdxRaw);
    assert.equal(cdx.bomFormat, "CycloneDX");
    assert.equal(cdx.specVersion, "1.5");
    assert.ok(cdx.components.length >= 1);
    assert.ok(cdx.components[0].purl.startsWith("pkg:npm/zod"));

    // 2. SPDX v2.3
    const spdxRaw = generator.generate(tmpDir, { format: "spdx" });
    const spdx = JSON.parse(spdxRaw);
    assert.equal(spdx.spdxVersion, "SPDX-2.3");
    assert.ok(spdx.packages.length >= 2); // Root + dependency
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
