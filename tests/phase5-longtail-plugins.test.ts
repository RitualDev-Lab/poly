import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CrossStackAuditor } from "../src/compliance/auditor.js";
import { SbomGenerator } from "../src/compliance/sbom.js";
import { detectContexts } from "../src/detector/tree-walker.js";
import { PolyDispatcher } from "../src/dispatcher/executor.js";
import { PolyDoctor } from "../src/doctor/checker.js";
import {
  EngineRegistry,
  createCustomEngineAdapter,
  engineRegistry,
  expandCommandTemplate,
} from "../src/engines/index.js";
import { fetchLatestVersion, scanOutdatedDependencies } from "../src/outdated/checker.js";
import { parsePackageSpec } from "../src/purl/parser.js";
import { fetchRegistryMetadata } from "../src/security/registry.js";
import { loadWorkspaceConfig } from "../src/workspace/config.js";
import { verifyCompositeLockfile, writeCompositeLockfile } from "../src/workspace/lockfile.js";

test("Phase 5 PURL - Parses Hackage, CRAN, CPAN, and LuaRocks shorthands & RFC PURLs", () => {
  const aeson = parsePackageSpec("hackage:aeson@2.2.3.0");
  assert.equal(aeson.ecosystem, "hackage");
  assert.equal(aeson.name, "aeson");
  assert.equal(aeson.version, "2.2.3.0");

  const aesonPurl = parsePackageSpec("pkg:hackage/aeson@2.2.3.0");
  assert.equal(aesonPurl.ecosystem, "hackage");
  assert.equal(aesonPurl.name, "aeson");

  const ggplot = parsePackageSpec("cran:ggplot2@3.5.1");
  assert.equal(ggplot.ecosystem, "cran");
  assert.equal(ggplot.name, "ggplot2");
  assert.equal(ggplot.version, "3.5.1");

  const dplyrPurl = parsePackageSpec("pkg:cran/dplyr@1.1.4");
  assert.equal(dplyrPurl.ecosystem, "cran");

  const mojo = parsePackageSpec("cpan:Mojolicious@9.38");
  assert.equal(mojo.ecosystem, "cpan");
  assert.equal(mojo.name, "Mojolicious");
  assert.equal(mojo.version, "9.38");

  const dbixPurl = parsePackageSpec("pkg:cpan/DBIx-Class@0.082843");
  assert.equal(dbixPurl.ecosystem, "cpan");

  const lpeg = parsePackageSpec("luarocks:lpeg@1.1.0");
  assert.equal(lpeg.ecosystem, "luarocks");
  assert.equal(lpeg.name, "lpeg");
  assert.equal(lpeg.version, "1.1.0");

  const sockPurl = parsePackageSpec("pkg:luarocks/luasocket@3.1.0");
  assert.equal(sockPurl.ecosystem, "luarocks");
});

test("Phase 5 Engines - Resolves CLI args for cabal/stack, CRAN Rscript, cpanm, and luarocks", () => {
  const cabal = engineRegistry.createEngine("hackage");
  const pkgHaskell = parsePackageSpec("hackage:aeson@2.2.3.0");
  assert.deepEqual(cabal.resolveAddArgs(pkgHaskell), {
    command: "cabal",
    args: ["install", "aeson", "--lib", "--constraint=aeson ==2.2.3.0"],
  });
  assert.deepEqual(cabal.resolveInstallArgs(), {
    command: "cabal",
    args: ["build", "--only-dependencies"],
  });

  const tmpStack = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase5-stack-"));
  try {
    fs.writeFileSync(path.join(tmpStack, "stack.yaml"), "resolver: lts-22.0\n");
    const stack = engineRegistry.createEngine("hackage", {
      cwd: tmpStack,
      manifest: "package.yaml",
    });
    assert.deepEqual(stack.resolveAddArgs(pkgHaskell), {
      command: "stack",
      args: ["install", "aeson-2.2.3.0"],
    });
  } finally {
    fs.rmSync(tmpStack, { recursive: true, force: true });
  }

  const cran = engineRegistry.createEngine("cran");
  const rPkg = parsePackageSpec("cran:ggplot2@3.5.1");
  assert.deepEqual(cran.resolveAddArgs(rPkg), {
    command: "Rscript",
    args: ["-e", "pak::pkg_install('ggplot2@3.5.1'); renv::snapshot(prompt = FALSE)"],
  });
  assert.deepEqual(cran.resolveRemoveArgs(rPkg), {
    command: "Rscript",
    args: ["-e", "remove.packages('ggplot2')"],
  });

  const cpan = engineRegistry.createEngine("cpan");
  const perlPkg = parsePackageSpec("cpan:Mojolicious@9.38");
  assert.deepEqual(cpan.resolveAddArgs(perlPkg), { command: "cpanm", args: ["Mojolicious@9.38"] });
  assert.deepEqual(cpan.resolveInstallArgs(), { command: "cpanm", args: ["--installdeps", "."] });

  const lua = engineRegistry.createEngine("luarocks");
  const luaPkg = parsePackageSpec("luarocks:lpeg@1.1.0");
  assert.deepEqual(lua.resolveAddArgs(luaPkg), {
    command: "luarocks",
    args: ["install", "lpeg", "1.1.0"],
  });
  assert.deepEqual(lua.resolveInstallArgs(), {
    command: "luarocks",
    args: ["install", "--only-deps"],
  });
});

test("Phase 5 Custom Plugins - Loads [engines.custom.*] from poly.toml, expands templates, detects & locks", () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase5-custom-"));
  const bazelDir = path.join(wsDir, "svc-bazel");
  const zigDir = path.join(wsDir, "svc-zig");
  fs.mkdirSync(bazelDir, { recursive: true });
  fs.mkdirSync(zigDir, { recursive: true });

  fs.writeFileSync(
    path.join(wsDir, "poly.toml"),
    [
      'name = "custom-polyglot"',
      "",
      "[workspace]",
      'members = ["svc-bazel", "svc-zig"]',
      "",
      "[engines.custom.bazel]",
      'manifest = "MODULE.bazel"',
      'lockfile = "MODULE.bazel.lock"',
      'command = "bazel"',
      'aliases = ["bzl"]',
      'add = "mod tidy --dep={name}@{cleanVersion}"',
      'remove = "mod tidy --rm={name}"',
      'install = "fetch //..."',
      'update = "mod deps --update={name}"',
      "",
      "[engines.custom.zig]",
      'manifest = "*.zon"',
      'lockfile = "build.zig.zon.lock"',
      'command = "zig"',
      'add = ["fetch", "--save", "{name}@{cleanVersion}"]',
      'install = ["build", "--fetch"]',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(bazelDir, "MODULE.bazel"),
    'bazel_dep(name = "rules_cc", version = "0.0.10")\n',
  );
  fs.writeFileSync(path.join(bazelDir, "MODULE.bazel.lock"), "{}\n");
  fs.writeFileSync(path.join(zigDir, "build.zig.zon"), '.{ .name = "demo" }\n');

  try {
    const config = loadWorkspaceConfig(wsDir);
    assert.ok(config?.engines?.custom?.bazel);
    assert.ok(config?.engines?.custom?.zig);

    // Detection picks up both exact and glob custom manifests
    assert.equal(detectContexts(bazelDir)[0]?.ecosystem, "bazel");
    assert.equal(detectContexts(zigDir)[0]?.ecosystem, "zig");

    // Command template expansion omits dangling @ when version missing
    const pkgNoVer = parsePackageSpec("bazel:rules_go");
    const pkgVer = parsePackageSpec("bzl:rules_cc@0.0.10");
    assert.deepEqual(expandCommandTemplate("mod tidy --dep={name}@{cleanVersion}", [], pkgVer), [
      "mod",
      "tidy",
      "--dep=rules_cc@0.0.10",
    ]);
    assert.deepEqual(expandCommandTemplate("mod tidy --dep={name}@{cleanVersion}", [], pkgNoVer), [
      "mod",
      "tidy",
      "--dep=rules_go",
    ]);

    const bazelEngine = engineRegistry.createEngine("bazel");
    assert.deepEqual(bazelEngine.resolveAddArgs(pkgVer), {
      command: "bazel",
      args: ["mod", "tidy", "--dep=rules_cc@0.0.10"],
    });
    assert.deepEqual(bazelEngine.resolveInstallArgs(), {
      command: "bazel",
      args: ["fetch", "//..."],
    });

    const zigEngine = engineRegistry.createEngine("zig");
    assert.deepEqual(zigEngine.resolveInstallArgs(), {
      command: "zig",
      args: ["build", "--fetch"],
    });

    const lock = writeCompositeLockfile(wsDir);
    assert.equal(lock.members.length, 2);
    assert.equal(verifyCompositeLockfile(wsDir).isDrifted, false);
  } finally {
    engineRegistry.unregister("bazel");
    engineRegistry.unregister("zig");
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("Phase 5 Lazy-Load & Startup Gate - Loads ONLY workspace manifest adapters & starts zero-dep binary fast", async () => {
  // 1. Verify zero external runtime dependencies in package.json
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
  ) as { dependencies?: Record<string, string> };
  assert.equal(pkgJson.dependencies, undefined);

  // 2. Verify fresh EngineRegistry loads ONLY adapters whose manifests exist in the directory
  const reg = new EngineRegistry();
  let cpanLoads = 0;
  let hackageLoads = 0;

  reg.registerLazy(
    {
      id: "cpan",
      ecosystem: "cpan",
      aliases: ["perl"],
      purlTypes: ["cpan"],
      manifests: ["cpanfile"],
      lockfiles: [],
      defaultCli: "cpanm",
    },
    "perl",
    async () => {
      cpanLoads++;
      return [
        createCustomEngineAdapter("cpan", {
          manifests: ["cpanfile"],
          command: "cpanm",
        }),
      ];
    },
  );
  reg.registerLazy(
    {
      id: "hackage",
      ecosystem: "hackage",
      aliases: ["haskell"],
      purlTypes: ["hackage"],
      manifests: ["*.cabal"],
      lockfiles: [],
      defaultCli: "cabal",
    },
    "haskell",
    async () => {
      hackageLoads++;
      return [
        createCustomEngineAdapter("hackage", {
          manifests: ["*.cabal"],
          command: "cabal",
        }),
      ];
    },
  );

  const perlOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase5-lazy-"));
  try {
    fs.writeFileSync(path.join(perlOnlyDir, "cpanfile"), "requires 'Mojolicious', '9.38';\n");
    assert.equal(reg.isAdapterLoaded("cpan"), false);
    assert.equal(reg.isAdapterLoaded("hackage"), false);

    const activated = await reg.loadForDirectory(perlOnlyDir);
    assert.deepEqual(activated, ["cpan"]);
    assert.equal(cpanLoads, 1);
    assert.equal(hackageLoads, 0);
    assert.equal(reg.isAdapterLoaded("cpan"), true);
    assert.equal(reg.isAdapterLoaded("hackage"), false);
  } finally {
    fs.rmSync(perlOnlyDir, { recursive: true, force: true });
  }

  // 3. Verify compiled CLI bootstrap starts with 0 adapters eagerly instantiated and executes --version fast
  const distCli = path.join(process.cwd(), "dist", "cli.js");
  if (fs.existsSync(distCli)) {
    const t0 = performance.now();
    const versionOut = execFileSync(process.execPath, [distCli, "--version"], {
      encoding: "utf-8",
    });
    const elapsedMs = performance.now() - t0;
    assert.ok(versionOut.trim().length > 0);
    assert.ok(elapsedMs < 2000, `Expected fast CLI startup, took ${Math.round(elapsedMs)}ms`);
  }
});

test("Phase 5 Integration - Registries, outdated/upgrader, poly.lock, OSV (Hackage & CRAN), SBOM & Doctor", async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase5-ws-"));
  const hsDir = path.join(wsDir, "svc-haskell");
  const rDir = path.join(wsDir, "sci-r");
  const perlDir = path.join(wsDir, "svc-perl");
  const luaDir = path.join(wsDir, "ext-lua");

  for (const d of [hsDir, rDir, perlDir, luaDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  fs.writeFileSync(
    path.join(hsDir, "demo.cabal"),
    "name: demo\nlibrary\n  build-depends:\n    base >= 4.18,\n    aeson >= 2.1.0\n",
  );
  fs.writeFileSync(path.join(hsDir, "cabal.project.freeze"), "constraints: aeson ==2.1.0\n");
  fs.writeFileSync(
    path.join(rDir, "DESCRIPTION"),
    "Package: Analytics\nImports:\n  ggplot2 (>= 3.4.0),\n  dplyr (>= 1.1.0)\n",
  );
  fs.writeFileSync(
    path.join(rDir, "renv.lock"),
    JSON.stringify({
      R: { Version: "4.4.0" },
      Packages: { ggplot2: { Package: "ggplot2", Version: "3.4.0" } },
    }),
  );
  fs.writeFileSync(path.join(perlDir, "cpanfile"), "requires 'Mojolicious', '9.30';\n");
  fs.writeFileSync(
    path.join(luaDir, "gateway-1.0-1.rockspec"),
    'package = "gateway"\ndependencies = {\n  "lua >= 5.1",\n  "lpeg >= 1.0.2"\n}\n',
  );

  const osvQueries: Array<{ package?: { name?: string; ecosystem?: string }; version?: string }> =
    [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (u.includes("hackage.haskell.org/package/aeson/preferred.json")) {
      return new Response(JSON.stringify({ "normal-version": ["2.2.3.0", "2.1.0"] }), {
        status: 200,
      });
    }
    if (u.includes("crandb.r-pkg.org/ggplot2")) {
      return new Response(
        JSON.stringify({
          Version: "3.5.1",
          License: "MIT + file LICENSE",
          "Date/Publication": "2025-01-10",
        }),
        { status: 200 },
      );
    }
    if (u.includes("fastapi.metacpan.org/v1/release/Mojolicious")) {
      return new Response(
        JSON.stringify({ version: "9.38", date: "2025-02-01T00:00:00Z", license: ["artistic_2"] }),
        { status: 200 },
      );
    }
    if (u.includes("luarocks.org/modules/luarocks/lpeg.json")) {
      return new Response(JSON.stringify({ version: "1.1.0", license: "MIT" }), { status: 200 });
    }
    if (u.includes("api.osv.dev/v1/querybatch")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        queries?: Array<{ package?: { name?: string; ecosystem?: string }; version?: string }>;
      };
      const queries = body.queries ?? [];
      osvQueries.push(...queries);
      const results = queries.map((q) =>
        q.package?.ecosystem === "Hackage" && q.package?.name === "aeson"
          ? { vulns: [{ id: "HSEC-aeson-test", summary: "Mock Hackage advisory" }] }
          : {},
      );
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    assert.equal(detectContexts(hsDir)[0]?.ecosystem, "hackage");
    assert.equal(detectContexts(rDir)[0]?.ecosystem, "cran");
    assert.equal(detectContexts(perlDir)[0]?.ecosystem, "cpan");
    assert.equal(detectContexts(luaDir)[0]?.ecosystem, "luarocks");

    const dispatcher = new PolyDispatcher();
    assert.equal(dispatcher.which("hackage", hsDir).effectiveCli, "cabal");
    assert.equal(dispatcher.which("cran", rDir).effectiveCli, "Rscript");
    assert.equal(dispatcher.which("cpan", perlDir).effectiveCli, "cpanm");
    assert.equal(dispatcher.which("luarocks", luaDir).effectiveCli, "luarocks");

    const lock = writeCompositeLockfile(wsDir);
    assert.equal(lock.members.length, 4);
    assert.equal(verifyCompositeLockfile(wsDir).isDrifted, false);

    const sbom = JSON.parse(new SbomGenerator().generate(wsDir, { format: "cyclonedx" })) as {
      components: Array<{ purl: string }>;
    };
    const purls = sbom.components.map((c) => c.purl);
    assert.ok(purls.some((p) => p.startsWith("pkg:hackage/aeson@2.1.0")));
    assert.ok(purls.some((p) => p.startsWith("pkg:cran/ggplot2@3.4.0")));
    assert.ok(purls.some((p) => p.startsWith("pkg:cpan/Mojolicious@9.30")));
    assert.ok(purls.some((p) => p.startsWith("pkg:luarocks/lpeg@1.0.2")));

    assert.equal(await fetchLatestVersion("aeson", "hackage"), "2.2.3.0");
    assert.equal(await fetchLatestVersion("ggplot2", "cran"), "3.5.1");
    assert.equal(await fetchLatestVersion("Mojolicious", "cpan"), "9.38");
    assert.equal(await fetchLatestVersion("lpeg", "luarocks"), "1.1.0");

    const cranMeta = await fetchRegistryMetadata("cran", "ggplot2");
    assert.equal(cranMeta?.latestVersion, "3.5.1");
    const cpanMeta = await fetchRegistryMetadata("cpan", "Mojolicious");
    assert.equal(cpanMeta?.latestVersion, "9.38");

    const outdated = await scanOutdatedDependencies(wsDir);
    assert.equal(outdated.outdatedCount, 4);

    // OSV queries Hackage and CRAN while gracefully skipping cpan and luarocks
    const audit = await new CrossStackAuditor().audit(wsDir);
    assert.ok(
      osvQueries.some((q) => q.package?.ecosystem === "Hackage" && q.package?.name === "aeson"),
    );
    assert.ok(
      osvQueries.some((q) => q.package?.ecosystem === "CRAN" && q.package?.name === "ggplot2"),
    );
    assert.ok(!osvQueries.some((q) => q.package?.ecosystem === "cpan"));
    assert.ok(!osvQueries.some((q) => q.package?.ecosystem === "luarocks"));
    assert.ok(audit.findings.some((f) => f.id === "HSEC-aeson-test"));

    const doctor = await new PolyDoctor().diagnose(wsDir);
    assert.equal(doctor.checks.find((c) => c.id === "workspace-lock-drift")?.status, "OK");
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
