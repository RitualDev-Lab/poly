import type { Ecosystem, PackageSpec } from "../types.js";

/**
 * Parses shorthand ecosystem tokens, standard Package URLs (PURL), or bare package strings.
 * Examples:
 *   - "npm:axios"
 *   - "pypi:fastapi@^0.110.0"
 *   - "cargo:tokio@1.38.0"
 *   - "go:github.com/gin-gonic/gin@v1.9.1"
 *   - "pkg:npm/%40ritualdev-lab/agentshield@0.2.2"
 *   - "requests"
 */
export function parsePackageSpec(input: string, options?: { isDev?: boolean }): PackageSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Cannot parse an empty package specification.");
  }

  // 1. Check for standard Package URL: pkg:<type>/<namespace>/<name>@<version>
  if (trimmed.startsWith("pkg:")) {
    return parseStandardPurl(trimmed, options?.isDev);
  }

  // 2. Check for shorthand ecosystem prefix: <ecosystem>:<name>[@<version>]
  const prefixMatch = trimmed.match(/^(npm|pypi|cargo|go):(.*)$/i);
  if (prefixMatch) {
    const rawEcosystem = prefixMatch[1].toLowerCase() as Ecosystem;
    const rest = prefixMatch[2];
    const { namespace, name, version } = parseNameAndVersion(rest);

    return {
      raw: trimmed,
      ecosystem: rawEcosystem,
      namespace,
      name,
      version,
      isDev: options?.isDev ?? false,
    };
  }

  // 3. Bare package specification (ecosystem will be resolved via context detection)
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

  // Handle npm scoped packages like @ritualdev-lab/agentshield
  if (target.startsWith("@")) {
    const slashIdx = target.indexOf("/");
    if (slashIdx !== -1) {
      namespace = target.substring(0, slashIdx);
      target = target.substring(slashIdx + 1);
    }
  }

  // Handle version separator @
  const atIdx = target.indexOf("@");
  if (atIdx !== -1) {
    const name = target.substring(0, atIdx);
    const version = target.substring(atIdx + 1);
    return { namespace, name, version };
  }

  return { namespace, name: target, version: undefined };
}

/**
 * Parses official Package URL format (RFC spec)
 */
function parseStandardPurl(purl: string, isDev?: boolean): PackageSpec {
  const withoutScheme = purl.substring(4); // remove 'pkg:'
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Malformed PURL: '${purl}'. Expected format 'pkg:<type>/<name>'`);
  }

  const rawType = withoutScheme.substring(0, slashIdx).toLowerCase();
  let ecosystem: Ecosystem;
  switch (rawType) {
    case "npm":
      ecosystem = "npm";
      break;
    case "pypi":
      ecosystem = "pypi";
      break;
    case "cargo":
      ecosystem = "cargo";
      break;
    case "golang":
    case "go":
      ecosystem = "go";
      break;
    default:
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
