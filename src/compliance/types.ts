import type { Ecosystem } from "../types.js";

export type VulnerabilitySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface AuditFinding {
  id: string; // e.g. "GHSA-...", "CVE-..."
  packageName: string;
  ecosystem: Ecosystem;
  installedVersion: string;
  severity: VulnerabilitySeverity;
  cvssScore?: number;
  summary: string;
  details?: string;
  fixedVersion?: string;
  referenceUrl?: string;
  memberPath: string;
}

export interface AuditReport {
  scannedPackages: number;
  vulnerablePackages: number;
  totalFindings: number;
  findings: AuditFinding[];
  durationMs: number;
  hasFailure: boolean;
}

export type LicenseCategory =
  | "Permissive"
  | "Copyleft"
  | "WeakCopyleft"
  | "Proprietary"
  | "Unknown";

export interface PackageLicenseInfo {
  packageName: string;
  ecosystem: Ecosystem;
  version: string;
  license: string;
  category: LicenseCategory;
  memberPath: string;
}

export interface LicenseComplianceReport {
  totalPackages: number;
  deniedCount: number;
  warnCount: number;
  packages: PackageLicenseInfo[];
  deniedPackages: PackageLicenseInfo[];
  warnPackages: PackageLicenseInfo[];
  isCompliant: boolean;
}

export interface SbomOptions {
  format: "cyclonedx" | "spdx";
  output?: string;
  workspaceName?: string;
  workspaceVersion?: string;
}
