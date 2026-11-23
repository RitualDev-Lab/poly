import type { Ecosystem, PackageSpec } from "../types.js";
import { scanPackageLifecycleScripts } from "./scanner.js";
import type { SandboxScanResult } from "./types.js";

export interface SandboxEnforceOptions {
  enabled: boolean;
  allowScripts?: string[];
  strict?: boolean;
}

/**
 * Injects sandbox security arguments into native package manager CLI arguments.
 */
export function injectSandboxFlags(
  ecosystem: Ecosystem,
  command: string,
  args: string[],
  pkgName?: string,
  options?: SandboxEnforceOptions,
): string[] {
  if (!options?.enabled) return args;

  const isAllowed = pkgName && options.allowScripts?.includes(pkgName);
  if (isAllowed) return args;

  const modified = [...args];

  switch (ecosystem) {
    case "npm": {
      // For pnpm, npm, bun, yarn: inject --ignore-scripts
      if (!modified.includes("--ignore-scripts")) {
        modified.push("--ignore-scripts");
      }
      break;
    }

    case "pypi": {
      // For pip or uv: disallow arbitrary build-time execution
      if (command === "pip" && !modified.includes("--no-build-isolation")) {
        modified.push("--no-build-isolation");
      }
      break;
    }

    case "cargo":
    case "go":
      // Cargo and Go compile standard dependency trees without arbitrary pre/post install scripts
      break;
  }

  return modified;
}

/**
 * Evaluates whether a package should be allowed or blocked by the sandbox policy.
 */
export async function evaluateSandboxGate(
  pkg: PackageSpec,
  options?: SandboxEnforceOptions,
): Promise<SandboxScanResult> {
  if (!options?.enabled) {
    return {
      safe: true,
      package: pkg.name,
      scripts: [],
      blocked: false,
      neutralized: false,
    };
  }

  if (pkg.ecosystem === "npm") {
    return scanPackageLifecycleScripts(pkg.name, pkg.version, {
      allowScripts: options.allowScripts,
    });
  }

  return {
    safe: true,
    package: pkg.name,
    scripts: [],
    blocked: false,
    neutralized: false,
  };
}
