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
import { BaseEngine, engineRegistry } from "../src/engines/index.js";
import {
  mutateCartfile,
  mutatePackageSwift,
  mutatePodfile,
} from "../src/engines/mutators/apple.js";
import { mutateMixExs, mutateRebarConfig } from "../src/engines/mutators/elixir.js";
import {
  mutateGradleBuild,
  mutateGradleCatalog,
  mutateIvyXml,
  mutatePomXml,
  mutateSbtBuild,
} from "../src/engines/mutators/jvm.js";
import { fetchLatestVersion, scanOutdatedDependencies } from "../src/outdated/checker.js";
import { executeBatchUpgrade } from "../src/outdated/upgrader.js";
import { parsePackageSpec } from "../src/purl/parser.js";
import { fetchRegistryMetadata } from "../src/security/registry.js";
import { verifyCompositeLockfile, writeCompositeLockfile } from "../src/workspace/lockfile.js";

test("Phase 4 PURL - Parses Maven, Gradle, sbt, Hex, Rebar3, Swift, CocoaPods, Carthage specs", () => {
  const mvn = parsePackageSpec("maven:com.google.guava:guava@33.2.1-jre");
  assert.equal(mvn.ecosystem, "maven");
  assert.equal(mvn.name, "com.google.guava:guava");
  assert.equal(mvn.version, "33.2.1-jre");

  const mvnPurl = parsePackageSpec("pkg:maven/com.google.guava/guava@33.2.1-jre");
  assert.equal(mvnPurl.ecosystem, "maven");
  assert.equal(mvnPurl.name, "com.google.guava/guava");
  assert.equal(mvnPurl.version, "33.2.1-jre");

  const gradle = parsePackageSpec("gradle:io.ktor:ktor-server-core@3.0.0");
  assert.equal(gradle.ecosystem, "gradle");
  assert.equal(gradle.name, "io.ktor:ktor-server-core");

  const sbt = parsePackageSpec("sbt:org.typelevel:cats-core@2.12.0");
  assert.equal(sbt.ecosystem, "sbt");

  const hex = parsePackageSpec("pkg:hex/phoenix@1.7.14");
  assert.equal(hex.ecosystem, "hex");
  assert.equal(hex.name, "phoenix");
  assert.equal(hex.version, "1.7.14");

  const rebar = parsePackageSpec("rebar3:cowboy@2.12.0");
  assert.equal(rebar.ecosystem, "rebar3");
  assert.equal(rebar.name, "cowboy");

  const spm = parsePackageSpec("swift:apple/swift-nio@2.70.0");
  assert.equal(spm.ecosystem, "swift");
  assert.equal(spm.name, "apple/swift-nio");
  assert.equal(spm.version, "2.70.0");

  const pod = parsePackageSpec("cocoapods:Alamofire@5.9.1");
  assert.equal(pod.ecosystem, "cocoapods");
  assert.equal(pod.name, "Alamofire");

  const carthage = parsePackageSpec("carthage:Alamofire/Alamofire@5.9.1");
  assert.equal(carthage.ecosystem, "carthage");
});

test("Phase 4 Mutators - Safe, idempotent JVM AST/manifest edits (pom.xml, ivy.xml, libs.versions.toml, build.gradle(.kts), build.sbt)", () => {
  const origPom = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<project>",
    "    <dependencies>",
    "        <dependency>",
    "            <groupId>org.slf4j</groupId>",
    "            <artifactId>slf4j-api</artifactId>",
    "            <version>2.0.12</version>",
    "        </dependency>",
    "    </dependencies>",
    "</project>",
    "",
  ].join("\n");

  const guava = parsePackageSpec("maven:com.google.guava:guava@33.1.0-jre");
  const pomAdded = mutatePomXml(origPom, "add", guava);
  assert.ok(pomAdded.includes("<groupId>com.google.guava</groupId>"));
  assert.ok(pomAdded.includes("<version>33.1.0-jre</version>"));
  assert.ok(pomAdded.includes("    </dependencies>"));
  // Idempotent on repeat add
  assert.equal(mutatePomXml(pomAdded, "add", guava), pomAdded);
  // Upsert updates version cleanly
  const guavaUp = parsePackageSpec("maven:com.google.guava:guava@33.2.1-jre");
  const pomUpdated = mutatePomXml(pomAdded, "add", guavaUp);
  assert.ok(pomUpdated.includes("<version>33.2.1-jre</version>"));
  assert.ok(!pomUpdated.includes("<version>33.1.0-jre</version>"));
  // Clean removal restores original pom.xml
  assert.equal(mutatePomXml(pomUpdated, "remove", guavaUp), origPom);

  // Ivy XML
  const origIvy = "<ivy-module>\n    <dependencies>\n    </dependencies>\n</ivy-module>\n";
  const ivyAdded = mutateIvyXml(origIvy, "add", guava);
  assert.ok(ivyAdded.includes('org="com.google.guava" name="guava" rev="33.1.0-jre"'));
  assert.equal(mutateIvyXml(ivyAdded, "add", guava), ivyAdded);
  assert.equal(mutateIvyXml(ivyAdded, "remove", guava), origIvy);

  // Gradle Version Catalog (libs.versions.toml)
  const origCatalog = '[versions]\nkotlin = "2.0.20"\n\n[libraries]\n';
  const catalogAdded = mutateGradleCatalog(origCatalog, "add", guava);
  assert.ok(catalogAdded.includes('guava = "33.1.0-jre"'));
  assert.ok(
    catalogAdded.includes(
      'guava = { group = "com.google.guava", name = "guava", version.ref = "guava" }',
    ),
  );
  assert.equal(mutateGradleCatalog(catalogAdded, "add", guava), catalogAdded);
  assert.equal(mutateGradleCatalog(catalogAdded, "remove", guava), origCatalog);

  // build.gradle.kts
  const origKts = 'dependencies {\n    implementation("org.slf4j:slf4j-api:2.0.12")\n}\n';
  const ktsAdded = mutateGradleBuild(origKts, "add", guava, true);
  assert.ok(ktsAdded.includes('    implementation("com.google.guava:guava:33.1.0-jre")'));
  assert.equal(mutateGradleBuild(ktsAdded, "add", guava, true), ktsAdded);
  assert.equal(mutateGradleBuild(ktsAdded, "remove", guava, true), origKts);

  // build.sbt
  const origSbt = 'name := "demo"\n';
  const cats = parsePackageSpec("sbt:org.typelevel:cats-core@2.12.0");
  const sbtAdded = mutateSbtBuild(origSbt, "add", cats);
  assert.ok(sbtAdded.includes('libraryDependencies += "org.typelevel" %% "cats-core" % "2.12.0"'));
  assert.equal(mutateSbtBuild(sbtAdded, "add", cats), sbtAdded);
  assert.equal(mutateSbtBuild(sbtAdded, "remove", cats), origSbt);
});

test("Phase 4 Mutators - Safe, idempotent Elixir/Erlang & Apple/Swift manifest edits", () => {
  const origMix = [
    "defmodule Demo.MixProject do",
    "  use Mix.Project",
    "",
    "  defp deps do",
    "    [",
    '      {:jason, "~> 1.4"}',
    "    ]",
    "  end",
    "end",
    "",
  ].join("\n");
  const phoenix = parsePackageSpec("hex:phoenix@1.7.14");
  const mixAdded = mutateMixExs(origMix, "add", phoenix);
  assert.ok(mixAdded.includes('{:jason, "~> 1.4"},'));
  assert.ok(mixAdded.includes('{:phoenix, "~> 1.7.14"}'));
  assert.equal(mutateMixExs(mixAdded, "add", phoenix), mixAdded);
  const mixRemoved = mutateMixExs(mixAdded, "remove", phoenix);
  assert.ok(!mixRemoved.includes(":phoenix"));
  assert.ok(mixRemoved.includes(":jason"));

  // Rebar3
  const origRebar = '{deps, [\n  {jsx, "3.1.0"}\n]}.\n';
  const cowboy = parsePackageSpec("rebar3:cowboy@2.12.0");
  const rebarAdded = mutateRebarConfig(origRebar, "add", cowboy);
  assert.ok(rebarAdded.includes('{cowboy, "2.12.0"}'));
  assert.equal(mutateRebarConfig(rebarAdded, "add", cowboy), rebarAdded);
  assert.ok(!mutateRebarConfig(rebarAdded, "remove", cowboy).includes("cowboy"));

  // Package.swift
  const origSwift = [
    "// swift-tools-version: 5.9",
    "import PackageDescription",
    "",
    "let package = Package(",
    '    name: "App",',
    "    dependencies: [",
    "    ],",
    "    targets: [",
    "        .executableTarget(",
    '            name: "App",',
    "            dependencies: [",
    "            ]",
    "        )",
    "    ]",
    ")",
    "",
  ].join("\n");
  const nio = parsePackageSpec("swift:apple/swift-nio@2.70.0");
  const swiftAdded = mutatePackageSwift(origSwift, "add", nio);
  assert.ok(
    swiftAdded.includes('.package(url: "https://github.com/apple/swift-nio.git", from: "2.70.0"),'),
  );
  assert.ok(swiftAdded.includes('.product(name: "swift-nio", package: "swift-nio"),'));
  assert.equal(mutatePackageSwift(swiftAdded, "add", nio), swiftAdded);
  assert.equal(mutatePackageSwift(swiftAdded, "remove", nio), origSwift);

  // Podfile & Cartfile
  const origPodfile = "platform :ios, '15.0'\ntarget 'MyApp' do\nend\n";
  const pod = parsePackageSpec("cocoapods:Alamofire@5.9.1");
  const podAdded = mutatePodfile(origPodfile, "add", pod);
  assert.ok(podAdded.includes("  pod 'Alamofire', '~> 5.9.1'"));
  assert.equal(mutatePodfile(podAdded, "add", pod), podAdded);
  assert.equal(mutatePodfile(podAdded, "remove", pod), origPodfile);

  const origCart = 'github "ReactiveX/RxSwift" ~> 6.7.0\n';
  const cartPkg = parsePackageSpec("carthage:Alamofire/Alamofire@5.9.1");
  const cartAdded = mutateCartfile(origCart, "add", cartPkg);
  assert.ok(cartAdded.includes('github "Alamofire/Alamofire" ~> 5.9.1'));
  assert.equal(mutateCartfile(cartAdded, "add", cartPkg), cartAdded);
  assert.equal(mutateCartfile(cartAdded, "remove", cartPkg), origCart);
});

test("Phase 4 Dispatcher - Mutates manifests before executing add/remove CLIs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase4-disp-"));
  const pomDir = path.join(dir, "mvn");
  const mixDir = path.join(dir, "elixir");
  const swiftDir = path.join(dir, "swift");
  for (const d of [pomDir, mixDir, swiftDir]) fs.mkdirSync(d, { recursive: true });

  fs.writeFileSync(
    path.join(pomDir, "pom.xml"),
    "<project>\n    <dependencies>\n    </dependencies>\n</project>\n",
  );
  fs.writeFileSync(
    path.join(mixDir, "mix.exs"),
    "defmodule App.MixProject do\n  defp deps do\n    []\n  end\nend\n",
  );
  fs.writeFileSync(
    path.join(swiftDir, "Package.swift"),
    'let package = Package(\n    dependencies: [],\n    targets: [\n        .target(name: "App", dependencies: [])\n    ]\n)\n',
  );

  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const origExec = BaseEngine.prototype.execute;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  BaseEngine.prototype.execute = async function (command, args, cwd) {
    calls.push({ command, args, cwd });
    return { engine: this.name, command, args, exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  };

  try {
    const dispatcher = new PolyDispatcher();
    await dispatcher.add("maven:org.slf4j:slf4j-api@2.0.12", {
      cwd: pomDir,
      silent: true,
      allowUntested: true,
    });
    assert.ok(fs.readFileSync(path.join(pomDir, "pom.xml"), "utf-8").includes("slf4j-api"));
    assert.deepEqual(calls[0]?.args, ["dependency:resolve"]);

    await dispatcher.add("hex:phoenix@1.7.14", { cwd: mixDir, silent: true, allowUntested: true });
    assert.ok(fs.readFileSync(path.join(mixDir, "mix.exs"), "utf-8").includes(":phoenix"));
    assert.deepEqual(calls[1]?.args, ["deps.get"]);

    await dispatcher.add("swift:apple/swift-nio@2.70.0", {
      cwd: swiftDir,
      silent: true,
      allowUntested: true,
    });
    assert.ok(fs.readFileSync(path.join(swiftDir, "Package.swift"), "utf-8").includes("swift-nio"));
    assert.deepEqual(calls[2]?.args, ["package", "resolve"]);

    await dispatcher.remove("hex:phoenix", { cwd: mixDir, silent: true });
    assert.ok(!fs.readFileSync(path.join(mixDir, "mix.exs"), "utf-8").includes(":phoenix"));
    assert.deepEqual(calls[3]?.args, ["deps.clean", "phoenix", "--unlock"]);
  } finally {
    BaseEngine.prototype.execute = origExec;
    globalThis.fetch = origFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Phase 4 Integration - Registries, outdated/upgrader, poly.lock, OSV (Maven/Hex/SwiftURL), SBOM & Doctor", async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-phase4-ws-"));
  const mvnDir = path.join(wsDir, "svc-maven");
  const gradleDir = path.join(wsDir, "svc-gradle");
  const sbtDir = path.join(wsDir, "svc-sbt");
  const hexDir = path.join(wsDir, "svc-elixir");
  const swiftDir = path.join(wsDir, "app-swift");
  const podDir = path.join(wsDir, "app-ios");

  for (const d of [mvnDir, gradleDir, sbtDir, hexDir, swiftDir, podDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.mkdirSync(path.join(gradleDir, "gradle"), { recursive: true });

  fs.writeFileSync(
    path.join(mvnDir, "pom.xml"),
    "<project>\n    <dependencies>\n        <dependency>\n            <groupId>com.google.guava</groupId>\n            <artifactId>guava</artifactId>\n            <version>32.1.0-jre</version>\n        </dependency>\n    </dependencies>\n</project>\n",
  );
  fs.writeFileSync(path.join(gradleDir, "build.gradle.kts"), 'plugins { kotlin("jvm") }\n');
  fs.writeFileSync(
    path.join(gradleDir, "gradle", "libs.versions.toml"),
    '[versions]\nktor = "2.3.0"\n\n[libraries]\nktor-core = { group = "io.ktor", name = "ktor-server-core", version.ref = "ktor" }\n',
  );
  fs.writeFileSync(
    path.join(sbtDir, "build.sbt"),
    'libraryDependencies += "org.typelevel" %% "cats-core" % "2.10.0"\n',
  );
  fs.writeFileSync(
    path.join(hexDir, "mix.exs"),
    'defmodule Svc.MixProject do\n  defp deps do\n    [\n      {:phoenix, "~> 1.7.10"}\n    ]\n  end\nend\n',
  );
  fs.writeFileSync(path.join(hexDir, "mix.lock"), '%{"phoenix": {:hex, :phoenix, "1.7.10"}}');
  fs.writeFileSync(
    path.join(swiftDir, "Package.swift"),
    'let package = Package(\n    dependencies: [\n        .package(url: "https://github.com/apple/swift-nio.git", from: "2.60.0")\n    ]\n)\n',
  );
  fs.writeFileSync(path.join(swiftDir, "Package.resolved"), '{"version":2}');
  fs.writeFileSync(
    path.join(podDir, "Podfile"),
    "target 'Mobile' do\n  pod 'Alamofire', '~> 5.8.0'\nend\n",
  );

  const osvQueries: Array<{ package?: { name?: string; ecosystem?: string }; version?: string }> =
    [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (u.includes("search.maven.org/solrsearch/select")) {
      return new Response(
        JSON.stringify({
          response: {
            docs: [
              {
                v: u.includes("ktor-server-core")
                  ? "3.0.0"
                  : u.includes("cats-core")
                    ? "2.12.0"
                    : "33.2.1",
                timestamp: 1730000000000,
              },
            ],
          },
        }),
        { status: 200 },
      );
    }
    if (u.includes("hex.pm/api/packages/phoenix")) {
      return new Response(
        JSON.stringify({
          latest_stable_version: "1.7.14",
          meta: { licenses: ["MIT"] },
          releases: [{ version: "1.7.14", inserted_at: "2025-01-01T00:00:00Z" }],
        }),
        { status: 200 },
      );
    }
    if (u.includes("trunk.cocoapods.org/api/v1/pods/Alamofire")) {
      return new Response(
        JSON.stringify({
          versions: [{ name: "5.9.1", created_at: "2025-02-01T00:00:00Z" }],
        }),
        { status: 200 },
      );
    }
    if (u.includes("api.github.com/repos/apple/swift-nio/tags")) {
      return new Response(JSON.stringify([{ name: "2.70.0" }]), { status: 200 });
    }
    if (u.includes("api.osv.dev/v1/querybatch")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        queries?: Array<{ package?: { name?: string; ecosystem?: string }; version?: string }>;
      };
      const queries = body.queries ?? [];
      osvQueries.push(...queries);
      const results = queries.map((q) =>
        q.package?.ecosystem === "Maven" && q.package?.name === "com.google.guava:guava"
          ? { vulns: [{ id: "GHSA-maven-guava-test", summary: "Mock Maven advisory" }] }
          : {},
      );
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    // 1. Detector + Dispatcher CLI resolution
    assert.equal(detectContexts(mvnDir)[0]?.manifestFile, "pom.xml");
    assert.equal(detectContexts(gradleDir)[0]?.ecosystem, "gradle");
    assert.equal(detectContexts(sbtDir)[0]?.manifestFile, "build.sbt");
    assert.equal(detectContexts(hexDir)[0]?.manifestFile, "mix.exs");
    assert.equal(detectContexts(swiftDir)[0]?.manifestFile, "Package.swift");
    assert.equal(detectContexts(podDir)[0]?.manifestFile, "Podfile");

    assert.equal(engineRegistry.createEngine("maven").getEffectiveCli(), "mvn");
    assert.equal(engineRegistry.createEngine("gradle").getEffectiveCli(), "gradle");
    assert.equal(engineRegistry.createEngine("hex").getEffectiveCli(), "mix");
    assert.equal(engineRegistry.createEngine("swift").getEffectiveCli(), "swift");

    // 2. poly.lock + CycloneDX SBOM (canonical PURLs including pkg:maven/g/a)
    const lock = writeCompositeLockfile(wsDir);
    assert.equal(lock.members.length, 6);
    assert.equal(verifyCompositeLockfile(wsDir).isDrifted, false);

    const sbom = JSON.parse(new SbomGenerator().generate(wsDir, { format: "cyclonedx" })) as {
      components: Array<{ purl: string }>;
    };
    const purls = sbom.components.map((c) => c.purl);
    assert.ok(purls.some((p) => p.startsWith("pkg:maven/com.google.guava/guava@32.1.0-jre")));
    assert.ok(purls.some((p) => p.startsWith("pkg:maven/io.ktor/ktor-server-core@2.3.0")));
    assert.ok(purls.some((p) => p.startsWith("pkg:hex/phoenix@1.7.10")));
    assert.ok(purls.some((p) => p.startsWith("pkg:swift/github.com/apple/swift-nio@2.60.0")));

    // 3. Registry Metadata + Outdated Scan + Batch Manifest Upgrade
    assert.equal(await fetchLatestVersion("com.google.guava:guava", "maven"), "33.2.1");
    assert.equal(await fetchLatestVersion("phoenix", "hex"), "1.7.14");
    assert.equal(await fetchLatestVersion("Alamofire", "cocoapods"), "5.9.1");
    assert.equal(await fetchLatestVersion("github.com/apple/swift-nio", "swift"), "2.70.0");

    const hexMeta = await fetchRegistryMetadata("hex", "phoenix");
    assert.equal(hexMeta?.versions["1.7.14"]?.license, "MIT");
    const mavenMeta = await fetchRegistryMetadata("maven", "com.google.guava:guava");
    assert.equal(mavenMeta?.latestVersion, "33.2.1");

    const outdated = await scanOutdatedDependencies(wsDir);
    assert.ok(outdated.outdatedCount >= 4);

    const upgraded = await executeBatchUpgrade(wsDir, {
      packages: ["com.google.guava:guava", "phoenix", "github.com/apple/swift-nio", "Alamofire"],
    });
    assert.equal(upgraded.totalUpgraded, 4);
    assert.equal(upgraded.lockfileUpdated, true);
    assert.ok(fs.readFileSync(path.join(mvnDir, "pom.xml"), "utf-8").includes("33.2.1"));
    assert.ok(fs.readFileSync(path.join(hexDir, "mix.exs"), "utf-8").includes("1.7.14"));
    assert.ok(fs.readFileSync(path.join(swiftDir, "Package.swift"), "utf-8").includes("2.70.0"));
    assert.ok(fs.readFileSync(path.join(podDir, "Podfile"), "utf-8").includes("5.9.1"));

    // 4. OSV audit maps Maven, Hex, SwiftURL while skipping CocoaPods gracefully
    const audit = await new CrossStackAuditor().audit(wsDir);
    assert.ok(osvQueries.some((q) => q.package?.ecosystem === "Maven"));
    assert.ok(
      osvQueries.some((q) => q.package?.ecosystem === "Hex" && q.package?.name === "phoenix"),
    );
    assert.ok(
      osvQueries.some(
        (q) =>
          q.package?.ecosystem === "SwiftURL" && q.package?.name === "github.com/apple/swift-nio",
      ),
    );
    assert.ok(!osvQueries.some((q) => q.package?.ecosystem === "cocoapods"));
    assert.ok(audit.findings.some((f) => f.id === "GHSA-maven-guava-test"));

    const doctor = await new PolyDoctor().diagnose(wsDir);
    assert.equal(doctor.checks.find((c) => c.id === "workspace-lock-drift")?.status, "OK");
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
