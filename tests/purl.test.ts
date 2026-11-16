import assert from "node:assert/strict";
import test from "node:test";
import { parsePackageSpec } from "../src/purl/parser.js";

test("PURL Parser - Shorthand Ecosystem Prefixes", () => {
  const npmPkg = parsePackageSpec("npm:axios@^1.7.2");
  assert.equal(npmPkg.ecosystem, "npm");
  assert.equal(npmPkg.name, "axios");
  assert.equal(npmPkg.version, "^1.7.2");
  assert.equal(npmPkg.isDev, false);

  const pypiPkg = parsePackageSpec("pypi:fastapi@>=0.110.0", { isDev: true });
  assert.equal(pypiPkg.ecosystem, "pypi");
  assert.equal(pypiPkg.name, "fastapi");
  assert.equal(pypiPkg.version, ">=0.110.0");
  assert.equal(pypiPkg.isDev, true);

  const cargoPkg = parsePackageSpec("cargo:tokio@1.38.0");
  assert.equal(cargoPkg.ecosystem, "cargo");
  assert.equal(cargoPkg.name, "tokio");
  assert.equal(cargoPkg.version, "1.38.0");

  const goPkg = parsePackageSpec("go:github.com/gin-gonic/gin@v1.9.1");
  assert.equal(goPkg.ecosystem, "go");
  assert.equal(goPkg.name, "github.com/gin-gonic/gin");
  assert.equal(goPkg.version, "v1.9.1");
});

test("PURL Parser - Scoped Packages (@namespace/name)", () => {
  const scoped = parsePackageSpec("npm:@ritualdev-lab/agentshield@0.2.2");
  assert.equal(scoped.ecosystem, "npm");
  assert.equal(scoped.namespace, "@ritualdev-lab");
  assert.equal(scoped.name, "agentshield");
  assert.equal(scoped.version, "0.2.2");
});

test("PURL Parser - Standard RFC Package URLs", () => {
  const stdNpm = parsePackageSpec("pkg:npm/%40ritualdev-lab/dbshield@0.2.1");
  assert.equal(stdNpm.ecosystem, "npm");
  assert.equal(stdNpm.namespace, "@ritualdev-lab");
  assert.equal(stdNpm.name, "dbshield");
  assert.equal(stdNpm.version, "0.2.1");

  const stdPypi = parsePackageSpec("pkg:pypi/requests@2.31.0");
  assert.equal(stdPypi.ecosystem, "pypi");
  assert.equal(stdPypi.name, "requests");
  assert.equal(stdPypi.version, "2.31.0");
});

test("PURL Parser - Bare Package Names (No prefix)", () => {
  const bare1 = parsePackageSpec("requests");
  assert.equal(bare1.ecosystem, undefined);
  assert.equal(bare1.name, "requests");
  assert.equal(bare1.version, undefined);

  const bare2 = parsePackageSpec("zod@^3.22.4", { isDev: true });
  assert.equal(bare2.ecosystem, undefined);
  assert.equal(bare2.name, "zod");
  assert.equal(bare2.version, "^3.22.4");
  assert.equal(bare2.isDev, true);
});

test("PURL Parser - Error Handling on Empty or Malformed Input", () => {
  assert.throws(() => parsePackageSpec("   "), /Cannot parse an empty/);
  assert.throws(() => parsePackageSpec("pkg:unknown/something"), /Unsupported PURL ecosystem/);
});
