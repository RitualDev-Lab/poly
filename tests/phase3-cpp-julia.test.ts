import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CrossStackAuditor } from "../src/compliance/auditor.js";
import { SbomGenerator } from "../src/compliance/sbom.js";
import { detectContexts } from "../src/detector/tree-walker.js";
import { PolyDispatcher } from "../src/dispatcher/executor.js";
import { PolyDoctor } from "../src/doctor/checker.js";
import { engineRegistry } from "../src/engines/index.js";
import { parsePackageSpec } from "../src/purl/parser.js";
import { verifyCompositeLockfile, writeCompositeLockfile } from "../src/workspace/lockfile.js";

test("Phase 3 PURL - Parses Conan, vcpkg, Meson, and Julia shorthands & RFC PURLs", () => {
  const conanShort = parsePackageSpec("conan:fmt@10.2.1");
  assert.equal(conanShort.ecosystem, "conan");
  assert.equal(conanShort.name, "fmt");
  assert.equal(conanShort.version, "10.2.1");

  const conanPurl = parsePackageSpec("pkg:conan/zlib@1.3.1");
  assert.equal(conanPurl.ecosystem, "conan");
  assert.equal(conanPurl.name, "zlib");
  assert.equal(conanPurl.version, "1.3.1");

  const vcpkgShort = parsePackageSpec("vcpkg:zlib");
  assert.equal(vcpkgShort.ecosystem, "vcpkg");
  assert.equal(vcpkgShort.name, "zlib");

  const vcpkgPurl = parsePackageSpec("pkg:vcpkg/openssl@3.3.0");
  assert.equal(vcpkgPurl.ecosystem, "vcpkg");
  assert.equal(vcpkgPurl.name, "openssl");
  assert.equal(vcpkgPurl.version, "3.3.0");

  const mesonWrap = parsePackageSpec("wrap:gtest");
  assert.equal(mesonWrap.ecosystem, "meson");
  assert.equal(mesonWrap.name, "gtest");

  const mesonPurl = parsePackageSpec("pkg:meson/sqlite3@3.46.0");
  assert.equal(mesonPurl.ecosystem, "meson");
  assert.equal(mesonPurl.name, "sqlite3");
  assert.equal(mesonPurl.version, "3.46.0");

  const juliaShort = parsePackageSpec("julia:DataFrames@1.6.1");
  assert.equal(juliaShort.ecosystem, "julia");
  assert.equal(juliaShort.name, "DataFrames");
  assert.equal(juliaShort.version, "1.6.1");

  const juliaPurl = parsePackageSpec("pkg:julia/JSON3@1.14.0");
  assert.equal(juliaPurl.ecosystem, "julia");
  assert.equal(juliaPurl.name, "JSON3");
  assert.equal(juliaPurl.version, "1.14.0");
});

test("Phase 3 Engines - Resolves CLI args for conan, vcpkg, meson, and julia Pkg.jl", () => {
  const conan = engineRegistry.createEngine("conan");
  const fmtPkg = parsePackageSpec("conan:fmt@10.2.1");
  assert.deepEqual(conan.resolveAddArgs(fmtPkg), {
    command: "conan",
    args: ["install", "--requires=fmt/10.2.1", "--build=missing"],
  });
  assert.deepEqual(conan.resolveRemoveArgs(fmtPkg), {
    command: "conan",
    args: ["remove", "fmt/*", "-c"],
  });
  assert.deepEqual(conan.resolveInstallArgs(), {
    command: "conan",
    args: ["install", ".", "--build=missing"],
  });
  assert.deepEqual(conan.resolveUpdateArgs(fmtPkg), {
    command: "conan",
    args: ["install", "--requires=fmt/10.2.1", "--update", "--build=missing"],
  });

  const vcpkg = engineRegistry.createEngine("vcpkg");
  const zlibPkg = parsePackageSpec("vcpkg:zlib");
  assert.deepEqual(vcpkg.resolveAddArgs(zlibPkg), {
    command: "vcpkg",
    args: ["add", "port", "zlib"],
  });
  assert.deepEqual(vcpkg.resolveRemoveArgs(zlibPkg), {
    command: "vcpkg",
    args: ["remove", "zlib"],
  });
  assert.deepEqual(vcpkg.resolveInstallArgs(), {
    command: "vcpkg",
    args: ["install"],
  });
  assert.deepEqual(vcpkg.resolveUpdateArgs(zlibPkg), {
    command: "vcpkg",
    args: ["upgrade", "zlib", "--no-dry-run"],
  });

  const meson = engineRegistry.createEngine("meson");
  const sqlitePkg = parsePackageSpec("meson:sqlite3");
  assert.deepEqual(meson.resolveAddArgs(sqlitePkg), {
    command: "meson",
    args: ["wrap", "install", "sqlite3"],
  });
  assert.deepEqual(meson.resolveInstallArgs(), {
    command: "meson",
    args: ["subprojects", "download"],
  });
  assert.deepEqual(meson.resolveUpdateArgs(sqlitePkg), {
    command: "meson",
    args: ["wrap", "update", "sqlite3"],
  });

  const julia = engineRegistry.createEngine("julia");
  const dfPkg = parsePackageSpec("julia:DataFrames@^1.6.1");
  assert.deepEqual(julia.resolveAddArgs(dfPkg), {
    command: "julia",
    args: [
      "--project=.",
      "-e",
      'using Pkg; Pkg.add(PackageSpec(name="DataFrames", version="1.6.1"))',
    ],
  });
  assert.deepEqual(julia.resolveRemoveArgs(dfPkg), {
    command: "julia",
    args: ["--project=.", "-e", 'using Pkg; Pkg.rm("DataFrames")'],
  });
  assert.deepEqual(julia.resolveInstallArgs(), {
    command: "julia",
    args: ["--project=.", "-e", "using Pkg; Pkg.instantiate()"],
  });
  assert.deepEqual(julia.resolveUpdateArgs(), {
    command: "julia",
    args: ["--project=.", "-e", "using Pkg; Pkg.update()"],
  });
});

test("Phase 3 Integration - Monorepo (Node + Python + C/C++ + Julia) lockfile, OSV ConanCenter, SBOM & doctor", async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase3-ws-"));
  const nodeDir = path.join(wsDir, "app-web");
  const pyDir = path.join(wsDir, "ml-python");
  const vcpkgDir = path.join(wsDir, "native-vcpkg");
  const conanDir = path.join(wsDir, "native-conan");
  const mesonDir = path.join(wsDir, "native-meson");
  const juliaDir = path.join(wsDir, "sci-julia");

  for (const dir of [nodeDir, pyDir, vcpkgDir, conanDir, mesonDir, juliaDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(nodeDir, "package.json"),
    JSON.stringify({ name: "web-ui", dependencies: { zod: "3.23.8" } }),
  );
  fs.writeFileSync(
    path.join(pyDir, "pyproject.toml"),
    '[project]\nname = "ml-bindings"\ndependencies = [\n  "numpy==2.1.0",\n]\n',
  );
  fs.writeFileSync(
    path.join(vcpkgDir, "vcpkg.json"),
    JSON.stringify({
      name: "native-engine",
      version: "0.1.0",
      dependencies: ["zlib", { name: "fmt", "version>=": "10.2.1" }],
    }),
  );
  fs.writeFileSync(
    path.join(vcpkgDir, "vcpkg-configuration.json"),
    JSON.stringify({ "default-registry": { kind: "builtin", baseline: "abc123" } }),
  );
  fs.writeFileSync(
    path.join(conanDir, "conanfile.txt"),
    "[requires]\nopenssl/3.2.1\n\n[generators]\nCMakeToolchain\n",
  );
  fs.writeFileSync(path.join(conanDir, "conan.lock"), '{"version":"0.5"}');
  fs.writeFileSync(
    path.join(mesonDir, "meson.build"),
    "project('video_core', 'cpp')\nsqlite = dependency('sqlite3')\ngtest = subproject('gtest')\n",
  );
  fs.writeFileSync(
    path.join(juliaDir, "Project.toml"),
    [
      'name = "SimKernel"',
      'uuid = "11111111-2222-3333-4444-555555555555"',
      "",
      "[deps]",
      'DataFrames = "a93c6f00-e57d-5684-b7b6-d8193f3e46c0"',
      "",
      "[compat]",
      'DataFrames = "1.6.1"',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(juliaDir, "Manifest.toml"),
    '# Julia Manifest\njulia_version = "1.10.4"\n',
  );

  const capturedOsvQueries: Array<{
    package?: { name?: string; ecosystem?: string };
    version?: string;
  }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u.includes("api.osv.dev/v1/querybatch")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        queries?: Array<{ package?: { name?: string; ecosystem?: string }; version?: string }>;
      };
      const queries = body.queries ?? [];
      capturedOsvQueries.push(...queries);
      const results = queries.map((q) => {
        if (q.package?.ecosystem === "ConanCenter" && q.package?.name === "openssl") {
          return {
            vulns: [{ id: "GHSA-conan-openssl-test", summary: "Mock ConanCenter advisory" }],
          };
        }
        return {};
      });
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    // 1. Detector + Dispatcher across all 4 new toolchains
    assert.equal(detectContexts(vcpkgDir)[0]?.manifestFile, "vcpkg.json");
    assert.equal(detectContexts(conanDir)[0]?.manifestFile, "conanfile.txt");
    assert.equal(detectContexts(mesonDir)[0]?.manifestFile, "meson.build");
    assert.equal(detectContexts(juliaDir)[0]?.manifestFile, "Project.toml");

    const dispatcher = new PolyDispatcher();
    assert.equal(dispatcher.which("conan", conanDir).effectiveCli, "conan");
    assert.equal(dispatcher.which("vcpkg", vcpkgDir).effectiveCli, "vcpkg");
    assert.equal(dispatcher.which("meson", mesonDir).effectiveCli, "meson");
    assert.equal(dispatcher.which("julia", juliaDir).effectiveCli, "julia");

    // 2. Co-located monorepo detection (Python + Node + vcpkg + Conan) & poly.lock SHA-256 verification
    const colocatedDir = path.join(wsDir, "hybrid-cpp-py-node");
    fs.mkdirSync(colocatedDir, { recursive: true });
    fs.writeFileSync(path.join(colocatedDir, "package.json"), JSON.stringify({ name: "hybrid" }));
    fs.writeFileSync(path.join(colocatedDir, "pyproject.toml"), '[project]\nname = "hybrid"\n');
    fs.writeFileSync(
      path.join(colocatedDir, "vcpkg.json"),
      JSON.stringify({ name: "hybrid", dependencies: ["zlib"] }),
    );
    fs.writeFileSync(path.join(colocatedDir, "conanfile.txt"), "[requires]\nfmt/10.2.1\n");

    const colocatedContexts = detectContexts(colocatedDir);
    const colocatedEcosystems = colocatedContexts.map((c) => c.ecosystem);
    assert.ok(colocatedEcosystems.includes("npm"));
    assert.ok(colocatedEcosystems.includes("pypi"));
    assert.ok(colocatedEcosystems.includes("vcpkg"));
    assert.ok(colocatedEcosystems.includes("conan"));

    for (const ctx of colocatedContexts) {
      const eng = engineRegistry.createEngine(ctx.ecosystem, {
        cwd: ctx.directory,
        manifest: ctx.manifestFile,
        lockfile: ctx.lockfile,
      });
      const installCmd = eng.resolveInstallArgs();
      assert.ok(installCmd.command.length > 0);
    }

    // Write composite poly.lock covering root workspace members (exclude extra test helper folder before locking)
    fs.rmSync(colocatedDir, { recursive: true, force: true });
    const lock = writeCompositeLockfile(wsDir);
    assert.equal(lock.members.length, 6);
    assert.equal(verifyCompositeLockfile(wsDir).isDrifted, false);

    const vcpkgMember = lock.members.find((m) => m.ecosystem === "vcpkg");
    const conanMember = lock.members.find((m) => m.ecosystem === "conan");
    const mesonMember = lock.members.find((m) => m.ecosystem === "meson");
    const juliaMember = lock.members.find((m) => m.ecosystem === "julia");
    assert.ok(vcpkgMember?.directDependencies.includes("vcpkg:fmt@10.2.1"));
    assert.ok(vcpkgMember?.directDependencies.includes("vcpkg:zlib@*"));
    assert.ok(conanMember?.directDependencies.includes("conan:openssl@3.2.1"));
    assert.ok(mesonMember?.directDependencies.includes("meson:sqlite3@*"));
    assert.ok(mesonMember?.directDependencies.includes("meson:gtest@*"));
    assert.ok(juliaMember?.directDependencies.includes("julia:DataFrames@1.6.1"));

    // 3. CycloneDX SBOM generation with PURLs for C/C++ + Julia + Node + Python
    const sbom = JSON.parse(new SbomGenerator().generate(wsDir, { format: "cyclonedx" })) as {
      components: Array<{ purl: string }>;
    };
    const purls = sbom.components.map((c) => c.purl);
    assert.ok(purls.some((p) => p.startsWith("pkg:npm/zod@3.23.8")));
    assert.ok(purls.some((p) => p.startsWith("pkg:pypi/numpy")));
    assert.ok(purls.some((p) => p.startsWith("pkg:conan/openssl@3.2.1")));
    assert.ok(purls.some((p) => p.startsWith("pkg:vcpkg/fmt@10.2.1")));
    assert.ok(purls.some((p) => p.startsWith("pkg:meson/sqlite3")));
    assert.ok(purls.some((p) => p.startsWith("pkg:julia/DataFrames@1.6.1")));

    // 4. OSV queries ConanCenter while gracefully skipping vcpkg, meson, and julia
    const audit = await new CrossStackAuditor().audit(wsDir);
    assert.equal(audit.scannedPackages, 8);
    assert.ok(
      capturedOsvQueries.some(
        (q) => q.package?.ecosystem === "ConanCenter" && q.package?.name === "openssl",
      ),
    );
    assert.ok(!capturedOsvQueries.some((q) => q.package?.ecosystem === "vcpkg"));
    assert.ok(!capturedOsvQueries.some((q) => q.package?.ecosystem === "meson"));
    assert.ok(!capturedOsvQueries.some((q) => q.package?.ecosystem === "julia"));
    assert.ok(
      audit.findings.some((f) => f.id === "GHSA-conan-openssl-test" && f.ecosystem === "conan"),
    );

    // 5. PolyDoctor checks lockfile health cleanly across the polyglot workspace
    const doctor = await new PolyDoctor().diagnose(wsDir);
    assert.equal(doctor.checks.find((c) => c.id === "workspace-lock-drift")?.status, "OK");
    assert.ok(doctor.checks.length > 0);
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
