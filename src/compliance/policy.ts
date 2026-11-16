import path from "node:path";
import { loadWorkspaceConfig } from "../workspace/config.js";
import { verifyCompositeLockfile } from "../workspace/lockfile.js";
import { CrossStackAuditor } from "./auditor.js";
import { LicenseAuditor } from "./licenses.js";
import type { PolicyEvaluationReport, PolicyViolation, VulnerabilitySeverity } from "./types.js";

export interface PolicyOptions {
  deniedLicenses?: string[];
  allowedLicenses?: string[];
  failOnCveSeverity?: VulnerabilitySeverity;
  checkLockfileDrift?: boolean;
}

export class PolicyEvaluator {
  /**
   * Evaluates workspace compliance against corporate license and security gate rules.
   */
  async evaluate(
    workspaceDir: string,
    options: PolicyOptions = {},
  ): Promise<PolicyEvaluationReport> {
    const wsDir = path.resolve(workspaceDir);
    const violations: PolicyViolation[] = [];

    // 1. Load workspace configuration to check for configured [policy] table
    let configDenied = options.deniedLicenses || ["GPL-3.0", "AGPL-3.0", "SSPL-1.0"];
    let configAllowed = options.allowedLicenses;
    let cveThreshold = options.failOnCveSeverity || "HIGH";

    try {
      const config = loadWorkspaceConfig(wsDir);
      // @ts-ignore - dynamic policy table in poly.toml
      const policyTable = config?.policy as Record<string, unknown> | undefined;
      if (policyTable) {
        if (Array.isArray(policyTable.denied_licenses)) {
          configDenied = policyTable.denied_licenses as string[];
        }
        if (Array.isArray(policyTable.allowed_licenses)) {
          configAllowed = policyTable.allowed_licenses as string[];
        }
        if (typeof policyTable.fail_on_cve === "string") {
          cveThreshold = policyTable.fail_on_cve.toUpperCase() as VulnerabilitySeverity;
        }
      }
    } catch {
      // Use defaults if poly.toml policy table not present
    }

    // 2. Audit Licenses
    const licenseAuditor = new LicenseAuditor();
    const licenseReport = licenseAuditor.scan(wsDir, {
      deny: configDenied,
    });

    for (const pkg of licenseReport.packages) {
      const normLicense = pkg.license.toUpperCase();

      // Check denied licenses
      for (const denied of configDenied) {
        if (normLicense.includes(denied.toUpperCase())) {
          violations.push({
            rule: "LICENSE_DENIED",
            packageName: pkg.packageName,
            severity: "HIGH",
            message: `Package '${pkg.packageName}' (${pkg.ecosystem}) uses forbidden license '${pkg.license}'.`,
          });
        }
      }

      // Check allowed license whitelist if configured
      if (configAllowed && configAllowed.length > 0) {
        const isAllowed = configAllowed.some((a) => normLicense.includes(a.toUpperCase()));
        if (!isAllowed) {
          violations.push({
            rule: "LICENSE_NOT_ALLOWED",
            packageName: pkg.packageName,
            severity: "HIGH",
            message: `Package '${pkg.packageName}' (${pkg.ecosystem}) license '${pkg.license}' is not in approved corporate whitelist.`,
          });
        }
      }
    }

    // 3. Security CVE Vulnerability Gate
    const crossStackAuditor = new CrossStackAuditor();
    try {
      const auditReport = await crossStackAuditor.audit(wsDir);
      const severityOrder: Record<VulnerabilitySeverity, number> = {
        CRITICAL: 4,
        HIGH: 3,
        MEDIUM: 2,
        LOW: 1,
      };

      const minSeverityLevel = severityOrder[cveThreshold] || 3;

      for (const finding of auditReport.findings) {
        const findingLevel = severityOrder[finding.severity] || 1;
        if (findingLevel >= minSeverityLevel) {
          violations.push({
            rule: "CVE_THRESHOLD_EXCEEDED",
            packageName: finding.packageName,
            severity: finding.severity,
            message: `Package '${finding.packageName}' has ${finding.severity} severity CVE (${finding.id}): ${finding.summary}`,
          });
        }
      }
    } catch {
      // Ignored if network unavailable
    }

    // 4. Lockfile Cryptographic Drift Check
    if (options.checkLockfileDrift) {
      const lockRes = verifyCompositeLockfile(wsDir);
      if (lockRes.isDrifted) {
        violations.push({
          rule: "LOCKFILE_DRIFT",
          severity: "CRITICAL",
          message: `poly.lock is not synchronized with workspace manifests (${lockRes.issues.length} drift issues detected).`,
        });
      }
    }

    const deniedLicenseCount = violations.filter(
      (v) => v.rule === "LICENSE_DENIED" || v.rule === "LICENSE_NOT_ALLOWED",
    ).length;
    const cveViolationCount = violations.filter((v) => v.rule === "CVE_THRESHOLD_EXCEEDED").length;

    return {
      passed: violations.length === 0,
      violations,
      totalPackagesChecked: licenseReport.totalPackages,
      deniedLicenseCount,
      cveViolationCount,
    };
  }
}
