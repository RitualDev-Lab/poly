import type { SemverDiff } from "./types.js";

/**
 * Strips prefix characters (^, ~, >=, <=, =, v) and extracts clean version.
 */
export function cleanVersion(rawVersion: string): string {
  if (!rawVersion) return "0.0.0";
  return rawVersion.trim().replace(/^[\^~><=v\s]+/, "");
}

/**
 * Parses a semantic version string into [major, minor, patch] numeric components.
 */
export function parseSemver(version: string): [number, number, number] {
  const cleaned = cleanVersion(version);
  const parts = cleaned.split("-")[0].split(".");
  const major = Number.parseInt(parts[0], 10) || 0;
  const minor = Number.parseInt(parts[1], 10) || 0;
  const patch = Number.parseInt(parts[2], 10) || 0;
  return [major, minor, patch];
}

/**
 * Compares current version and latest version to determine Semver difference.
 */
export function compareSemver(
  currentRaw: string,
  latestRaw: string,
): {
  isOutdated: boolean;
  diff: SemverDiff;
} {
  const current = cleanVersion(currentRaw);
  const latest = cleanVersion(latestRaw);

  if (current === latest) {
    return { isOutdated: false, diff: "unknown" };
  }

  const [curMajor, curMinor, curPatch] = parseSemver(current);
  const [latMajor, latMinor, latPatch] = parseSemver(latest);

  if (latMajor > curMajor) {
    return { isOutdated: true, diff: "major" };
  }

  if (latMajor === curMajor && latMinor > curMinor) {
    return { isOutdated: true, diff: "minor" };
  }

  if (latMajor === curMajor && latMinor === curMinor && latPatch > curPatch) {
    return { isOutdated: true, diff: "patch" };
  }

  return { isOutdated: false, diff: "unknown" };
}
