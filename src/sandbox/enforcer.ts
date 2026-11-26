import { engineRegistry } from "../engines/registry.js";
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

  const adapter = engineRegistry.getAdapter(ecosystem);
  if (adapter?.injectSandboxFlags) {
    return adapter.injectSandboxFlags(command, args);
  }

  return [...args];
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
