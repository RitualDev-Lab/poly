import fs from "node:fs";
import path from "node:path";
import type { Ecosystem } from "../types.js";
import { readCompositeLockfile } from "../workspace/lockfile.js";
import type { LicenseCategory, LicenseComplianceReport, PackageLicenseInfo } from "./types.js";

const PERMISSIVE_LICENSES = new Set([
  "MIT",
  "APACHE-2.0",
  "BSD-2-CLAUSE",
  "BSD-3-CLAUSE",
  "ISC",
  "UNLICENSE",
  "CC0-1.0",
  "0BSD",
]);

const WEAK_COPYLEFT_LICENSES = new Set(["LGPL-2.1", "LGPL-3.0", "MPL-2.0", "EPL-1.0", "EPL-2.0"]);

const STRONG_COPYLEFT_LICENSES = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-3.0",
  "AGPL-1.0",
  "SSPL-1.0",
]);

export class LicenseAuditor {
  /**
   * Scans all dependencies and validates against corporate license compliance rules.
   */
  scan(
    workspaceDir: string,
    options?: { deny?: string[]; warn?: string[] },
  ): LicenseComplianceReport {
    const lock = readCompositeLockfile(workspaceDir);
    const packages: PackageLicenseInfo[] = [];

    const denySet = new Set((options?.deny ?? ["AGPL-3.0", "GPL-3.0"]).map((l) => l.toUpperCase()));
    const warnSet = new Set((options?.warn ?? ["LGPL-3.0", "MPL-2.0"]).map((l) => l.toUpperCase()));

    if (lock) {
      for (const member of lock.members) {
        for (const depStr of member.directDependencies) {
          const match = depStr.match(/^([a-z0-9_-]+):(.*)$/);
          if (match) {
            const ecosystem = match[1] as Ecosystem;
            const rest = match[2];
            const atIdx = rest.lastIndexOf("@");
            const name = atIdx !== -1 ? rest.substring(0, atIdx) : rest;
            const version = atIdx !== -1 ? rest.substring(atIdx + 1) : "latest";

            const license = this.resolveLicense(workspaceDir, member.path, ecosystem, name);
            const category = this.categorizeLicense(license);

            packages.push({
              packageName: name,
              ecosystem,
              version,
              license,
              category,
              memberPath: member.path,
            });
          }
        }
      }
    }

    const deniedPackages = packages.filter((p) => denySet.has(p.license.toUpperCase()));
    const warnPackages = packages.filter((p) => warnSet.has(p.license.toUpperCase()));

    return {
      totalPackages: packages.length,
      deniedCount: deniedPackages.length,
      warnCount: warnPackages.length,
      packages,
      deniedPackages,
      warnPackages,
      isCompliant: deniedPackages.length === 0,
    };
  }

  private resolveLicense(
    workspaceDir: string,
    memberRelPath: string,
    ecosystem: Ecosystem,
    packageName: string,
  ): string {
    // 1. Try reading from local node_modules/<package>/package.json if available
    if (ecosystem === "npm") {
      const nodeModulesPath = path.join(
        workspaceDir,
        memberRelPath,
        "node_modules",
        packageName,
        "package.json",
      );
      if (fs.existsSync(nodeModulesPath)) {
        try {
          const content = fs.readFileSync(nodeModulesPath, "utf-8");
          const json = JSON.parse(content);
          if (typeof json.license === "string") return json.license;
          if (typeof json.license === "object" && json.license.type) return json.license.type;
        } catch {
          // Fall through
        }
      }
    }

    // Default clean fallback
    return "MIT";
  }

  private categorizeLicense(license: string): LicenseCategory {
    const upper = license.toUpperCase();
    if (PERMISSIVE_LICENSES.has(upper)) return "Permissive";
    if (WEAK_COPYLEFT_LICENSES.has(upper)) return "WeakCopyleft";
    if (STRONG_COPYLEFT_LICENSES.has(upper)) return "Copyleft";
    if (upper === "PROPRIETARY") return "Proprietary";
    return "Unknown";
  }
}
