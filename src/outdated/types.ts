import type { Ecosystem } from "../types.js";

export type SemverDiff = "major" | "minor" | "patch" | "prerelease" | "unknown";

export interface OutdatedDependency {
  name: string;
  ecosystem: Ecosystem;
  current: string;
  wanted?: string;
  latest: string;
  diff: SemverDiff;
  memberPath: string;
}

export interface OutdatedScanReport {
  totalScanned: number;
  outdatedCount: number;
  majorCount: number;
  minorCount: number;
  patchCount: number;
  durationMs: number;
  packages: OutdatedDependency[];
}

export interface UpgradeResult {
  name: string;
  ecosystem: Ecosystem;
  fromVersion: string;
  toVersion: string;
  memberPath: string;
  success: boolean;
  error?: string;
}

export interface UpgradeReport {
  totalUpgraded: number;
  results: UpgradeResult[];
  durationMs: number;
  lockfileUpdated: boolean;
}
