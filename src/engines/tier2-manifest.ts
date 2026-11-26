import fs from "node:fs";
import path from "node:path";
import type { EngineContext, PackageSpec } from "../types.js";
import { type EngineAdapter, defineDeclarativeAdapter } from "./declarative.js";
import {
  mutateCartfile,
  mutatePackageSwift,
  mutatePodfile,
  normalizeSwiftPackageSpec,
} from "./mutators/apple.js";
import { mutateMixExs, mutateRebarConfig } from "./mutators/elixir.js";
import { applyManifestTransform } from "./mutators/file-helpers.js";
import {
  mutateGradleBuild,
  mutateGradleCatalog,
  mutateIvyXml,
  mutatePomXml,
  mutateSbtBuild,
  parseJvmCoordinates,
} from "./mutators/jvm.js";

function isIvyProject(ctx?: EngineContext): boolean {
  return ctx?.preferredCli === "ant" || ctx?.manifest === "ivy.xml";
}

function getMavenBinary(ctx?: EngineContext): string {
  if (
    ctx?.cwd &&
    fs.existsSync(path.join(ctx.cwd, process.platform === "win32" ? "mvnw.cmd" : "mvnw"))
  ) {
    return process.platform === "win32" ? "mvnw.cmd" : "./mvnw";
  }
  return "mvn";
}

function getGradleBinary(ctx?: EngineContext): string {
  if (
    ctx?.cwd &&
    fs.existsSync(path.join(ctx.cwd, process.platform === "win32" ? "gradlew.bat" : "gradlew"))
  ) {
    return process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  }
  return "gradle";
}

/** Java / JVM — Maven (pom.xml) & Apache Ivy (ivy.xml) */
export const mavenAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "maven",
  ecosystem: "maven",
  aliases: ["mvn", "java", "jvm", "ivy"],
  purlTypes: ["maven"],
  manifests: ["pom.xml", "ivy.xml"],
  lockfiles: [],
  osvEcosystem: "Maven",
  sbomPurlType: "maven",
  supportedClis: ["mvn", "ant"],
  commands: {
    command: (ctx) => (isIvyProject(ctx) ? "ant" : getMavenBinary(ctx)),
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "pom.xml", "ivy.xml"], (content, full) =>
        full.endsWith("ivy.xml")
          ? mutateIvyXml(content, "add", pkg)
          : mutatePomXml(content, "add", pkg),
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "pom.xml", "ivy.xml"], (content, full) =>
        full.endsWith("ivy.xml")
          ? mutateIvyXml(content, "remove", pkg)
          : mutatePomXml(content, "remove", pkg),
      ),
    add: (_pkg, ctx) => (isIvyProject(ctx) ? ["resolve"] : ["dependency:resolve"]),
    remove: (_pkg, ctx) => (isIvyProject(ctx) ? ["resolve"] : ["dependency:resolve"]),
    install: (ctx) => (isIvyProject(ctx) ? ["resolve"] : ["dependency:resolve"]),
    update: (pkg, ctx) => {
      if (isIvyProject(ctx)) return ["resolve"];
      if (pkg) {
        const { groupId, artifactId } = parseJvmCoordinates(pkg);
        return ["versions:use-latest-versions", `-Dincludes=${groupId}:${artifactId}`];
      }
      return ["versions:use-latest-releases"];
    },
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["mvn", ["test"]] : ["mvn", ["package", "-DskipTests"]],
  injectRegistryEnv: (endpoint, env) => {
    env.MAVEN_ARGS = `-Dmaven.repo.remote=${endpoint.url}`;
  },
});

/** Java / Kotlin — Gradle (gradle/libs.versions.toml Version Catalogs + build.gradle(.kts)) */
export const gradleAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "gradle",
  ecosystem: "gradle",
  aliases: ["kts", "kotlin"],
  purlTypes: ["gradle"],
  manifests: ["build.gradle.kts", "build.gradle", "gradle/libs.versions.toml"],
  lockfiles: ["gradle.lockfile"],
  osvEcosystem: "Maven",
  sbomPurlType: "maven",
  supportedClis: ["gradle"],
  commands: {
    command: (ctx) => getGradleBinary(ctx),
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(
        cwd,
        [ctx?.manifest ?? "", "gradle/libs.versions.toml", "build.gradle.kts", "build.gradle"],
        (content, full) => {
          if (full.endsWith("libs.versions.toml")) {
            return mutateGradleCatalog(content, "add", pkg);
          }
          return mutateGradleBuild(content, "add", pkg, full.endsWith(".kts"));
        },
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(
        cwd,
        [ctx?.manifest ?? "", "gradle/libs.versions.toml", "build.gradle.kts", "build.gradle"],
        (content, full) => {
          if (full.endsWith("libs.versions.toml")) {
            return mutateGradleCatalog(content, "remove", pkg);
          }
          return mutateGradleBuild(content, "remove", pkg, full.endsWith(".kts"));
        },
      ),
    add: () => ["dependencies", "--refresh-dependencies"],
    remove: () => ["--refresh-dependencies"],
    install: () => ["--refresh-dependencies"],
    update: () => ["--refresh-dependencies"],
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["gradle", ["test"]] : ["gradle", [script]],
});

/** Scala / JVM — sbt (build.sbt) */
export const sbtAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "sbt",
  ecosystem: "sbt",
  aliases: ["scala"],
  purlTypes: ["sbt"],
  manifests: ["build.sbt"],
  lockfiles: [],
  osvEcosystem: "Maven",
  sbomPurlType: "maven",
  supportedClis: ["sbt"],
  commands: {
    command: "sbt",
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "build.sbt"], (content) =>
        mutateSbtBuild(content, "add", pkg),
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "build.sbt"], (content) =>
        mutateSbtBuild(content, "remove", pkg),
      ),
    add: () => ["update"],
    remove: () => ["update"],
    install: () => ["update"],
    update: () => ["update"],
  },
  resolveScriptCommand: (script) => (script === "test" ? ["sbt", ["test"]] : ["sbt", [script]]),
});

/** Elixir — Mix / Hex (mix.exs + mix.lock) */
export const hexAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "mix",
  ecosystem: "hex",
  aliases: ["elixir", "mix"],
  purlTypes: ["hex"],
  manifests: ["mix.exs"],
  lockfiles: ["mix.lock"],
  osvEcosystem: "Hex",
  sbomPurlType: "hex",
  supportedClis: ["mix"],
  commands: {
    command: "mix",
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "mix.exs"], (content) =>
        mutateMixExs(content, "add", pkg),
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "mix.exs"], (content) =>
        mutateMixExs(content, "remove", pkg),
      ),
    add: () => ["deps.get"],
    remove: (pkg) => ["deps.clean", pkg.name, "--unlock"],
    install: () => ["deps.get"],
    update: (pkg) => (pkg ? ["deps.update", pkg.name] : ["deps.update", "--all"]),
  },
  resolveScriptCommand: (script) => ["mix", [script]],
  injectRegistryEnv: (endpoint, env) => {
    env.HEX_MIRROR = endpoint.url;
  },
});

/** Erlang — Rebar3 (rebar.config + rebar.lock) */
export const rebar3Adapter: EngineAdapter = defineDeclarativeAdapter({
  id: "rebar3",
  ecosystem: "rebar3",
  aliases: ["erlang", "rebar"],
  purlTypes: ["rebar3"],
  manifests: ["rebar.config"],
  lockfiles: ["rebar.lock"],
  osvEcosystem: "Hex",
  sbomPurlType: "hex",
  supportedClis: ["rebar3"],
  commands: {
    command: "rebar3",
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "rebar.config"], (content) =>
        mutateRebarConfig(content, "add", pkg),
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "rebar.config"], (content) =>
        mutateRebarConfig(content, "remove", pkg),
      ),
    add: () => ["get-deps"],
    remove: () => ["unlock"],
    install: () => ["get-deps"],
    update: (pkg) => (pkg ? ["upgrade", pkg.name] : ["upgrade"]),
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["rebar3", ["eunit"]] : ["rebar3", [script]],
});

/** Apple / Swift — Swift Package Manager (Package.swift + Package.resolved) */
export const swiftAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "swift",
  ecosystem: "swift",
  aliases: ["spm", "swiftpm"],
  purlTypes: ["swift"],
  manifests: ["Package.swift"],
  lockfiles: ["Package.resolved"],
  osvEcosystem: "SwiftURL",
  sbomPurlType: "swift",
  supportedClis: ["swift"],
  commands: {
    command: "swift",
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "Package.swift"], (content) =>
        mutatePackageSwift(content, "add", pkg),
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "Package.swift"], (content) =>
        mutatePackageSwift(content, "remove", pkg),
      ),
    add: () => ["package", "resolve"],
    remove: () => ["package", "resolve"],
    install: () => ["package", "resolve"],
    update: (pkg) =>
      pkg
        ? ["package", "update", normalizeSwiftPackageSpec(pkg).packageName]
        : ["package", "update"],
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["swift", ["test"]] : ["swift", ["build"]],
});

/** Apple / iOS / macOS — CocoaPods (Podfile + Podfile.lock) */
export const cocoapodsAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "cocoapods",
  ecosystem: "cocoapods",
  aliases: ["pod", "pods"],
  purlTypes: ["cocoapods"],
  manifests: ["Podfile", "*.podspec"],
  lockfiles: ["Podfile.lock"],
  osvEcosystem: undefined,
  sbomPurlType: "cocoapods",
  supportedClis: ["pod"],
  commands: {
    command: "pod",
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "Podfile"], (content) =>
        mutatePodfile(content, "add", pkg),
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "Podfile"], (content) =>
        mutatePodfile(content, "remove", pkg),
      ),
    add: () => ["install"],
    remove: () => ["install"],
    install: () => ["install"],
    update: (pkg) => (pkg ? ["update", pkg.name] : ["update"]),
  },
});

/** Apple / iOS — Carthage (Cartfile + Cartfile.resolved) */
export const carthageAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "carthage",
  ecosystem: "carthage",
  aliases: [],
  purlTypes: ["carthage"],
  manifests: ["Cartfile"],
  lockfiles: ["Cartfile.resolved"],
  osvEcosystem: undefined,
  sbomPurlType: "github",
  supportedClis: ["carthage"],
  commands: {
    command: "carthage",
    mutateAdd: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "Cartfile"], (content) =>
        mutateCartfile(content, "add", pkg),
      ),
    mutateRemove: (pkg, cwd, ctx) =>
      applyManifestTransform(cwd, [ctx?.manifest ?? "", "Cartfile"], (content) =>
        mutateCartfile(content, "remove", pkg),
      ),
    add: () => ["bootstrap"],
    remove: () => ["update"],
    install: () => ["bootstrap"],
    update: (pkg) => (pkg ? ["update", pkg.name] : ["update"]),
  },
});

export const TIER2_MANIFEST_ADAPTERS: readonly EngineAdapter[] = [
  mavenAdapter,
  gradleAdapter,
  sbtAdapter,
  hexAdapter,
  rebar3Adapter,
  swiftAdapter,
  cocoapodsAdapter,
  carthageAdapter,
];
