import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceMembers } from "../workspace/config.js";
import { writeCompositeLockfile } from "../workspace/lockfile.js";
import { scanOutdatedDependencies } from "./checker.js";
import type { UpgradeReport, UpgradeResult } from "./types.js";

/**
 * Patches a package version in a project manifest file.
 */
export function patchManifestVersion(
  manifestPath: string,
  pkgName: string,
  newVersion: string,
): boolean {
  if (!fs.existsSync(manifestPath)) return false;
  const content = fs.readFileSync(manifestPath, "utf-8");

  // 1. JSON (package.json)
  if (manifestPath.endsWith(".json")) {
    try {
      const json = JSON.parse(content);
      let modified = false;
      const cleanVer = `^${newVersion.replace(/^[\^~><=v]+/, "")}`;

      if (json.dependencies?.[pkgName]) {
        json.dependencies[pkgName] = cleanVer;
        modified = true;
      }
      if (json.devDependencies?.[pkgName]) {
        json.devDependencies[pkgName] = cleanVer;
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(manifestPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
        return true;
      }
    } catch {
      return false;
    }
  }

  // 2. TOML (pyproject.toml, Cargo.toml)
  if (manifestPath.endsWith(".toml")) {
    const cleanVer = newVersion.replace(/^[\^~><=v]+/, "");
    // Replace "package = ..." or "package>=..." or dependencies = ["package>=..."]
    const regex1 = new RegExp(`("${pkgName})(?:[><=~^!]+[^"]*)?(")`, "g");
    const regex2 = new RegExp(`(${pkgName}\\s*=\\s*)"[^"]*"`, "g");

    let updated = content;
    if (regex1.test(content)) {
      updated = updated.replace(regex1, `$1>=${cleanVer}$2`);
    } else if (regex2.test(content)) {
      updated = updated.replace(regex2, `$1"${cleanVer}"`);
    }

    if (updated !== content) {
      fs.writeFileSync(manifestPath, updated, "utf-8");
      return true;
    }
  }

  // 3. requirements.txt or go.mod
  if (manifestPath.endsWith(".txt")) {
    const cleanVer = newVersion.replace(/^[\^~><=v]+/, "");
    const regex = new RegExp(`^${pkgName}==.*$`, "m");
    if (regex.test(content)) {
      const updated = content.replace(regex, `${pkgName}==${cleanVer}`);
      fs.writeFileSync(manifestPath, updated, "utf-8");
      return true;
    }
  }

  if (manifestPath.endsWith("go.mod")) {
    const cleanVer = `v${newVersion.replace(/^v/, "")}`;
    const regex = new RegExp(`(\\s+${pkgName}\\s+)v[^\\s]+`, "g");
    if (regex.test(content)) {
      const updated = content.replace(regex, `$1${cleanVer}`);
      fs.writeFileSync(manifestPath, updated, "utf-8");
      return true;
    }
  }

  return false;
}

/**
 * Batch-upgrades outdated dependencies across all workspace members and synchronizes poly.lock.
 */
export async function executeBatchUpgrade(
  workspaceDir: string,
  options?: {
    packages?: string[];
    filter?: string;
  },
): Promise<UpgradeReport> {
  const startTime = Date.now();
  const scan = await scanOutdatedDependencies(workspaceDir, { filter: options?.filter });
  const members = resolveWorkspaceMembers(workspaceDir);
  const memberMap = new Map(members.map((m) => [m.relativeDir, m]));

  const targetPackages =
    options?.packages && options.packages.length > 0
      ? scan.packages.filter((p) => options.packages?.includes(p.name))
      : scan.packages;

  const results: UpgradeResult[] = [];

  for (const item of targetPackages) {
    const member = memberMap.get(item.memberPath);
    if (!member) continue;

    const manifestPath = path.join(member.absoluteDir, member.context.manifestFile);
    const patched = patchManifestVersion(manifestPath, item.name, item.latest);

    results.push({
      name: item.name,
      ecosystem: item.ecosystem,
      fromVersion: item.current,
      toVersion: item.latest,
      memberPath: item.memberPath,
      success: patched,
      error: patched ? undefined : "Failed to patch manifest format",
    });
  }

  const successCount = results.filter((r) => r.success).length;
  let lockfileUpdated = false;

  if (successCount > 0) {
    writeCompositeLockfile(workspaceDir);
    lockfileUpdated = true;
  }

  return {
    totalUpgraded: successCount,
    results,
    durationMs: Date.now() - startTime,
    lockfileUpdated,
  };
}
