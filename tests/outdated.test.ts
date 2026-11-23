import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanVersion, compareSemver, parseSemver } from "../src/outdated/semver.js";
import { executeBatchUpgrade, patchManifestVersion } from "../src/outdated/upgrader.js";

test("Outdated Intelligence - Semver Parsing & Comparison", async (t) => {
  await t.test("cleanVersion strips prefixes properly", () => {
    assert.equal(cleanVersion("^1.2.3"), "1.2.3");
    assert.equal(cleanVersion("~0.4.1"), "0.4.1");
    assert.equal(cleanVersion(">=2.0.0"), "2.0.0");
    assert.equal(cleanVersion("v3.1.4"), "3.1.4");
    assert.equal(cleanVersion(""), "0.0.0");
  });

  await t.test("parseSemver decomposes numeric version parts", () => {
    assert.deepEqual(parseSemver("1.2.3"), [1, 2, 3]);
    assert.deepEqual(parseSemver("^2.10.4-beta.1"), [2, 10, 4]);
    assert.deepEqual(parseSemver("v0.5"), [0, 5, 0]);
  });

  await t.test("compareSemver identifies major diff", () => {
    const res = compareSemver("^1.4.0", "2.0.0");
    assert.equal(res.isOutdated, true);
    assert.equal(res.diff, "major");
  });

  await t.test("compareSemver identifies minor diff", () => {
    const res = compareSemver("~1.2.0", "1.5.1");
    assert.equal(res.isOutdated, true);
    assert.equal(res.diff, "minor");
  });

  await t.test("compareSemver identifies patch diff", () => {
    const res = compareSemver("1.2.3", "1.2.5");
    assert.equal(res.isOutdated, true);
    assert.equal(res.diff, "patch");
  });

  await t.test("compareSemver identifies up-to-date packages", () => {
    const res = compareSemver("1.2.3", "1.2.3");
    assert.equal(res.isOutdated, false);
    assert.equal(res.diff, "unknown");
  });
});

test("Outdated Intelligence - Manifest Patching", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-outdated-manifest-"));

  await t.test("patches package.json dependencies and devDependencies", () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: "test-app",
          dependencies: { zod: "^3.22.0" },
          devDependencies: { typescript: "~5.0.0" },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const patchedDep = patchManifestVersion(pkgPath, "zod", "3.24.0");
    assert.equal(patchedDep, true);

    const patchedDev = patchManifestVersion(pkgPath, "typescript", "5.8.0");
    assert.equal(patchedDev, true);

    const updated = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    assert.equal(updated.dependencies.zod, "^3.24.0");
    assert.equal(updated.devDependencies.typescript, "^5.8.0");
  });

  await t.test("patches requirements.txt", () => {
    const reqPath = path.join(tmpDir, "requirements.txt");
    fs.writeFileSync(reqPath, "fastapi==0.100.0\nuvicorn==0.20.0\n", "utf-8");

    const patched = patchManifestVersion(reqPath, "fastapi", "0.115.0");
    assert.equal(patched, true);

    const content = fs.readFileSync(reqPath, "utf-8");
    assert.ok(content.includes("fastapi==0.115.0"));
    assert.ok(content.includes("uvicorn==0.20.0"));
  });

  await t.test("patches Cargo.toml", () => {
    const cargoPath = path.join(tmpDir, "Cargo.toml");
    fs.writeFileSync(
      cargoPath,
      `[package]\nname = "rust-app"\nversion = "0.1.0"\n\n[dependencies]\ntokio = "1.30.0"\nserde = "1.0.180"\n`,
      "utf-8",
    );

    const patched = patchManifestVersion(cargoPath, "tokio", "1.42.0");
    assert.equal(patched, true);

    const content = fs.readFileSync(cargoPath, "utf-8");
    assert.ok(content.includes('tokio = "1.42.0"'));
  });

  await t.test("patches go.mod", () => {
    const goModPath = path.join(tmpDir, "go.mod");
    fs.writeFileSync(
      goModPath,
      "module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n",
      "utf-8",
    );

    const patched = patchManifestVersion(goModPath, "github.com/gin-gonic/gin", "1.10.0");
    assert.equal(patched, true);

    const content = fs.readFileSync(goModPath, "utf-8");
    assert.ok(content.includes("github.com/gin-gonic/gin v1.10.0"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
