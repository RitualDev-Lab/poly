import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Ecosystem } from "../types.js";

export interface ParsedManifestDep {
  name: string;
  version: string;
  ecosystem: Ecosystem;
}

/**
 * Extracts dependency name/version pairs for Phase 2 backend & mobile ecosystems
 * (NuGet/Paket, Composer, RubyGems/Bundler, Dart/Flutter Pub).
 */
export function extractBackendMobileDependencies(
  manifestPath: string,
  content: string,
  ecosystem: Ecosystem,
): ParsedManifestDep[] {
  const deps: ParsedManifestDep[] = [];
  const fileName = path.basename(manifestPath);

  if (ecosystem === "nuget") {
    if (/\.(cs|fs|vb)proj$/i.test(fileName)) {
      const refTags = content.match(/<PackageReference\b[^>]*>/gi) ?? [];
      for (const tag of refTags) {
        const inc = tag.match(/\bInclude=["']([^"']+)["']/i)?.[1];
        const ver = tag.match(/\bVersion=["']([^"']+)["']/i)?.[1];
        if (inc) {
          deps.push({ name: inc.trim(), version: (ver || "latest").trim(), ecosystem: "nuget" });
        }
      }
    } else if (fileName === "paket.dependencies") {
      for (const line of content.split("\n")) {
        const match = line.trim().match(/^nuget\s+([^\s]+)(?:\s+(.+))?$/i);
        if (match) {
          deps.push({
            name: match[1].trim(),
            version: (match[2] || "latest").trim(),
            ecosystem: "nuget",
          });
        }
      }
    }
  } else if (ecosystem === "composer" && fileName === "composer.json") {
    try {
      const json = JSON.parse(content) as {
        require?: Record<string, string>;
        "require-dev"?: Record<string, string>;
      };
      for (const section of [json.require, json["require-dev"]]) {
        if (!section) continue;
        for (const [name, ver] of Object.entries(section)) {
          if (name === "php" || name === "composer-plugin-api" || /^(ext|lib)-/i.test(name)) {
            continue;
          }
          deps.push({ name, version: String(ver), ecosystem: "composer" });
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  } else if (ecosystem === "gem") {
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const gemMatch =
        fileName === "Gemfile"
          ? trimmed.match(/^gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/)
          : trimmed.match(
              /\.add_(?:runtime_|development_)?dependency\s*\(?\s*["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/,
            );
      if (gemMatch) {
        deps.push({
          name: gemMatch[1],
          version: (gemMatch[2] || "latest").trim(),
          ecosystem: "gem",
        });
      }
    }
  } else if (ecosystem === "pub" && fileName === "pubspec.yaml") {
    let inDeps = false;
    for (const rawLine of content.split("\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = rawLine.search(/\S|$/);
      if (indent === 0) {
        inDeps = trimmed === "dependencies:" || trimmed === "dev_dependencies:";
        continue;
      }
      if (!inDeps || indent !== 2) continue;
      if (trimmed.startsWith("flutter:") || trimmed.startsWith("sdk:")) continue;
      const depMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*([^\s#]+)?/);
      if (depMatch && depMatch[1] !== "flutter" && depMatch[1] !== "flutter_test") {
        const ver = depMatch[2]?.replace(/["']/g, "") || "any";
        deps.push({ name: depMatch[1], version: ver, ecosystem: "pub" });
      }
    }
  }

  return deps;
}

/**
 * Computes a standardized SHA-256 digest of a file.
 */
export function computeFileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Extracts top-level direct dependencies from native manifest files.
 */
export function extractDirectDependencies(manifestPath: string, ecosystem: Ecosystem): string[] {
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const content = fs.readFileSync(manifestPath, "utf-8");
  const deps: string[] = [];

  switch (ecosystem) {
    case "npm": {
      try {
        const json = JSON.parse(content);
        if (json.dependencies) {
          for (const [name, ver] of Object.entries(json.dependencies)) {
            deps.push(`npm:${name}@${ver}`);
          }
        }
        if (json.devDependencies) {
          for (const [name, ver] of Object.entries(json.devDependencies)) {
            deps.push(`npm:${name}@${ver}`);
          }
        }
      } catch {
        // Ignore JSON parse errors in malformed manifests
      }
      break;
    }

    case "jsr": {
      // Parse deno.json / deno.jsonc imports map (jsr:@std/path@^1.0.0, npm:zod@^3.22.0)
      try {
        const cleanJson = content.replace(/^\s*\/\/.*$/gm, "");
        const parsed = JSON.parse(cleanJson) as { imports?: Record<string, string> };
        for (const target of Object.values(parsed.imports ?? {})) {
          if (
            typeof target === "string" &&
            (target.startsWith("jsr:") || target.startsWith("npm:"))
          ) {
            deps.push(target);
          }
        }
      } catch {
        // Ignore malformed deno.json/jsonc
      }
      break;
    }

    case "pypi": {
      const fileName = path.basename(manifestPath);
      const lines = content.split("\n");

      if (fileName === "Pipfile") {
        let inPackages = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "[packages]" || trimmed === "[dev-packages]") {
            inPackages = true;
            continue;
          }
          if (trimmed.startsWith("[")) {
            inPackages = false;
            continue;
          }
          if (inPackages && trimmed && !trimmed.startsWith("#")) {
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx !== -1) {
              const name = trimmed.substring(0, eqIdx).trim().replace(/["']/g, "");
              const rawVer = trimmed
                .substring(eqIdx + 1)
                .trim()
                .replace(/["']/g, "");
              if (name) {
                deps.push(rawVer && rawVer !== "*" ? `pypi:${name}${rawVer}` : `pypi:${name}`);
              }
            }
          }
        }
        break;
      }

      // Parse dependencies = [ "fastapi>=0.110.0", ... ] in pyproject.toml or requirements.txt
      let inDepsSection = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("dependencies = [")) {
          inDepsSection = true;
          continue;
        }
        if (inDepsSection) {
          if (trimmed.startsWith("]")) {
            inDepsSection = false;
            continue;
          }
          const clean = trimmed.replace(/[",]/g, "").trim();
          if (clean && !clean.startsWith("#")) {
            deps.push(`pypi:${clean}`);
          }
        } else if (fileName === "requirements.txt" && trimmed && !trimmed.startsWith("#")) {
          deps.push(`pypi:${trimmed}`);
        }
      }
      break;
    }

    case "conda": {
      // Parse environment.yml dependencies: (- numpy=1.26.4, nested pip: items)
      const lines = content.split("\n");
      let inDeps = false;
      let inPip = false;

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        if (trimmed === "dependencies:") {
          inDeps = true;
          inPip = false;
          continue;
        }
        if (
          inDeps &&
          !rawLine.startsWith(" ") &&
          !rawLine.startsWith("-") &&
          trimmed.endsWith(":")
        ) {
          inDeps = false;
          inPip = false;
          continue;
        }
        if (!inDeps) continue;

        if (trimmed === "- pip:" || trimmed === "pip:") {
          inPip = true;
          continue;
        }
        if (trimmed.startsWith("- ")) {
          const item = trimmed.slice(2).trim().replace(/["']/g, "");
          if (!item) continue;
          const indent = rawLine.search(/\S|$/);
          if (inPip && indent >= 4) {
            deps.push(`pypi:${item}`);
          } else {
            inPip = false;
            deps.push(`conda:${item}`);
          }
        }
      }
      break;
    }

    case "cargo": {
      // Parse [dependencies] section in Cargo.toml
      const lines = content.split("\n");
      let inDeps = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "[dependencies]") {
          inDeps = true;
          continue;
        }
        if (inDeps) {
          if (trimmed.startsWith("[")) {
            inDeps = false;
            continue;
          }
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const name = trimmed.substring(0, eqIdx).trim();
            const val = trimmed
              .substring(eqIdx + 1)
              .trim()
              .replace(/"/g, "");
            deps.push(`cargo:${name}@${val}`);
          }
        }
      }
      break;
    }

    case "go": {
      // Parse require (...) block in go.mod
      const lines = content.split("\n");
      let inRequire = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("require (")) {
          inRequire = true;
          continue;
        }
        if (inRequire) {
          if (trimmed.startsWith(")")) {
            inRequire = false;
            continue;
          }
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            deps.push(`go:${parts[0]}@${parts[1]}`);
          }
        } else if (trimmed.startsWith("require ") && !trimmed.includes("(")) {
          const parts = trimmed.substring(8).trim().split(/\s+/);
          if (parts.length >= 2) {
            deps.push(`go:${parts[0]}@${parts[1]}`);
          }
        }
      }
      break;
    }

    case "nuget":
    case "composer":
    case "gem":
    case "pub": {
      for (const item of extractBackendMobileDependencies(manifestPath, content, ecosystem)) {
        deps.push(`${item.ecosystem}:${item.name}@${item.version}`);
      }
      break;
    }
    case "conan":
    case "vcpkg":
    case "meson":
    case "julia": {
      for (const item of extractCppJuliaDependencies(manifestPath, content, ecosystem)) {
        deps.push(`${item.ecosystem}:${item.name}@${item.version}`);
      }
      break;
    }
    case "maven":
    case "gradle":
    case "sbt":
    case "hex":
    case "rebar3":
    case "swift":
    case "cocoapods":
    case "carthage": {
      for (const item of extractTier2ManifestDependencies(manifestPath, content, ecosystem)) {
        deps.push(`${item.ecosystem}:${item.name}@${item.version}`);
      }
      break;
    }
    case "hackage":
    case "cran":
    case "cpan":
    case "luarocks": {
      for (const item of extractLongTailDependencies(manifestPath, content, ecosystem)) {
        deps.push(`${item.ecosystem}:${item.name}@${item.version}`);
      }
      break;
    }
  }

  return deps.sort();
}

function parseGradleCatalogContent(catalogContent: string, deps: ParsedManifestDep[]): void {
  const versions = new Map<string, string>();
  let section = "";
  const rawLibraries: string[] = [];

  for (const rawLine of catalogContent.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1]?.trim() ?? "";
      continue;
    }
    if (section === "versions") {
      const kv = line.match(/^([a-zA-Z0-9_.-]+)\s*=\s*["']([^"']+)["']/);
      if (kv?.[1] && kv[2]) versions.set(kv[1], kv[2].trim());
    } else if (section === "libraries") {
      rawLibraries.push(line);
    }
  }

  for (const line of rawLibraries) {
    const moduleMatch = line.match(/\bmodule\s*=\s*["']([^"':]+):([^"']+)["']/);
    const groupMatch = line.match(/\bgroup\s*=\s*["']([^"']+)["']/);
    const nameMatch = line.match(/\bname\s*=\s*["']([^"']+)["']/);
    const groupId = moduleMatch?.[1] ?? groupMatch?.[1];
    const artifactId = moduleMatch?.[2] ?? nameMatch?.[1];
    if (!groupId || !artifactId) continue;

    const refMatch = line.match(/\bversion\.ref\s*=\s*["']([^"']+)["']/);
    const directVerMatch = line.match(/\bversion\s*=\s*["']([^"']+)["']/);
    const version = (refMatch?.[1] ? versions.get(refMatch[1]) : directVerMatch?.[1]) ?? "latest";
    deps.push({ ecosystem: "gradle", name: `${groupId}:${artifactId}`, version });
  }
}

/**
 * Extracts dependency name/version pairs for Phase 4 Tier 2 ecosystems
 * (Maven/Ivy, Gradle/Version Catalog, sbt, Mix/Hex, Rebar3, SPM, CocoaPods, Carthage).
 */
export function extractTier2ManifestDependencies(
  manifestPath: string,
  content: string,
  ecosystem: Ecosystem,
): ParsedManifestDep[] {
  const deps: ParsedManifestDep[] = [];
  const fileName = path.basename(manifestPath);

  if (ecosystem === "maven") {
    if (fileName === "ivy.xml") {
      for (const m of content.matchAll(
        /<dependency\b[^>]*org=["']([^"']+)["'][^>]*name=["']([^"']+)["'](?:\s+[^>]*rev=["']([^"']+)["'])?/gi,
      )) {
        if (m[1] && m[2]) {
          deps.push({
            ecosystem: "maven",
            name: `${m[1].trim()}:${m[2].trim()}`,
            version: (m[3] || "latest").trim(),
          });
        }
      }
      return deps;
    }
    for (const block of content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/gi)) {
      const inner = block[1] ?? "";
      const g = inner.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/i)?.[1];
      const a = inner.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/i)?.[1];
      const v = inner.match(/<version>\s*([^<\s]+)\s*<\/version>/i)?.[1];
      if (g && a) {
        deps.push({ ecosystem: "maven", name: `${g}:${a}`, version: v || "latest" });
      }
    }
    return deps;
  }

  if (ecosystem === "gradle") {
    if (fileName === "libs.versions.toml") {
      parseGradleCatalogContent(content, deps);
      return deps;
    }
    for (const m of content.matchAll(
      /\b(?:implementation|api|testImplementation|compileOnly|runtimeOnly)\s*\(?\s*["']([^"':\s]+):([^"':\s]+)(?::([^"'\s]+))?["']/g,
    )) {
      if (m[1] && m[2]) {
        deps.push({
          ecosystem: "gradle",
          name: `${m[1]}:${m[2]}`,
          version: m[3] || "latest",
        });
      }
    }
    const siblingCatalog = path.join(path.dirname(manifestPath), "gradle", "libs.versions.toml");
    if (fs.existsSync(siblingCatalog)) {
      parseGradleCatalogContent(fs.readFileSync(siblingCatalog, "utf-8"), deps);
    }
    return deps;
  }

  if (ecosystem === "sbt") {
    for (const m of content.matchAll(
      /["']([^"']+)["']\s*%{1,2}\s*["']([^"']+)["']\s*%\s*["']([^"']+)["']/g,
    )) {
      if (m[1] && m[2]) {
        deps.push({ ecosystem: "sbt", name: `${m[1]}:${m[2]}`, version: m[3] || "latest" });
      }
    }
    return deps;
  }

  if (ecosystem === "hex") {
    for (const m of content.matchAll(/\{:([a-zA-Z0-9_]+),\s*["']([^"']+)["']/g)) {
      if (m[1]) {
        deps.push({
          ecosystem: "hex",
          name: m[1],
          version: m[2]?.replace(/^[~>=<\s]+/, "").trim() || "latest",
        });
      }
    }
    return deps;
  }

  if (ecosystem === "rebar3") {
    const block = content.match(/\{deps,\s*\[([\s\S]*?)\]\}\s*\./);
    const body = block?.[1] ?? content;
    for (const m of body.matchAll(/\{([a-zA-Z0-9_]+),\s*["']([^"']+)["']\}/g)) {
      if (m[1]) {
        deps.push({ ecosystem: "rebar3", name: m[1], version: m[2]?.trim() || "latest" });
      }
    }
    return deps;
  }

  if (ecosystem === "swift") {
    for (const m of content.matchAll(
      /\.package\(\s*url:\s*["']([^"']+)["'](?:\s*,\s*(?:from|exact)\s*:\s*["']([^"']+)["'])?/g,
    )) {
      if (m[1]) {
        const canonical = m[1].replace(/^https?:\/\//i, "").replace(/\.git$/i, "");
        deps.push({
          ecosystem: "swift",
          name: canonical,
          version: m[2]?.trim() || "latest",
        });
      }
    }
    return deps;
  }

  if (ecosystem === "cocoapods") {
    for (const rawLine of content.split(/\r?\n/)) {
      const m = rawLine.trim().match(/^pod\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/);
      if (m?.[1]) {
        deps.push({
          ecosystem: "cocoapods",
          name: m[1],
          version: m[2]?.replace(/^[~>=<\s]+/, "").trim() || "latest",
        });
      }
    }
    return deps;
  }

  if (ecosystem === "carthage") {
    for (const rawLine of content.split(/\r?\n/)) {
      const m = rawLine
        .trim()
        .match(/^(?:github|git|binary)\s+["']([^"']+)["'](?:\s+(?:~>|==|>=)\s*([^\s#]+))?/);
      if (m?.[1]) {
        deps.push({
          ecosystem: "carthage",
          name: m[1],
          version: m[2]?.trim() || "latest",
        });
      }
    }
    return deps;
  }

  return deps;
}

function extractCppJuliaDependencies(
  manifestPath: string,
  content: string,
  ecosystem: string,
): Array<{ ecosystem: string; name: string; version: string }> {
  const results: Array<{ ecosystem: string; name: string; version: string }> = [];
  const lowerPath = manifestPath.toLowerCase();

  if (ecosystem === "conan") {
    if (lowerPath.endsWith(".txt")) {
      let inRequires = false;
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("[")) {
          inRequires = line === "[requires]" || line === "[tool_requires]";
          continue;
        }
        if (inRequires) {
          const ref = line.split("@")[0]?.trim() ?? "";
          const slashIdx = ref.indexOf("/");
          if (slashIdx > 0) {
            const name = ref.slice(0, slashIdx).trim();
            const version = ref.slice(slashIdx + 1).trim() || "*";
            if (name) results.push({ ecosystem, name, version });
          }
        }
      }
    } else if (lowerPath.endsWith(".py")) {
      const matches = content.matchAll(/["']([A-Za-z0-9_.+-]+)\/([^"'@\s]+)(?:@[^"']*)?["']/g);
      for (const m of matches) {
        if (m[1] && m[2]) {
          results.push({ ecosystem, name: m[1], version: m[2] });
        }
      }
    }
    return results;
  }

  if (ecosystem === "vcpkg") {
    try {
      const parsed = JSON.parse(content) as {
        dependencies?: Array<string | { name?: string; "version>="?: string }>;
      };
      for (const dep of parsed.dependencies ?? []) {
        if (typeof dep === "string") {
          if (dep.trim()) results.push({ ecosystem, name: dep.trim(), version: "*" });
        } else if (
          dep &&
          typeof dep === "object" &&
          typeof dep.name === "string" &&
          dep.name.trim()
        ) {
          results.push({
            ecosystem,
            name: dep.name.trim(),
            version: dep["version>="]?.trim() || "*",
          });
        }
      }
    } catch {
      // Ignore malformed vcpkg.json during lockfile hashing
    }
    return results;
  }

  if (ecosystem === "meson") {
    const seen = new Set<string>();
    const matches = content.matchAll(/\b(?:dependency|subproject)\(\s*["']([^"']+)["']/g);
    for (const m of matches) {
      const name = m[1]?.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        results.push({ ecosystem, name, version: "*" });
      }
    }
    return results;
  }

  // Julia Project.toml: parse [deps] UUID entries and optional [compat] version constraints
  const compatVersions = new Map<string, string>();
  let section = "";
  const depNames: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      section = secMatch[1]?.trim() ?? "";
      continue;
    }
    if (section === "deps") {
      const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/);
      if (kv?.[1]) depNames.push(kv[1]);
    } else if (section === "compat") {
      const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/);
      if (kv?.[1] && kv[2]) compatVersions.set(kv[1], kv[2].trim());
    }
  }
  for (const name of depNames) {
    results.push({ ecosystem, name, version: compatVersions.get(name) ?? "*" });
  }
  return results;
}

/**
 * Extracts dependency name/version pairs for Phase 5 long-tail ecosystems
 * (Haskell Cabal/Stack, R DESCRIPTION/renv.lock, Perl cpanfile, Lua .rockspec).
 */
export function extractLongTailDependencies(
  manifestPath: string,
  content: string,
  ecosystem: Ecosystem,
): ParsedManifestDep[] {
  const deps: ParsedManifestDep[] = [];
  const fileName = path.basename(manifestPath).toLowerCase();

  if (ecosystem === "hackage") {
    if (fileName.endsWith(".cabal")) {
      let inBuildDeps = false;
      for (const rawLine of content.split(/\r?\n/)) {
        const cleaned = rawLine.replace(/--.*$/, "");
        if (/^\s*build-depends\s*:/i.test(cleaned)) {
          inBuildDeps = true;
          const after = cleaned.split(":").slice(1).join(":");
          for (const part of after.split(",")) {
            const m = part
              .trim()
              .match(/^([A-Za-z0-9-]+)(?:\s+(?:==|>=|<=|\^>=|>|<)\s*([0-9.]+))?/);
            if (m?.[1] && m[1] !== "base") {
              deps.push({ ecosystem: "hackage", name: m[1], version: m[2] || "latest" });
            }
          }
          continue;
        }
        if (inBuildDeps) {
          if (/^\S/.test(cleaned) || /^\s*[A-Za-z0-9-]+\s*:/.test(cleaned)) {
            inBuildDeps = false;
            continue;
          }
          for (const part of cleaned.split(",")) {
            const m = part
              .trim()
              .match(/^([A-Za-z0-9-]+)(?:\s+(?:==|>=|<=|\^>=|>|<)\s*([0-9.]+))?/);
            if (m?.[1] && m[1] !== "base") {
              deps.push({ ecosystem: "hackage", name: m[1], version: m[2] || "latest" });
            }
          }
        }
      }
    } else if (fileName === "package.yaml") {
      let inDeps = false;
      for (const rawLine of content.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        if (trimmed === "dependencies:") {
          inDeps = true;
          continue;
        }
        if (inDeps && !rawLine.startsWith(" ") && !trimmed.startsWith("-")) {
          inDeps = false;
          continue;
        }
        if (inDeps && trimmed.startsWith("-")) {
          const item = trimmed.slice(1).trim();
          const m = item.match(/^([A-Za-z0-9-]+)(?:\s+(?:==|>=|<=|\^>=|>|<)\s*([0-9.]+))?/);
          if (m?.[1] && m[1] !== "base") {
            deps.push({ ecosystem: "hackage", name: m[1], version: m[2] || "latest" });
          }
        }
      }
    }
    return deps;
  }

  if (ecosystem === "cran") {
    if (fileName === "renv.lock") {
      try {
        const json = JSON.parse(content) as {
          Packages?: Record<string, { Package?: string; Version?: string }>;
        };
        for (const [key, pkg] of Object.entries(json.Packages ?? {})) {
          deps.push({
            ecosystem: "cran",
            name: pkg.Package ?? key,
            version: pkg.Version ?? "latest",
          });
        }
      } catch {
        // Ignore malformed renv.lock
      }
      return deps;
    }

    let inField = false;
    for (const rawLine of content.split(/\r?\n/)) {
      if (/^(?:Imports|Depends|Suggests)\s*:/i.test(rawLine)) {
        inField = true;
        const after = rawLine.split(":").slice(1).join(":");
        for (const entry of after.split(",")) {
          const m = entry.trim().match(/^([A-Za-z0-9.]+)(?:\s*\((?:>=|==)\s*([^)]+)\))?/);
          if (m?.[1] && m[1] !== "R") {
            deps.push({ ecosystem: "cran", name: m[1], version: m[2]?.trim() || "latest" });
          }
        }
        continue;
      }
      if (inField) {
        if (/^\S/.test(rawLine)) {
          inField = false;
          continue;
        }
        for (const entry of rawLine.split(",")) {
          const m = entry.trim().match(/^([A-Za-z0-9.]+)(?:\s*\((?:>=|==)\s*([^)]+)\))?/);
          if (m?.[1] && m[1] !== "R") {
            deps.push({ ecosystem: "cran", name: m[1], version: m[2]?.trim() || "latest" });
          }
        }
      }
    }
    return deps;
  }

  if (ecosystem === "cpan") {
    for (const m of content.matchAll(
      /\brequires\s+["']([A-Za-z0-9_:]+)["'](?:\s*,\s*["'](?:[><=~!\s]*)?([^"']+)["'])?/g,
    )) {
      if (m[1]) {
        deps.push({
          ecosystem: "cpan",
          name: m[1],
          version: m[2]?.replace(/^[><=~\s]+/, "").trim() || "latest",
        });
      }
    }
    return deps;
  }

  if (ecosystem === "luarocks") {
    const depBlock = content.match(/\bdependencies\s*=\s*\{([\s\S]*?)\}/);
    const inner = depBlock?.[1] ?? "";
    for (const m of inner.matchAll(
      /["']([A-Za-z0-9_.-]+)(?:\s*(?:>=|==|~>|<=|>|<)\s*([^"']+))?["']/g,
    )) {
      if (m[1] && m[1].toLowerCase() !== "lua") {
        deps.push({
          ecosystem: "luarocks",
          name: m[1],
          version: m[2]?.trim() || "latest",
        });
      }
    }
    return deps;
  }

  return deps;
}
