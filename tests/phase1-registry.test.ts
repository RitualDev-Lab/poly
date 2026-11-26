import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CrossStackAuditor } from "../src/compliance/auditor.js";
import { detectContexts, matchesManifestGlob } from "../src/detector/tree-walker.js";
import { PolyDispatcher } from "../src/dispatcher/executor.js";
import { PolyDoctor } from "../src/doctor/checker.js";
import { defineDeclarativeAdapter, engineRegistry } from "../src/engines/index.js";
import { parsePackageSpec } from "../src/purl/parser.js";
import { verifyCompositeLockfile, writeCompositeLockfile } from "../src/workspace/lockfile.js";

test("Detector - Supports Deno, Pipenv, and Conda manifests & lockfiles", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase1-detect-"));
  const denoDir = path.join(tmpDir, "deno-app");
  const pipenvDir = path.join(tmpDir, "pipenv-svc");
  const condaDir = path.join(tmpDir, "conda-ml");
  fs.mkdirSync(denoDir, { recursive: true });
  fs.mkdirSync(pipenvDir, { recursive: true });
  fs.mkdirSync(condaDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(denoDir, "deno.json"), JSON.stringify({ imports: {} }));
    fs.writeFileSync(path.join(denoDir, "deno.lock"), "{}");
    const denoCtx = detectContexts(denoDir);
    assert.equal(denoCtx[0]?.ecosystem, "jsr");
    assert.equal(denoCtx[0]?.manifestFile, "deno.json");
    assert.equal(denoCtx[0]?.lockfile, "deno.lock");

    fs.writeFileSync(path.join(pipenvDir, "Pipfile"), '[packages]\nrequests = "*"\n');
    fs.writeFileSync(path.join(pipenvDir, "Pipfile.lock"), "{}");
    const pipenvCtx = detectContexts(pipenvDir);
    assert.equal(pipenvCtx[0]?.ecosystem, "pypi");
    assert.equal(pipenvCtx[0]?.manifestFile, "Pipfile");
    assert.equal(pipenvCtx[0]?.lockfile, "Pipfile.lock");

    fs.writeFileSync(
      path.join(condaDir, "environment.yml"),
      "name: ml\ndependencies:\n  - numpy=1.26.4\n",
    );
    fs.writeFileSync(path.join(condaDir, "conda-lock.yml"), "version: 1\n");
    const condaCtx = detectContexts(condaDir);
    assert.equal(condaCtx[0]?.ecosystem, "conda");
    assert.equal(condaCtx[0]?.manifestFile, "environment.yml");
    assert.equal(condaCtx[0]?.lockfile, "conda-lock.yml");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Detector - Glob matching handles *.csproj, *.rockspec, and *.cabal", () => {
  assert.equal(matchesManifestGlob("MyService.csproj", "*.csproj"), true);
  assert.equal(matchesManifestGlob("luafilesystem-1.8.0-1.rockspec", "*.rockspec"), true);
  assert.equal(matchesManifestGlob("awesome-lib.cabal", "*.cabal"), true);
  assert.equal(matchesManifestGlob("package.json", "*.csproj"), false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase1-glob-"));
  const luarocksAdapter = defineDeclarativeAdapter({
    id: "luarocks-test",
    ecosystem: "luarocks",
    purlTypes: ["luarocks"],
    manifests: ["*.rockspec"],
    lockfiles: ["luarocks.lock"],
    commands: {
      command: "luarocks",
      add: (pkg) => ["install", pkg.name],
      remove: (pkg) => ["remove", pkg.name],
      install: () => ["make"],
      update: (pkg) => ["install", pkg?.name ?? ""],
    },
  });

  try {
    engineRegistry.register(luarocksAdapter);
    fs.writeFileSync(path.join(tmpDir, "awesome-1.0-1.rockspec"), "package = 'awesome'");

    const contexts = detectContexts(tmpDir);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].ecosystem, "luarocks");
    assert.equal(contexts[0].manifestFile, "awesome-1.0-1.rockspec");

    const spec = parsePackageSpec("luarocks:luasocket@3.1.0");
    assert.equal(spec.ecosystem, "luarocks");
    const engine = engineRegistry.createEngine("luarocks");
    assert.deepEqual(engine.resolveAddArgs(spec), {
      command: "luarocks",
      args: ["install", "luasocket"],
    });
  } finally {
    engineRegistry.unregister("luarocks");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Phase 1 Exit Gate - Dispatcher which, poly.lock, OSV audit & PolyDoctor across Deno, Pipenv, Conda", async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase1-ws-"));
  const denoDir = path.join(wsDir, "apps", "edge");
  const pipenvDir = path.join(wsDir, "services", "api");
  const condaDir = path.join(wsDir, "services", "ml");

  fs.mkdirSync(denoDir, { recursive: true });
  fs.mkdirSync(pipenvDir, { recursive: true });
  fs.mkdirSync(condaDir, { recursive: true });

  fs.writeFileSync(
    path.join(wsDir, "poly.toml"),
    `[workspace]\nname = "phase1-demo"\nmembers = ["apps/*", "services/*"]\n`,
  );

  fs.writeFileSync(
    path.join(denoDir, "deno.json"),
    JSON.stringify({
      imports: {
        "@std/path": "jsr:@std/path@^1.0.0",
        zod: "npm:zod@^3.22.4",
      },
    }),
  );
  fs.writeFileSync(path.join(denoDir, "deno.lock"), "{}");

  fs.writeFileSync(
    path.join(pipenvDir, "Pipfile"),
    `[packages]\nfastapi = ">=0.110.0"\n\n[dev-packages]\npytest = "*"\n`,
  );
  fs.writeFileSync(path.join(pipenvDir, "Pipfile.lock"), "{}");

  fs.writeFileSync(
    path.join(condaDir, "environment.yml"),
    "name: ml-env\ndependencies:\n  - numpy=1.26.4\n  - pip:\n    - requests==2.31.0\n",
  );

  try {
    const dispatcher = new PolyDispatcher();
    assert.equal(dispatcher.which("jsr", denoDir).effectiveCli, "deno");
    assert.equal(dispatcher.which("pypi", pipenvDir).effectiveCli, "pipenv");
    const condaWhich = dispatcher.which("conda", condaDir).effectiveCli;
    assert.ok(["conda", "mamba", "micromamba"].includes(condaWhich));

    // Verify poly.lock generation & zero-drift verification
    const lock = writeCompositeLockfile(wsDir);
    assert.equal(lock.members.length, 3);
    const denoMember = lock.members.find((m) => m.ecosystem === "jsr");
    const condaMember = lock.members.find((m) => m.ecosystem === "conda");
    const pipenvMember = lock.members.find((m) => m.ecosystem === "pypi");

    assert.ok(denoMember?.directDependencies.includes("jsr:@std/path@^1.0.0"));
    assert.ok(denoMember?.directDependencies.includes("npm:zod@^3.22.4"));
    assert.ok(pipenvMember?.directDependencies.includes("pypi:fastapi>=0.110.0"));
    assert.ok(condaMember?.directDependencies.includes("conda:numpy=1.26.4"));
    assert.ok(condaMember?.directDependencies.includes("pypi:requests==2.31.0"));

    const drift = verifyCompositeLockfile(wsDir);
    assert.equal(drift.isDrifted, false);

    // Verify OSV auditor executes cleanly on composite workspace containing jsr/conda/pypi
    const auditor = new CrossStackAuditor();
    const auditReport = await auditor.audit(wsDir);
    assert.ok(auditReport.scannedPackages >= 5);

    // Verify PolyDoctor runs cleanly against polyglot workspace with poly.lock
    const doctor = new PolyDoctor();
    const doctorReport = await doctor.diagnose(wsDir);
    const lockCheck = doctorReport.checks.find((c) => c.id === "workspace-lock-drift");
    assert.equal(lockCheck?.status, "OK");
    assert.ok(doctorReport.checks.some((c) => c.id === "toolchain-node-managers"));
    assert.ok(doctorReport.checks.some((c) => c.id === "toolchain-python-uv"));
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
