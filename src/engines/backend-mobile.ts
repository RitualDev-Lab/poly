import fs from "node:fs";
import path from "node:path";
import type { EngineContext, PackageSpec } from "../types.js";
import { type EngineAdapter, defineDeclarativeAdapter } from "./declarative.js";

function isFlutterProject(ctx?: EngineContext): boolean {
  if (ctx?.preferredCli === "flutter") return true;
  if (ctx?.cwd) {
    const pubspec = path.join(ctx.cwd, ctx.manifest || "pubspec.yaml");
    if (fs.existsSync(pubspec)) {
      try {
        const content = fs.readFileSync(pubspec, "utf-8");
        if (/(?:sdk:\s*flutter|^\s*flutter:\s*$)/m.test(content)) {
          return true;
        }
      } catch {
        // Ignore read failure and fall back to dart
      }
    }
  }
  return false;
}

function isPaketProject(ctx?: EngineContext): boolean {
  return (
    ctx?.preferredCli === "paket" ||
    ctx?.manifest === "paket.dependencies" ||
    ctx?.lockfile === "paket.lock"
  );
}

function isGemCliProject(ctx?: EngineContext): boolean {
  if (ctx?.preferredCli === "gem") return true;
  if (ctx?.manifest?.endsWith(".gemspec") && ctx?.cwd) {
    return !fs.existsSync(path.join(ctx.cwd, "Gemfile"));
  }
  return false;
}

function isPearProject(ctx?: EngineContext): boolean {
  return ctx?.preferredCli === "pear" || ctx?.manifest === "package.xml";
}

function isProjectXmlManifest(manifest?: string): manifest is string {
  return Boolean(manifest && /\.(cs|fs|vb)proj$/i.test(manifest));
}

function formatScopedName(pkg: PackageSpec): string {
  return pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;
}

/** C# / .NET — NuGet (dotnet CLI) & Paket */
export const nugetAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "dotnet",
  ecosystem: "nuget",
  aliases: ["dotnet", "csharp", "paket"],
  purlTypes: ["nuget"],
  manifests: ["*.csproj", "*.fsproj", "*.vbproj", "paket.dependencies"],
  lockfiles: ["packages.lock.json", "paket.lock"],
  osvEcosystem: "NuGet",
  sbomPurlType: "nuget",
  supportedClis: ["dotnet", "paket"],
  commands: {
    command: (ctx) => (isPaketProject(ctx) ? "paket" : "dotnet"),
    add: (pkg, ctx) => {
      const cleanVer = pkg.version?.replace(/^[~^>=<]+/, "");
      if (isPaketProject(ctx)) {
        return ["add", pkg.name, ...(cleanVer ? ["--version", cleanVer] : [])];
      }
      const targetProj = isProjectXmlManifest(ctx?.manifest) ? [ctx.manifest] : [];
      return [
        "add",
        ...targetProj,
        "package",
        pkg.name,
        ...(cleanVer ? ["--version", cleanVer] : []),
      ];
    },
    remove: (pkg, ctx) => {
      if (isPaketProject(ctx)) {
        return ["remove", pkg.name];
      }
      const targetProj = isProjectXmlManifest(ctx?.manifest) ? [ctx.manifest] : [];
      return ["remove", ...targetProj, "package", pkg.name];
    },
    install: (ctx) => (isPaketProject(ctx) ? ["install"] : ["restore"]),
    update: (pkg, ctx) => {
      if (isPaketProject(ctx)) {
        return pkg ? ["update", pkg.name] : ["update"];
      }
      const targetProj = isProjectXmlManifest(ctx?.manifest) ? [ctx.manifest] : [];
      return pkg ? ["add", ...targetProj, "package", pkg.name] : ["restore", "--force"];
    },
  },
  resolveScriptCommand: (script) => {
    if (script === "test") return ["dotnet", ["test"]];
    if (script === "build") return ["dotnet", ["build"]];
    return ["dotnet", ["run"]];
  },
  injectRegistryEnv: (endpoint, env) => {
    env.NUGET_SOURCE = endpoint.url;
  },
  injectRegistryFlags: (endpoint, args) => {
    if ((args[0] === "add" || args[0] === "restore") && !args.includes("--source")) {
      args.push("--source", endpoint.url);
    }
  },
});

/** PHP — Composer (Packagist) & legacy PEAR fallback */
export const composerAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "composer",
  ecosystem: "composer",
  aliases: ["php", "packagist", "pear"],
  purlTypes: ["composer"],
  manifests: ["composer.json", "package.xml"],
  lockfiles: ["composer.lock"],
  osvEcosystem: "Packagist",
  sbomPurlType: "composer",
  supportedClis: ["composer", "pear"],
  commands: {
    command: (ctx) => (isPearProject(ctx) ? "pear" : "composer"),
    add: (pkg, ctx) => {
      const fullName = formatScopedName(pkg);
      if (isPearProject(ctx)) {
        return ["install", pkg.version ? `${fullName}-${pkg.version}` : fullName];
      }
      const target = pkg.version ? `${fullName}:${pkg.version}` : fullName;
      return ["require", target, ...(pkg.isDev ? ["--dev"] : [])];
    },
    remove: (pkg, ctx) => {
      const fullName = formatScopedName(pkg);
      if (isPearProject(ctx)) {
        return ["uninstall", fullName];
      }
      return ["remove", fullName, ...(pkg.isDev ? ["--dev"] : [])];
    },
    install: (ctx) => (isPearProject(ctx) ? ["install", "package.xml"] : ["install"]),
    update: (pkg, ctx) => {
      const fullName = pkg ? formatScopedName(pkg) : undefined;
      if (isPearProject(ctx)) {
        return fullName ? ["upgrade", fullName] : ["upgrade"];
      }
      return fullName ? ["update", fullName] : ["update"];
    },
  },
  resolveScriptCommand: (script) => ["composer", [script]],
  injectRegistryEnv: (endpoint, env) => {
    env.COMPOSER_MIRROR_URL = endpoint.url;
  },
});

/** Ruby — Bundler / RubyGems */
export const gemAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "bundler",
  ecosystem: "gem",
  aliases: ["ruby", "bundler", "rubygems"],
  purlTypes: ["gem"],
  manifests: ["Gemfile", "*.gemspec"],
  lockfiles: ["Gemfile.lock"],
  osvEcosystem: "RubyGems",
  sbomPurlType: "gem",
  supportedClis: ["bundle", "gem"],
  commands: {
    command: (ctx) => (isGemCliProject(ctx) ? "gem" : "bundle"),
    add: (pkg, ctx) => {
      if (isGemCliProject(ctx)) {
        return ["install", pkg.name, ...(pkg.version ? ["-v", pkg.version] : [])];
      }
      const args = ["add", pkg.name];
      if (pkg.version) args.push("--version", pkg.version);
      if (pkg.isDev) args.push("--group", "development");
      return args;
    },
    remove: (pkg, ctx) =>
      isGemCliProject(ctx) ? ["uninstall", "-x", pkg.name] : ["remove", pkg.name],
    install: () => ["install"],
    update: (pkg) => (pkg ? ["update", pkg.name] : ["update"]),
  },
  resolveScriptCommand: (script) => ["bundle", ["exec", script]],
  injectRegistryEnv: (endpoint, env) => {
    env.BUNDLE_MIRROR__ALL = endpoint.url;
  },
});

/** Dart / Flutter — Pub */
export const pubAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "pub",
  ecosystem: "pub",
  aliases: ["dart", "flutter"],
  purlTypes: ["pub"],
  manifests: ["pubspec.yaml"],
  lockfiles: ["pubspec.lock"],
  osvEcosystem: "Pub",
  sbomPurlType: "pub",
  supportedClis: ["dart", "flutter"],
  commands: {
    command: (ctx) => (isFlutterProject(ctx) ? "flutter" : "dart"),
    add: (pkg) => {
      const target = pkg.version ? `${pkg.name}:${pkg.version}` : pkg.name;
      return ["pub", "add", pkg.isDev ? `dev:${target}` : target];
    },
    remove: (pkg) => ["pub", "remove", pkg.name],
    install: () => ["pub", "get"],
    update: (pkg) => (pkg ? ["pub", "upgrade", pkg.name] : ["pub", "upgrade"]),
  },
  resolveScriptCommand: (script, ctx) =>
    isFlutterProject(ctx) ? ["flutter", [script]] : ["dart", [script]],
  injectRegistryEnv: (endpoint, env) => {
    env.PUB_HOSTED_URL = endpoint.url;
  },
});

export const BACKEND_MOBILE_ADAPTERS: readonly EngineAdapter[] = [
  nugetAdapter,
  composerAdapter,
  gemAdapter,
  pubAdapter,
];
