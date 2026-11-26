import { engineRegistry } from "../engines/registry.js";
import type { Ecosystem, PackageSpec } from "../types.js";

/**
 * Parses shorthand ecosystem tokens, standard Package URLs (PURL), or bare package strings.
 * Supported prefixes are resolved dynamically from EngineRegistry (e.g. npm:, jsr:, pypi:, conda:, cargo:, go:).
 */
export function parsePackageSpec(input: string, options?: { isDev?: boolean }): PackageSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Cannot parse an empty package specification.");
  }

  // 1. Standard Package URL: pkg:<type>/<namespace>/<name>@<version>
  if (trimmed.startsWith("pkg:")) {
    return parseStandardPurl(trimmed, options?.isDev);
  }

  // 2. Shorthand ecosystem prefix: <ecosystem>:<name>[@<version>]
  const prefixMatch = trimmed.match(/^([a-z0-9][a-z0-9_-]*):(.*)$/i);
  if (prefixMatch) {
    const resolvedEcosystem = engineRegistry.resolveEcosystem(prefixMatch[1]);
    if (resolvedEcosystem) {
      const rest = prefixMatch[2];
      const { namespace, name, version } = parseNameAndVersion(rest);

      return {
        raw: trimmed,
        ecosystem: resolvedEcosystem,
        namespace,
        name,
        version,
        isDev: options?.isDev ?? false,
      };
    }
  }

  // 3. Bare package specification (ecosystem resolved via context detection)
  const { namespace, name, version } = parseNameAndVersion(trimmed);
  return {
    raw: trimmed,
    ecosystem: undefined,
    namespace,
    name,
    version,
    isDev: options?.isDev ?? false,
  };
}

/**
 * Extracts optional namespace (e.g. @org), name, and version from string
 */
function parseNameAndVersion(input: string): {
  namespace?: string;
  name: string;
  version?: string;
} {
  let target = input;
  let namespace: string | undefined;

  if (target.startsWith("@")) {
    const slashIdx = target.indexOf("/");
    if (slashIdx !== -1) {
      namespace = target.substring(0, slashIdx);
      target = target.substring(slashIdx + 1);
    }
  }

  const atIdx = target.indexOf("@");
  if (atIdx !== -1) {
    const name = target.substring(0, atIdx);
    const version = target.substring(atIdx + 1);
    return { namespace, name, version };
  }

  return { namespace, name: target, version: undefined };
}

/**
 * Parses official Package URL format (RFC spec) using registered PURL types
 */
function parseStandardPurl(purl: string, isDev?: boolean): PackageSpec {
  const withoutScheme = purl.substring(4); // remove 'pkg:'
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Malformed PURL: '${purl}'. Expected format 'pkg:<type>/<name>'`);
  }

  const rawType = withoutScheme.substring(0, slashIdx).toLowerCase();
  const ecosystem: Ecosystem | undefined = engineRegistry.resolvePurlType(rawType);
  if (!ecosystem) {
    throw new Error(`Unsupported PURL ecosystem type '${rawType}' in '${purl}'.`);
  }

  const rest = decodeURIComponent(withoutScheme.substring(slashIdx + 1));
  const { namespace, name, version } = parseNameAndVersion(rest);

  return {
    raw: purl,
    ecosystem,
    namespace,
    name,
    version,
    isDev: isDev ?? false,
  };
}
