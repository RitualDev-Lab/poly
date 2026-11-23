import type { Ecosystem } from "../types.js";

export interface PackageVersionMetadata {
  version: string;
  publishedAt?: string;
  license?: string;
}

export interface RegistryMetadata {
  name: string;
  ecosystem: Ecosystem;
  latestVersion?: string;
  versions: Record<string, PackageVersionMetadata>;
}

export interface FirewallOptions {
  allowUntested?: boolean;
  quarantineHours?: number;
  quarantineAction?: "rollback" | "block";
  allowedLicenses?: string[];
  deniedLicenses?: string[];
  onLicenseViolation?: "block" | "warn";
  cwd?: string;
}

export interface FirewallEvaluation {
  package: string;
  ecosystem: Ecosystem;
  requestedVersion?: string;
  effectiveVersion: string;
  quarantined: boolean;
  ageHours?: number;
  quarantineHours: number;
  rollbackOccurred: boolean;
  rollbackReason?: string;
  license?: string;
  licenseViolation: boolean;
  blocked: boolean;
  blockCode?: "LICENSE_VIOLATION" | "QUARANTINE_VIOLATION";
  blockReason?: string;
  remediation?: string;
}
