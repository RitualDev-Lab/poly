import { engineRegistry } from "../engines/registry.js";
import type { Ecosystem } from "../types.js";
import type { AuditFinding, VulnerabilitySeverity } from "./types.js";

interface OsvQueryItem {
  package: {
    name: string;
    ecosystem: string;
  };
  version?: string;
}

interface OsvBatchRequest {
  queries: OsvQueryItem[];
}

interface OsvBatchResponse {
  results: Array<{
    vulns?: Array<{
      id: string;
      summary?: string;
      details?: string;
      database_specific?: {
        severity?: string;
        github_reviewed?: boolean;
      };
      severity?: Array<{
        type: string;
        score: string;
      }>;
      affected?: Array<{
        package?: {
          name: string;
          ecosystem: string;
        };
        ranges?: Array<{
          type: string;
          events?: Array<{
            introduced?: string;
            fixed?: string;
          }>;
        }>;
      }>;
      references?: Array<{
        type: string;
        url: string;
      }>;
    }>;
  }>;
}

export class OsvClient {
  private static readonly OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";

  /**
   * Queries the official OSV database in parallel batches of up to 500 packages.
   */
  async queryPackages(
    packages: Array<{ name: string; ecosystem: Ecosystem; version: string; memberPath: string }>,
  ): Promise<AuditFinding[]> {
    const queryable = packages
      .map((pkg) => ({ pkg, osvEcosystem: this.mapEcosystemToOsv(pkg.ecosystem) }))
      .filter((entry): entry is { pkg: (typeof packages)[number]; osvEcosystem: string } =>
        Boolean(entry.osvEcosystem),
      );

    if (queryable.length === 0) {
      return [];
    }

    const queries: OsvQueryItem[] = queryable.map(({ pkg, osvEcosystem }) => ({
      package: {
        name: pkg.name,
        ecosystem: osvEcosystem,
      },
      version: pkg.version.replace(/^[~^>=<]/, "").trim(),
    }));

    try {
      const response = await fetch(OsvClient.OSV_BATCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "poly-cli/0.1.0 (RitualDev Lab)",
        },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as OsvBatchResponse;
      const findings: AuditFinding[] = [];

      data.results?.forEach((result, idx) => {
        if (!result.vulns || result.vulns.length === 0) return;
        const targetPkg = queryable[idx].pkg;

        for (const vuln of result.vulns) {
          const severity = this.normalizeSeverity(vuln);
          let fixedVersion: string | undefined;

          // Extract fixed version
          for (const affected of vuln.affected ?? []) {
            for (const range of affected.ranges ?? []) {
              for (const event of range.events ?? []) {
                if (event.fixed) {
                  fixedVersion = event.fixed;
                  break;
                }
              }
              if (fixedVersion) break;
            }
            if (fixedVersion) break;
          }

          const refUrl = vuln.references?.[0]?.url ?? `https://osv.dev/v1/vulns/${vuln.id}`;

          findings.push({
            id: vuln.id,
            packageName: targetPkg.name,
            ecosystem: targetPkg.ecosystem,
            installedVersion: targetPkg.version,
            severity,
            summary: vuln.summary ?? "Known security vulnerability",
            details: vuln.details,
            fixedVersion,
            referenceUrl: refUrl,
            memberPath: targetPkg.memberPath,
          });
        }
      });

      return findings;
    } catch {
      // Return empty findings if offline / network unreachable
      return [];
    }
  }

  private mapEcosystemToOsv(ecosystem: Ecosystem): string | undefined {
    return engineRegistry.getOsvEcosystem(ecosystem);
  }

  private normalizeSeverity(vuln: {
    database_specific?: { severity?: string };
    severity?: Array<{ type?: string; score?: string }>;
  }): VulnerabilitySeverity {
    const raw = (vuln.database_specific?.severity ?? "").toUpperCase();
    if (raw.includes("CRITICAL")) return "CRITICAL";
    if (raw.includes("HIGH")) return "HIGH";
    if (raw.includes("MODERATE") || raw.includes("MEDIUM")) return "MEDIUM";
    if (raw.includes("LOW")) return "LOW";

    // Fallback: check CVSS vector if available
    const cvssScore = vuln.severity?.find((s) => s.type?.includes("CVSS"))?.score;
    if (cvssScore) {
      // If numeric score
      const numeric = Number.parseFloat(cvssScore);
      if (!Number.isNaN(numeric)) {
        if (numeric >= 9.0) return "CRITICAL";
        if (numeric >= 7.0) return "HIGH";
        if (numeric >= 4.0) return "MEDIUM";
        return "LOW";
      }
    }

    return "MEDIUM";
  }
}
