import fs from "node:fs";
import path from "node:path";
import type { CustomEngineDefinition, PackageSpec, WorkspaceConfig } from "../types.js";
import { type EngineAdapter, defineDeclarativeAdapter } from "./declarative.js";
import { engineRegistry } from "./registry.js";

const LOADED_CONFIG_TIMESTAMPS = new Map<string, number>();

function tokenizeTemplateString(template: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of template.matchAll(regex)) {
    const token = m[1] ?? m[2] ?? m[3];
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

/**
 * Expands a declarative command template string or argv array against an optional PackageSpec.
 * Placeholders: {name}, {namespace}, {fullName}, {version}, {cleanVersion}, {raw}.
 */
export function expandCommandTemplate(
  template: string | string[] | undefined,
  fallbackArgs: string[],
  pkg?: PackageSpec,
): string[] {
  if (!template) return fallbackArgs;

  const rawTokens = Array.isArray(template) ? [...template] : tokenizeTemplateString(template);
  const fullName = pkg ? (pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name) : "";
  const cleanVer = pkg?.version?.replace(/^[~^>=<\s]+/, "").trim() ?? "";
  const rawVer = pkg?.version?.trim() ?? "";

  const expanded: string[] = [];
  for (const tok of rawTokens) {
    const hadPlaceholder = /\{(?:version|cleanVersion|namespace)\}/.test(tok);
    let out = tok
      .replace(/\{fullName\}/g, fullName)
      .replace(/\{namespace\}/g, pkg?.namespace ?? "")
      .replace(/\{name\}/g, pkg?.name ?? "")
      .replace(/\{cleanVersion\}/g, cleanVer)
      .replace(/\{version\}/g, rawVer)
      .replace(/\{raw\}/g, pkg?.raw ?? "");

    // Clean dangling version separator like "foo@" when version is unset
    if (hadPlaceholder && !rawVer) {
      out = out.replace(/[@=:]$/, "");
    }
    if (out.length > 0) {
      expanded.push(out);
    }
  }
  return expanded;
}

/**
 * Builds an EngineAdapter from a `[engines.custom.<name>]` entry in poly.toml.
 */
export function createCustomEngineAdapter(
  name: string,
  def: CustomEngineDefinition,
): EngineAdapter {
  const ecosystem = name.trim().toLowerCase();
  const cmd = def.command?.trim() || ecosystem;

  return defineDeclarativeAdapter({
    id: `custom-${ecosystem}`,
    ecosystem,
    aliases: def.aliases ?? [],
    purlTypes: def.purlType ? [def.purlType] : [ecosystem],
    manifests: def.manifests,
    lockfiles: def.lockfiles ?? [],
    osvEcosystem: def.osvEcosystem || undefined,
    sbomPurlType: def.sbomPurlType ?? def.purlType ?? ecosystem,
    supportedClis: [cmd],
    commands: {
      command: cmd,
      add: (pkg) => expandCommandTemplate(def.add, ["add", pkg.name], pkg),
      remove: (pkg) => expandCommandTemplate(def.remove, ["remove", pkg.name], pkg),
      install: () => expandCommandTemplate(def.install, ["install"]),
      update: (pkg) =>
        expandCommandTemplate(def.update, pkg ? ["update", pkg.name] : ["update"], pkg),
    },
    resolveScriptCommand: (script) => {
      if (script === "test" && def.test) {
        return [cmd, expandCommandTemplate(def.test, ["test"])];
      }
      if (def.script) {
        return [
          cmd,
          expandCommandTemplate(def.script, [script]).map((s) => s.replace(/\{script\}/g, script)),
        ];
      }
      return [cmd, [script]];
    },
  });
}

/**
 * Registers custom engines from a parsed WorkspaceConfig into EngineRegistry.
 */
export function registerCustomEnginesFromConfig(config?: WorkspaceConfig): EngineAdapter[] {
  const custom = config?.engines?.custom;
  if (!custom) return [];

  const registered: EngineAdapter[] = [];
  for (const [name, def] of Object.entries(custom)) {
    if (!def.manifests || def.manifests.length === 0) continue;
    const adapter = createCustomEngineAdapter(name, def);
    engineRegistry.register(adapter);
    registered.push(adapter);
  }
  return registered;
}

/**
 * Lightweight parser for [engines.custom.*] blocks inside a directory's poly.toml/poly.json
 * so detector lookups discover custom manifests without creating circular dependencies with config.ts.
 */
export function syncCustomEnginesInDir(dir: string): EngineAdapter[] {
  const jsonPath = path.join(dir, "poly.json");
  const tomlPath = path.join(dir, "poly.toml");

  const activeFile = fs.existsSync(tomlPath) ? tomlPath : fs.existsSync(jsonPath) ? jsonPath : null;
  if (!activeFile) return [];

  const mtimeMs = fs.statSync(activeFile).mtimeMs;
  if (LOADED_CONFIG_TIMESTAMPS.get(activeFile) === mtimeMs) {
    return [];
  }
  LOADED_CONFIG_TIMESTAMPS.set(activeFile, mtimeMs);

  try {
    if (activeFile.endsWith(".json")) {
      const parsed = JSON.parse(fs.readFileSync(activeFile, "utf-8")) as WorkspaceConfig;
      return registerCustomEnginesFromConfig(parsed);
    }

    const content = fs.readFileSync(activeFile, "utf-8");
    const customMap = parseCustomEnginesFromToml(content);
    return registerCustomEnginesFromConfig({
      name: "workspace",
      members: [],
      engines: { custom: customMap },
    });
  } catch {
    return [];
  }
}

export function parseCustomEnginesFromToml(
  content: string,
): Record<string, CustomEngineDefinition> {
  const custom: Record<string, CustomEngineDefinition> = {};
  let activeName: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[") && line.endsWith("]")) {
      const section = line.slice(1, -1).trim();
      const match = section.match(/^engines\.custom\.([a-z0-9_-]+)$/i);
      if (match?.[1]) {
        activeName = match[1].toLowerCase();
        custom[activeName] ??= {
          name: activeName,
          manifests: [],
          lockfiles: [],
          command: activeName,
        };
      } else {
        activeName = null;
      }
      continue;
    }

    if (!activeName) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    const rawVal = line.slice(eqIdx + 1).trim();
    const def = custom[activeName];

    const parseArrayOrString = (v: string): string[] => {
      if (v.startsWith("[") && v.endsWith("]")) {
        return (v.match(/["']([^"']+)["']/g) ?? []).map((s) => s.slice(1, -1));
      }
      return [v.replace(/^["']|["']$/g, "")];
    };
    const cleanStr = (v: string): string => v.replace(/^["']|["']$/g, "");

    if (key === "manifest" || key === "manifests") {
      def.manifests.push(...parseArrayOrString(rawVal));
    } else if (key === "lockfile" || key === "lockfiles") {
      def.lockfiles = [...(def.lockfiles ?? []), ...parseArrayOrString(rawVal)];
    } else if (key === "aliases") {
      def.aliases = parseArrayOrString(rawVal);
    } else if (key === "command") {
      def.command = cleanStr(rawVal);
    } else if (key === "purl_type" || key === "purlType") {
      def.purlType = cleanStr(rawVal);
    } else if (key === "osv_ecosystem" || key === "osvEcosystem") {
      def.osvEcosystem = cleanStr(rawVal) || undefined;
    } else if (key === "sbom_purl_type" || key === "sbomPurlType") {
      def.sbomPurlType = cleanStr(rawVal);
    } else if (
      key === "add" ||
      key === "remove" ||
      key === "install" ||
      key === "update" ||
      key === "test" ||
      key === "script"
    ) {
      def[key] = rawVal.startsWith("[") ? parseArrayOrString(rawVal) : cleanStr(rawVal);
    }
  }

  return custom;
}
