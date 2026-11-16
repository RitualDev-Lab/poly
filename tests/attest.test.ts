import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AttestationEngine } from "../src/compliance/attestation.js";
import { PolicyEvaluator } from "../src/compliance/policy.js";
import { writeCompositeLockfile } from "../src/workspace/lockfile.js";

test("AttestationEngine - In-Toto SLSA v1.0 & DSSE Cryptographic Signing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-attest-test-"));

  // Mock workspace
  fs.writeFileSync(path.join(tmpDir, "poly.toml"), '[workspace]\nmembers = ["apps/*"]\n');
  fs.writeFileSync(path.join(tmpDir, "poly.lock"), 'version = 1\nhash = "mockhash123"\n');

  const engine = new AttestationEngine();
  const { privateKey, publicKey } = engine.generateKeyPair();

  await t.test("generates valid in-toto SLSA Provenance v1.0 statement", () => {
    const statement = engine.generateStatement({ workspaceDir: tmpDir });

    assert.equal(statement._type, "https://in-toto.io/Statement/v1");
    assert.equal(statement.predicateType, "https://slsa.dev/provenance/v1");
    assert.ok(statement.subject.length >= 2);

    const lockSubject = statement.subject.find((s) => s.name === "poly.lock");
    assert.ok(lockSubject);
    assert.ok(lockSubject.digest.sha256);
  });

  await t.test("cryptographically signs statement into DSSE envelope", () => {
    const statement = engine.generateStatement({ workspaceDir: tmpDir });
    const envelope = engine.signStatement(statement, privateKey, "test-key-id");

    assert.equal(envelope.payloadType, "application/vnd.in-toto+json");
    assert.ok(envelope.payload.length > 50);
    assert.equal(envelope.signatures.length, 1);
    assert.equal(envelope.signatures[0].keyid, "test-key-id");
    assert.ok(envelope.signatures[0].sig.length > 20);
  });

  await t.test("verifies valid signature and subject file hashes", () => {
    const statement = engine.generateStatement({ workspaceDir: tmpDir });
    const envelope = engine.signStatement(statement, privateKey);

    const res = engine.verifyEnvelope(envelope, publicKey, tmpDir);
    assert.equal(res.valid, true);
    assert.equal(res.signatureVerified, true);
    assert.equal(res.subjectsVerified, true);
  });

  await t.test("detects file tampering on disk", () => {
    const statement = engine.generateStatement({ workspaceDir: tmpDir });
    const envelope = engine.signStatement(statement, privateKey);

    // Tamper with poly.lock on disk
    fs.writeFileSync(path.join(tmpDir, "poly.lock"), "tampered lock content");

    const res = engine.verifyEnvelope(envelope, publicKey, tmpDir);
    assert.equal(res.signatureVerified, true);
    assert.equal(res.subjectsVerified, false);
    assert.equal(res.valid, false);

    const lockRes = res.subjectResults.find((s) => s.name === "poly.lock");
    assert.ok(lockRes);
    assert.equal(lockRes.matches, false);
  });

  await t.test("rejects invalid or forged signature", () => {
    const statement = engine.generateStatement({ workspaceDir: tmpDir });
    const envelope = engine.signStatement(statement, privateKey);

    // Tamper with envelope payload
    const forgedPayload = Buffer.from(JSON.stringify({ ...statement, subject: [] })).toString(
      "base64",
    );
    const tamperedEnvelope = { ...envelope, payload: forgedPayload };

    const res = engine.verifyEnvelope(tamperedEnvelope, publicKey, tmpDir);
    assert.equal(res.signatureVerified, false);
    assert.equal(res.valid, false);
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("PolicyEvaluator - Corporate Governance & License Gates", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-policy-test-"));

  // Mock workspace with node package using GPL-3.0
  const appDir = path.join(tmpDir, "apps", "web");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({
      name: "web",
      version: "1.0.0",
      dependencies: { "gpl-pkg": "1.0.0" },
    }),
  );

  // Mock node_modules with GPL-3.0 package.json
  const gplDir = path.join(appDir, "node_modules", "gpl-pkg");
  fs.mkdirSync(gplDir, { recursive: true });
  fs.writeFileSync(
    path.join(gplDir, "package.json"),
    JSON.stringify({ name: "gpl-pkg", version: "1.0.0", license: "GPL-3.0-only" }),
  );

  fs.writeFileSync(path.join(tmpDir, "poly.toml"), '[workspace]\nmembers = ["apps/web"]\n');
  writeCompositeLockfile(tmpDir);

  const evaluator = new PolicyEvaluator();

  await t.test("flags forbidden GPL license violations", async () => {
    const report = await evaluator.evaluate(tmpDir, {
      deniedLicenses: ["GPL-3.0", "AGPL-3.0"],
    });

    assert.equal(report.passed, false);
    assert.ok(report.violations.length >= 1);
    assert.equal(report.violations[0].rule, "LICENSE_DENIED");
    assert.ok(report.violations[0].message.includes("GPL-3.0"));
  });

  await t.test("passes when no violations exist", async () => {
    const report = await evaluator.evaluate(tmpDir, {
      deniedLicenses: ["AGPL-3.0"], // Only deny AGPL, not GPL
    });

    assert.equal(report.deniedLicenseCount, 0);
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
