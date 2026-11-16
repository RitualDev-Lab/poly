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

export interface InTotoSubject {
  name: string;
  digest: {
    sha256: string;
  };
}

export interface SlsaProvenancePredicate {
  buildDefinition: {
    buildType: string;
    externalParameters: {
      workspaceDir: string;
      configHash?: string;
      lockfileHash?: string;
      ecosystems: string[];
    };
    systemParameters: {
      platform: string;
      arch: string;
      nodeVersion: string;
      gitCommit?: string;
      gitBranch?: string;
      ciRunner?: string;
    };
    resolvedDependencies?: Array<{
      uri: string;
      digest: { sha256?: string };
    }>;
  };
  runDetails: {
    builder: {
      id: string;
      version: string;
    };
    metadata: {
      invocationId: string;
      startedOn: string;
      finishedOn: string;
    };
    byproducts?: Array<{
      name: string;
      contentHash: string;
    }>;
  };
}

export interface InTotoStatement {
  _type: "https://in-toto.io/Statement/v1";
  subject: InTotoSubject[];
  predicateType: "https://slsa.dev/provenance/v1";
  predicate: SlsaProvenancePredicate;
}

export interface DsseEnvelope {
  payloadType: "application/vnd.in-toto+json";
  payload: string; // Base64 encoded UTF-8 JSON of InTotoStatement
  signatures: Array<{
    keyid: string;
    sig: string; // Base64 encoded signature
  }>;
}

export interface AttestationVerificationResult {
  valid: boolean;
  signatureVerified: boolean;
  subjectsVerified: boolean;
  subjectResults: Array<{
    name: string;
    expectedHash: string;
    actualHash?: string;
    matches: boolean;
  }>;
  statement?: InTotoStatement;
  error?: string;
}

export interface PolicyViolation {
  rule: "LICENSE_DENIED" | "LICENSE_NOT_ALLOWED" | "CVE_THRESHOLD_EXCEEDED" | "LOCKFILE_DRIFT";
  packageName?: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  message: string;
}

export interface PolicyEvaluationReport {
  passed: boolean;
  violations: PolicyViolation[];
  totalPackagesChecked: number;
  deniedLicenseCount: number;
  cveViolationCount: number;
}
