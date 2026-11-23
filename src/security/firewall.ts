import type { Ecosystem, PackageSpec } from "../types.js";
import { loadWorkspaceConfig } from "../workspace/config.js";
import { fetchRegistryMetadata } from "./registry.js";
import type { FirewallEvaluation, FirewallOptions, RegistryMetadata } from "./types.js";

const DEFAULT_DENIED_LICENSES = [
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-1.0",
  "AGPL-3.0",
  "SSPL-1.0",
  "COMMONS-CLAUSE",
];

export class FirewallBlockError extends Error {
  code: "LICENSE_VIOLATION" | "QUARANTINE_VIOLATION";
  package: string;
  version?: string;
  detectedLicense?: string;
  ageHours?: number;
  quarantineHours?: number;
  remediation: string;
  rollbackVersion?: string;

  constructor(options: {
    code: "LICENSE_VIOLATION" | "QUARANTINE_VIOLATION";
    package: string;
    version?: string;
    detectedLicense?: string;
    ageHours?: number;
    quarantineHours?: number;
    message: string;
    remediation: string;
    rollbackVersion?: string;
  }) {
    super(options.message);
    this.name = "FirewallBlockError";
    this.code = options.code;
    this.package = options.package;
    this.version = options.version;
    this.detectedLicense = options.detectedLicense;
    this.ageHours = options.ageHours;
    this.quarantineHours = options.quarantineHours;
    this.remediation = options.remediation;
    this.rollbackVersion = options.rollbackVersion;
  }

  toJSON() {
    return {
      status: "error",
      code: this.code,
      message: this.message,
      package: this.package,
      version: this.version,
      detected_license: this.detectedLicense,
      age_hours: this.ageHours !== undefined ? Number(this.ageHours.toFixed(2)) : undefined,
      quarantine_hours: this.quarantineHours,
      rollback_version: this.rollbackVersion,
      remediation: this.remediation,
    };
  }
}

export class SupplyChainFirewall {
  /**
   * Evaluates a package spec against pre-flight registry metadata and workspace security policies.
   */
  async evaluate(pkg: PackageSpec, options?: FirewallOptions): Promise<FirewallEvaluation> {
    const cwd = options?.cwd || process.cwd();
    const config = loadWorkspaceConfig(cwd);

    // 1. Resolve security settings from poly.toml with options overrides
    const quarantineHours = options?.quarantineHours ?? config?.security?.quarantineHours ?? 24;
    const quarantineAction =
      options?.quarantineAction ?? config?.security?.quarantineAction ?? "rollback";
    const deniedLicenses =
      options?.deniedLicenses ?? config?.security?.licenses?.denied ?? DEFAULT_DENIED_LICENSES;
    const allowedLicenses = options?.allowedLicenses ?? config?.security?.licenses?.allowed ?? [];
    const onLicenseViolation =
      options?.onLicenseViolation ?? config?.security?.licenses?.onViolation ?? "block";
    const allowUntested = options?.allowUntested ?? false;

    const ecosystem: Ecosystem = pkg.ecosystem || "npm";
    const meta = await fetchRegistryMetadata(ecosystem, pkg.name);

    // If registry query failed or offline, fail-open gracefully with unconstrained target version
    if (!meta || Object.keys(meta.versions).length === 0) {
      return {
        package: pkg.name,
        ecosystem,
        requestedVersion: pkg.version,
        effectiveVersion: pkg.version || "latest",
        quarantined: false,
        quarantineHours,
        rollbackOccurred: false,
        licenseViolation: false,
        blocked: false,
      };
    }

    // 2. Identify requested / target version
    const requestedVersion =
      pkg.version && pkg.version !== "latest" ? pkg.version : meta.latestVersion;
    let targetVersion = requestedVersion || meta.latestVersion || Object.keys(meta.versions)[0];

    let ageHours: number | undefined;
    let quarantined = false;
    let rollbackOccurred = false;
    let rollbackReason: string | undefined;
    let blocked = false;
    let blockCode: "LICENSE_VIOLATION" | "QUARANTINE_VIOLATION" | undefined;
    let blockReason: string | undefined;
    let remediation: string | undefined;

    // 3. Quarantine Evaluation
    const targetVerMeta = meta.versions[targetVersion];
    if (quarantineHours > 0 && !allowUntested && targetVerMeta?.publishedAt) {
      const pubTime = new Date(targetVerMeta.publishedAt).getTime();
      const now = Date.now();
      ageHours = Math.max(0, (now - pubTime) / (1000 * 60 * 60));

      if (ageHours < quarantineHours) {
        quarantined = true;

        if (quarantineAction === "rollback") {
          // Find the newest version whose publish age >= quarantineHours
          const safeVersion = this.findMatureVersion(meta, quarantineHours);
          if (safeVersion) {
            rollbackOccurred = true;
            rollbackReason = `Version ${targetVersion} published ${ageHours.toFixed(1)}h ago (< ${quarantineHours}h cooldown). Rolled back to mature release ${safeVersion}.`;
            targetVersion = safeVersion;
          } else {
            // Brand new package with zero versions older than quarantine window
            blocked = true;
            blockCode = "QUARANTINE_VIOLATION";
            blockReason = `Package '${pkg.name}@${targetVersion}' was published ${ageHours.toFixed(1)}h ago (< ${quarantineHours}h quarantine threshold) with no prior versions mature enough to rollback.`;
            remediation =
              "Pass '--allow-untested' to bypass the 24-hour quarantine window, or wait until the package matures.";
          }
        } else {
          // Block mode
          blocked = true;
          blockCode = "QUARANTINE_VIOLATION";
          blockReason = `Package '${pkg.name}@${targetVersion}' was published ${ageHours.toFixed(1)}h ago (< ${quarantineHours}h quarantine threshold).`;
          remediation =
            "Pass '--allow-untested' to bypass the 24-hour quarantine window, or use a mature pinned version.";
        }
      }
    }

    // 4. License Policy Evaluation
    const effectiveMeta = meta.versions[targetVersion];
    const detectedLicense = effectiveMeta?.license || "UNKNOWN";
    let licenseViolation = false;

    if (!blocked && detectedLicense !== "UNKNOWN") {
      const normLicense = detectedLicense.toUpperCase();

      // Check against denied list
      const isDenied = deniedLicenses.some((d) => normLicense.includes(d.toUpperCase()));

      // Check against allowlist if configured
      const isNotAllowed =
        allowedLicenses.length > 0 &&
        !allowedLicenses.some((a) => normLicense.includes(a.toUpperCase()));

      if (isDenied || isNotAllowed) {
        licenseViolation = true;
        const reasonDetail = isDenied
          ? `uses copyleft license '${detectedLicense}' which is prohibited by policy`
          : `uses license '${detectedLicense}' which is not in the approved corporate allowlist`;

        if (onLicenseViolation === "block") {
          blocked = true;
          blockCode = "LICENSE_VIOLATION";
          blockReason = `Package '${pkg.name}@${targetVersion}' ${reasonDetail}.`;
          remediation =
            "Select an alternative package with an approved permissive license (e.g. MIT, Apache-2.0, BSD), or modify [security.licenses] in poly.toml.";
        }
      }
    }

    return {
      package: pkg.name,
      ecosystem,
      requestedVersion: pkg.version,
      effectiveVersion: targetVersion,
      quarantined,
      ageHours,
      quarantineHours,
      rollbackOccurred,
      rollbackReason,
      license: detectedLicense,
      licenseViolation,
      blocked,
      blockCode,
      blockReason,
      remediation,
    };
  }

  /**
   * Scans versions sorted chronologically (newest to oldest) to find the latest version >= quarantineHours old
   */
  private findMatureVersion(meta: RegistryMetadata, quarantineHours: number): string | null {
    const now = Date.now();
    const sorted = Object.values(meta.versions)
      .filter((v) => Boolean(v.publishedAt))
      .sort((a, b) => {
        const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return timeB - timeA; // newest first
      });

    for (const ver of sorted) {
      if (!ver.publishedAt) continue;
      const ageHours = (now - new Date(ver.publishedAt).getTime()) / (1000 * 60 * 60);
      if (ageHours >= quarantineHours) {
        return ver.version;
      }
    }

    return null;
  }
}

/**
 * Convenience helper to evaluate and enforce the firewall gate. Throws FirewallBlockError on block.
 */
export async function enforcePackageFirewall(
  pkg: PackageSpec,
  options?: FirewallOptions,
): Promise<FirewallEvaluation> {
  const firewall = new SupplyChainFirewall();
  const evaluation = await firewall.evaluate(pkg, options);

  if (evaluation.blocked) {
    throw new FirewallBlockError({
      code: evaluation.blockCode || "QUARANTINE_VIOLATION",
      package: evaluation.package,
      version: evaluation.effectiveVersion,
      detectedLicense: evaluation.license,
      ageHours: evaluation.ageHours,
      quarantineHours: evaluation.quarantineHours,
      message: evaluation.blockReason || "Blocked by Poly Supply-Chain Firewall",
      remediation: evaluation.remediation || "Check workspace security configuration.",
      rollbackVersion: evaluation.effectiveVersion,
    });
  }

  return evaluation;
}
