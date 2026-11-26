import type { Ecosystem } from "../types.js";
import { resolveWorkspaceMembers } from "../workspace/config.js";
import { readCompositeLockfile } from "../workspace/lockfile.js";
import { OsvClient } from "./osv.js";
import type { AuditFinding, AuditReport, VulnerabilitySeverity } from "./types.js";

const SEVERITY_RANKS: Record<VulnerabilitySeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export class CrossStackAuditor {
  private osvClient = new OsvClient();

  /**
   * Performs an end-to-end multi-language security audit across all workspace dependencies.
   */
  async audit(
    workspaceDir: string,
    options?: { failOn?: VulnerabilitySeverity },
  ): Promise<AuditReport> {
    const start = performance.now();
    const packagesToScan = this.collectDependencies(workspaceDir);

    const findings = await this.osvClient.queryPackages(packagesToScan);

    // Sort findings by highest severity first
    findings.sort((a, b) => SEVERITY_RANKS[b.severity] - SEVERITY_RANKS[a.severity]);

    const vulnerablePkgs = new Set(findings.map((f) => `${f.ecosystem}:${f.packageName}`));
    const durationMs = Math.round(performance.now() - start);

    let hasFailure = false;
    if (options?.failOn) {
      const minRank = SEVERITY_RANKS[options.failOn];
      hasFailure = findings.some((f) => SEVERITY_RANKS[f.severity] >= minRank);
    }

    return {
      scannedPackages: packagesToScan.length,
      vulnerablePackages: vulnerablePkgs.size,
      totalFindings: findings.length,
      findings,
      durationMs,
      hasFailure,
    };
  }

  private collectDependencies(
    workspaceDir: string,
  ): Array<{ name: string; ecosystem: Ecosystem; version: string; memberPath: string }> {
    const lock = readCompositeLockfile(workspaceDir);
    const list: Array<{
      name: string;
      ecosystem: Ecosystem;
      version: string;
      memberPath: string;
    }> = [];

    if (lock) {
      for (const member of lock.members) {
        for (const depStr of member.directDependencies) {
          // format: "npm:axios@^1.7.0", "jsr:@std/path@^1.0.0", "conda:numpy@1.26.4"
          const match = depStr.match(/^([a-z0-9_-]+):(.*)$/);
          if (match) {
            const ecosystem = match[1] as Ecosystem;
            const rest = match[2];
            const atIdx = rest.lastIndexOf("@");
            if (atIdx !== -1) {
              const name = rest.substring(0, atIdx);
              const version = rest.substring(atIdx + 1);
              list.push({ name, ecosystem, version, memberPath: member.path });
            } else {
              list.push({ name: rest, ecosystem, version: "latest", memberPath: member.path });
            }
          }
        }
      }
      return list;
    }

    // Fallback if poly.lock does not exist yet: inspect manifests directly
    const members = resolveWorkspaceMembers(workspaceDir);
    for (const m of members) {
      // Add default entry
      list.push({
        name: m.relativeDir,
        ecosystem: m.context.ecosystem,
        version: "0.1.0",
        memberPath: m.relativeDir,
      });
    }

    return list;
  }
}
