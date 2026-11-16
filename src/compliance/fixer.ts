import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceMembers } from "../workspace/config.js";
import { writeCompositeLockfile } from "../workspace/lockfile.js";
import { CrossStackAuditor } from "./auditor.js";
import type { AuditFinding, VulnerabilitySeverity } from "./types.js";

export interface RemediatedPackage {
  packageName: string;
  ecosystem: string;
  manifestPath: string;
  previousVersion: string;
  fixedVersion: string;
  cveIds: string[];
}

export interface SecurityFixReport {
  scannedPackages: number;
  totalVulnerabilities: number;
  fixedCount: number;
  unfixableCount: number;
  remediated: RemediatedPackage[];
  remainingVulnerabilities: AuditFinding[];
  durationMs: number;
}

export class SecurityAutoHealer {
  private auditor = new CrossStackAuditor();

  /**
   * Scans and automatically fixes vulnerable dependencies across all ecosystems.
   */
  async fix(
    workspaceDir: string,
    options?: { dryRun?: boolean; minSeverity?: VulnerabilitySeverity },
  ): Promise<SecurityFixReport> {
    const start = performance.now();
    const auditReport = await this.auditor.audit(workspaceDir, {
      failOn: options?.minSeverity,
    });

    const fixableMap = new Map<string, { finding: AuditFinding; cveIds: string[] }>();
    const unfixable: AuditFinding[] = [];

    for (const f of auditReport.findings) {
      if (f.fixedVersion) {
        const key = `${f.ecosystem}:${f.packageName}`;
        const existing = fixableMap.get(key);
        if (existing) {
          existing.cveIds.push(f.id);
          // If this finding's fixed version is higher, take the higher one
          const existingFixed = existing.finding.fixedVersion ?? "";
          if (f.fixedVersion > existingFixed) {
            existing.finding = f;
          }
        } else {
          fixableMap.set(key, { finding: f, cveIds: [f.id] });
        }
      } else {
        unfixable.push(f);
      }
    }

    const remediated: RemediatedPackage[] = [];

    // Locate manifests across workspace members and root
    const members = resolveWorkspaceMembers(workspaceDir);
    const manifestLocations: Array<{ ecosystem: string; manifestFile: string }> = [];

    // Add root manifests
    for (const file of [
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "requirements.txt",
      "go.mod",
    ]) {
      const full = path.join(workspaceDir, file);
      if (fs.existsSync(full)) {
        manifestLocations.push({ ecosystem: this.ecosystemForFile(file), manifestFile: full });
      }
    }

    // Add member manifests
    for (const m of members) {
      manifestLocations.push({
        ecosystem: m.context.ecosystem,
        manifestFile: path.join(m.absoluteDir, m.context.manifestFile),
      });
    }

    // Patch manifests
    for (const [key, { finding, cveIds }] of fixableMap.entries()) {
      const fixedVer = finding.fixedVersion;
      if (!fixedVer) continue;
      let wasPatched = false;

      for (const loc of manifestLocations) {
        if (!fs.existsSync(loc.manifestFile)) continue;

        if (loc.ecosystem === "npm" && path.basename(loc.manifestFile) === "package.json") {
          const didPatch = this.patchPackageJson(
            loc.manifestFile,
            finding.packageName,
            `^${fixedVer}`,
            options?.dryRun,
          );
          if (didPatch) {
            wasPatched = true;
            remediated.push({
              packageName: finding.packageName,
              ecosystem: finding.ecosystem,
              manifestPath: loc.manifestFile,
              previousVersion: finding.installedVersion,
              fixedVersion: fixedVer,
              cveIds,
            });
            break;
          }
        } else if (
          loc.ecosystem === "pypi" &&
          path.basename(loc.manifestFile) === "pyproject.toml"
        ) {
          const didPatch = this.patchPyprojectToml(
            loc.manifestFile,
            finding.packageName,
            `>=${fixedVer}`,
            options?.dryRun,
          );
          if (didPatch) {
            wasPatched = true;
            remediated.push({
              packageName: finding.packageName,
              ecosystem: finding.ecosystem,
              manifestPath: loc.manifestFile,
              previousVersion: finding.installedVersion,
              fixedVersion: fixedVer,
              cveIds,
            });
            break;
          }
        } else if (loc.ecosystem === "cargo" && path.basename(loc.manifestFile) === "Cargo.toml") {
          const didPatch = this.patchCargoToml(
            loc.manifestFile,
            finding.packageName,
            fixedVer,
            options?.dryRun,
          );
          if (didPatch) {
            wasPatched = true;
            remediated.push({
              packageName: finding.packageName,
              ecosystem: finding.ecosystem,
              manifestPath: loc.manifestFile,
              previousVersion: finding.installedVersion,
              fixedVersion: fixedVer,
              cveIds,
            });
            break;
          }
        }
      }

      if (!wasPatched) {
        unfixable.push(finding);
      }
    }

    // Regenerate composite lockfile if files were updated and not dry run
    if (!options?.dryRun && remediated.length > 0) {
      writeCompositeLockfile(workspaceDir);
    }

    const durationMs = Math.round(performance.now() - start);

    return {
      scannedPackages: auditReport.scannedPackages,
      totalVulnerabilities: auditReport.findings.length,
      fixedCount: remediated.length,
      unfixableCount: unfixable.length,
      remediated,
      remainingVulnerabilities: unfixable,
      durationMs,
    };
  }

  private patchPackageJson(
    filePath: string,
    packageName: string,
    newRange: string,
    dryRun?: boolean,
  ): boolean {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const pkg = JSON.parse(content);
      let modified = false;

      if (pkg.dependencies?.[packageName]) {
        pkg.dependencies[packageName] = newRange;
        modified = true;
      }
      if (pkg.devDependencies?.[packageName]) {
        pkg.devDependencies[packageName] = newRange;
        modified = true;
      }

      if (modified && !dryRun) {
        fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
      }
      return modified;
    } catch {
      return false;
    }
  }

  private patchPyprojectToml(
    filePath: string,
    packageName: string,
    newSpec: string,
    dryRun?: boolean,
  ): boolean {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const regex = new RegExp(`("${packageName}[^"]*")|('${packageName}[^']*')`, "g");

      if (regex.test(content)) {
        const updated = content.replace(regex, `"${packageName}${newSpec}"`);
        if (!dryRun) {
          fs.writeFileSync(filePath, updated, "utf-8");
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private patchCargoToml(
    filePath: string,
    packageName: string,
    newVersion: string,
    dryRun?: boolean,
  ): boolean {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const simpleRegex = new RegExp(`(${packageName}\\s*=\\s*)"[^"]+"`, "g");
      const objRegex = new RegExp(`(${packageName}\\s*=\\s*{[^}]*version\\s*=\\s*)"[^"]+"`, "g");

      let updated = content;
      let matched = false;

      if (objRegex.test(content)) {
        updated = content.replace(objRegex, `$1"${newVersion}"`);
        matched = true;
      } else if (simpleRegex.test(content)) {
        updated = content.replace(simpleRegex, `$1"${newVersion}"`);
        matched = true;
      }

      if (matched && !dryRun) {
        fs.writeFileSync(filePath, updated, "utf-8");
      }
      return matched;
    } catch {
      return false;
    }
  }

  private ecosystemForFile(filename: string): string {
    if (filename === "package.json") return "npm";
    if (filename === "pyproject.toml" || filename === "requirements.txt") return "pypi";
    if (filename === "Cargo.toml") return "cargo";
    if (filename === "go.mod") return "go";
    return "unknown";
  }
}
