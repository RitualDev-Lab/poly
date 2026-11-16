import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PolyDoctor } from "../src/doctor/checker.js";

test("PolyDoctor - System & Toolchain Diagnostics", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-doctor-test-"));
  const doctor = new PolyDoctor();

  await t.test("executes complete diagnostic report", async () => {
    const report = await doctor.diagnose(tmpDir);

    assert.ok(report.checks.length >= 6);
    assert.ok(typeof report.durationMs === "number");
    assert.ok(["OK", "WARN", "FAIL"].includes(report.overallStatus));

    // Verify Node runtime check
    const nodeCheck = report.checks.find((c) => c.id === "toolchain-node");
    assert.ok(nodeCheck);
    assert.equal(nodeCheck?.status, "OK");
    assert.ok(nodeCheck?.version);

    // Verify categories are present
    const categories = new Set(report.checks.map((c) => c.category));
    assert.ok(categories.has("Toolchain"));
    assert.ok(categories.has("BuildEnvironment"));
    assert.ok(categories.has("NetworkRegistry"));
    assert.ok(categories.has("WorkspaceIntegrity"));
  });

  await t.test("detects workspace drift in doctor report", async () => {
    const driftDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-doctor-drift-"));
    // Create an invalid or drifted poly.lock
    fs.writeFileSync(
      path.join(driftDir, "poly.toml"),
      '[workspace]\nmembers = ["nonexistent/*"]\n',
    );
    fs.writeFileSync(path.join(driftDir, "poly.lock"), "version = 1\n");

    const report = await doctor.diagnose(driftDir);
    const lockCheck = report.checks.find((c) => c.id === "workspace-lock-drift");
    assert.ok(lockCheck);

    fs.rmSync(driftDir, { recursive: true, force: true });
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
