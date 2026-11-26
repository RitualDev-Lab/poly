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
import { fetchLatestVersion, scanOutdatedDependencies } from "../src/outdated/checker.js";
import { patchManifestVersion } from "../src/outdated/upgrader.js";
import { parsePackageSpec } from "../src/purl/parser.js";
import { fetchRegistryMetadata } from "../src/security/registry.js";
import { verifyCompositeLockfile, writeCompositeLockfile } from "../src/workspace/lockfile.js";

test("Phase 2 PURL - Parses NuGet, Composer, RubyGems, and Pub shorthands & RFC PURLs", () => {
  const nuget = parsePackageSpec("nuget:Newtonsoft.Json@13.0.3");
  assert.equal(nuget.ecosystem, "nuget");
  assert.equal(nuget.name, "Newtonsoft.Json");
  assert.equal(nuget.version, "13.0.3");

  const composer = parsePackageSpec("composer:laravel/framework@^11.0.0", { isDev: true });
  assert.equal(composer.ecosystem, "composer");
  assert.equal(composer.name, "laravel/framework");
  assert.equal(composer.version, "^11.0.0");
  assert.equal(composer.isDev, true);

  const gem = parsePackageSpec("pkg:gem/sidekiq@7.3.0");
  assert.equal(gem.ecosystem, "gem");
  assert.equal(gem.name, "sidekiq");
  assert.equal(gem.version, "7.3.0");

  const pub = parsePackageSpec("pkg:pub/http@1.2.0");
  assert.equal(pub.ecosystem, "pub");
  assert.equal(pub.name, "http");
  assert.equal(pub.version, "1.2.0");
});

test("Phase 2 Engines - Resolves CLI args for dotnet/paket, composer/pear, bundle/gem, and dart/flutter", () => {
  const dotnet = engineRegistry.createEngine("nuget", { manifest: "Api.csproj" });
  const jsonPkg = parsePackageSpec("nuget:Serilog@4.0.0");
  assert.deepEqual(dotnet.resolveAddArgs(jsonPkg), {
    command: "dotnet",
    args: ["add", "Api.csproj", "package", "Serilog", "--version", "4.0.0"],
  });
  assert.deepEqual(dotnet.resolveRemoveArgs(jsonPkg), {
    command: "dotnet",
    args: ["remove", "Api.csproj", "package", "Serilog"],
  });
  assert.deepEqual(dotnet.resolveInstallArgs(), { command: "dotnet", args: ["restore"] });

  const paket = engineRegistry.createEngine("nuget", { manifest: "paket.dependencies" });
  assert.deepEqual(paket.resolveInstallArgs(), { command: "paket", args: ["install"] });

  const composer = engineRegistry.createEngine("composer");
  const phpPkg = parsePackageSpec("composer:monolog/monolog@^3.7", { isDev: true });
  assert.deepEqual(composer.resolveAddArgs(phpPkg), {
    command: "composer",
    args: ["require", "monolog/monolog:^3.7", "--dev"],
  });
  assert.deepEqual(composer.resolveUpdateArgs(phpPkg), {
    command: "composer",
    args: ["update", "monolog/monolog"],
  });

  const pear = engineRegistry.createEngine("composer", { manifest: "package.xml" });
  assert.equal(pear.resolveInstallArgs().command, "pear");

  const bundler = engineRegistry.createEngine("gem");
  const gemPkg = parsePackageSpec("gem:rspec@3.13.0", { isDev: true });
  assert.deepEqual(bundler.resolveAddArgs(gemPkg), {
    command: "bundle",
    args: ["add", "rspec", "--version", "3.13.0", "--group", "development"],
  });
  assert.deepEqual(bundler.resolveRemoveArgs(gemPkg), {
    command: "bundle",
    args: ["remove", "rspec"],
  });

  const tmpFlutter = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase2-flutter-"));
  try {
    fs.writeFileSync(
      path.join(tmpFlutter, "pubspec.yaml"),
      "name: mobile_app\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.1.0\n",
    );
    const flutterEngine = engineRegistry.createEngine("pub", {
      cwd: tmpFlutter,
      manifest: "pubspec.yaml",
    });
    const pubPkg = parsePackageSpec("pub:dio@^5.7.0", { isDev: true });
    assert.deepEqual(flutterEngine.resolveAddArgs(pubPkg), {
      command: "flutter",
      args: ["pub", "add", "dev:dio:^5.7.0"],
    });
    assert.deepEqual(flutterEngine.resolveInstallArgs(), {
      command: "flutter",
      args: ["pub", "get"],
    });
  } finally {
    fs.rmSync(tmpFlutter, { recursive: true, force: true });
  }
});

test("Phase 2 Exit Gate - OSV mapping, SBOM, poly.lock SHA-256, Doctor & Registry Metadata across 4 stacks", async () => {
  assert.equal(engineRegistry.getOsvEcosystem("nuget"), "NuGet");
  assert.equal(engineRegistry.getOsvEcosystem("composer"), "Packagist");
  assert.equal(engineRegistry.getOsvEcosystem("gem"), "RubyGems");
  assert.equal(engineRegistry.getOsvEcosystem("pub"), "Pub");

  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase2-ws-"));
  const csDir = path.join(wsDir, "services", "billing");
  const phpDir = path.join(wsDir, "services", "storefront");
  const rbDir = path.join(wsDir, "services", "worker");
  const dartDir = path.join(wsDir, "apps", "cli");

  for (const d of [csDir, phpDir, rbDir, dartDir]) fs.mkdirSync(d, { recursive: true });

  fs.writeFileSync(
    path.join(wsDir, "poly.toml"),
    '[workspace]\nname = "phase2-multi"\nmembers = ["services/*", "apps/*"]\n',
  );

  fs.writeFileSync(
    path.join(csDir, "Billing.fsproj"),
    '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />\n  </ItemGroup>\n</Project>\n',
  );
  fs.writeFileSync(path.join(csDir, "packages.lock.json"), "{}");

  fs.writeFileSync(
    path.join(phpDir, "composer.json"),
    JSON.stringify({ require: { php: "^8.3", "monolog/monolog": "^3.5.0" } }, null, 2),
  );
  fs.writeFileSync(path.join(phpDir, "composer.lock"), "{}");

  fs.writeFileSync(
    path.join(rbDir, "Gemfile"),
    'source "https://rubygems.org"\ngem "sidekiq", "~> 7.2.0"\n',
  );
  fs.writeFileSync(path.join(rbDir, "Gemfile.lock"), "");

  fs.writeFileSync(
    path.join(dartDir, "pubspec.yaml"),
    "name: cli_tool\ndependencies:\n  http: ^1.1.0\n",
  );
  fs.writeFileSync(path.join(dartDir, "pubspec.lock"), "{}");

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("api.nuget.org/v3-flatcontainer/newtonsoft.json")) {
      return new Response(JSON.stringify({ versions: ["13.0.1", "13.0.3"] }), { status: 200 });
    }
    if (u.includes("api.nuget.org/v3/registration5-semver1/newtonsoft.json")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              items: [
                {
                  catalogEntry: {
                    version: "13.0.3",
                    published: "2024-01-01T00:00:00Z",
                    licenseExpression: "MIT",
                  },
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (u.includes("repo.packagist.org/p2/monolog/monolog.json")) {
      return new Response(
        JSON.stringify({
          packages: {
            "monolog/monolog": [
              { version: "3.8.0", time: "2025-01-01T00:00:00Z", license: ["MIT"] },
            ],
          },
        }),
        { status: 200 },
      );
    }
    if (u.includes("rubygems.org/api/v1/versions/sidekiq.json")) {
      return new Response(
        JSON.stringify([
          {
            number: "7.3.6",
            created_at: "2025-02-01T00:00:00Z",
            licenses: ["LGPL-3.0"],
            prerelease: false,
          },
        ]),
        { status: 200 },
      );
    }
    if (u.includes("pub.dev/api/packages/http")) {
      return new Response(
        JSON.stringify({
          latest: { version: "1.3.0", published: "2025-03-01T00:00:00Z" },
          versions: [{ version: "1.3.0", published: "2025-03-01T00:00:00Z" }],
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    // 1. Detector + Dispatcher
    assert.equal(detectContexts(csDir)[0]?.manifestFile, "Billing.fsproj");
    const dispatcher = new PolyDispatcher();
    assert.equal(dispatcher.which("nuget", csDir).effectiveCli, "dotnet");
    assert.equal(dispatcher.which("composer", phpDir).effectiveCli, "composer");
    assert.equal(dispatcher.which("gem", rbDir).effectiveCli, "bundle");
    assert.equal(dispatcher.which("pub", dartDir).effectiveCli, "dart");

    // 2. poly.lock generation & zero-drift verification
    const lock = writeCompositeLockfile(wsDir);
    assert.equal(lock.members.length, 4);
    assert.equal(verifyCompositeLockfile(wsDir).isDrifted, false);

    // 3. CycloneDX SBOM generation with canonical PURLs
    const sbom = JSON.parse(new SbomGenerator().generate(wsDir, { format: "cyclonedx" })) as {
      components: Array<{ purl: string }>;
    };
    const purls = sbom.components.map((c) => c.purl);
    assert.ok(purls.some((p) => p.startsWith("pkg:nuget/Newtonsoft.Json@13.0.1")));
    assert.ok(purls.some((p) => p.startsWith("pkg:composer/monolog/monolog@3.5.0")));
    assert.ok(purls.some((p) => p.startsWith("pkg:gem/sidekiq@7.2.0")));
    assert.ok(purls.some((p) => p.startsWith("pkg:pub/http@1.1.0")));

    // 4. Outdated & Firewall Registry Metadata lookups
    assert.equal(await fetchLatestVersion("Newtonsoft.Json", "nuget"), "13.0.3");
    assert.equal(await fetchLatestVersion("monolog/monolog", "composer"), "3.8.0");
    assert.equal(await fetchLatestVersion("sidekiq", "gem"), "7.3.6");
    assert.equal(await fetchLatestVersion("http", "pub"), "1.3.0");

    const nugetMeta = await fetchRegistryMetadata("nuget", "Newtonsoft.Json");
    assert.equal(nugetMeta?.versions["13.0.3"]?.license, "MIT");
    const composerMeta = await fetchRegistryMetadata("composer", "monolog/monolog");
    assert.equal(composerMeta?.latestVersion, "3.8.0");
    const gemMeta = await fetchRegistryMetadata("gem", "sidekiq");
    assert.equal(gemMeta?.versions["7.3.6"]?.license, "LGPL-3.0");
    const pubMeta = await fetchRegistryMetadata("pub", "http");
    assert.equal(pubMeta?.latestVersion, "1.3.0");

    const outdated = await scanOutdatedDependencies(wsDir);
    assert.equal(outdated.outdatedCount, 4);

    // 5. Upgrader manifest patching across all 4 formats
    assert.equal(
      patchManifestVersion(path.join(csDir, "Billing.fsproj"), "Newtonsoft.Json", "13.0.3"),
      true,
    );
    assert.equal(
      patchManifestVersion(path.join(phpDir, "composer.json"), "monolog/monolog", "3.8.0"),
      true,
    );
    assert.equal(patchManifestVersion(path.join(rbDir, "Gemfile"), "sidekiq", "7.3.6"), true);
    assert.equal(patchManifestVersion(path.join(dartDir, "pubspec.yaml"), "http", "1.3.0"), true);

    // Refresh poly.lock after manifest upgrades -> audit + doctor pass cleanly
    writeCompositeLockfile(wsDir);
    const audit = await new CrossStackAuditor().audit(wsDir);
    assert.equal(audit.scannedPackages, 4);

    const doctor = await new PolyDoctor().diagnose(wsDir);
    assert.equal(doctor.checks.find((c) => c.id === "workspace-lock-drift")?.status, "OK");
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
