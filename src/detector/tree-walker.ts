import fs from "node:fs";
import path from "node:path";
import type { Ecosystem, ManifestContext } from "../types.js";

interface EcosystemRule {
  ecosystem: Ecosystem;
  manifests: string[];
  lockfiles: string[];
}

const ECOSYSTEM_RULES: EcosystemRule[] = [
  {
    ecosystem: "npm",
    manifests: ["package.json"],
    lockfiles: ["pnpm-lock.yaml", "bun.lockb", "bun.lock", "yarn.lock", "package-lock.json"],
  },
  {
    ecosystem: "pypi",
    manifests: ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"],
    lockfiles: ["uv.lock", "poetry.lock", "Pipfile.lock"],
  },
  {
    ecosystem: "cargo",
    manifests: ["Cargo.toml"],
    lockfiles: ["Cargo.lock"],
  },
  {
    ecosystem: "go",
    manifests: ["go.mod"],
    lockfiles: ["go.sum"],
  },
];

/**
 * Traverses upwards from the start directory up to the git root or system root,
 * collecting all project manifests and computing proximity scores.
 */
export function detectContexts(startDir: string): ManifestContext[] {
  let current = path.resolve(startDir);
  let distance = 0;
  const contexts: ManifestContext[] = [];
  const visitedEcosystems = new Set<Ecosystem>();

  while (true) {
    for (const rule of ECOSYSTEM_RULES) {
      if (visitedEcosystems.has(rule.ecosystem)) {
        continue;
      }

      for (const manifest of rule.manifests) {
        const manifestPath = path.join(current, manifest);
        if (fs.existsSync(manifestPath)) {
          let foundLockfile: string | undefined;
          for (const lockfile of rule.lockfiles) {
            const lockPath = path.join(current, lockfile);
            if (fs.existsSync(lockPath)) {
              foundLockfile = lockfile;
              break;
            }
          }

          contexts.push({
            directory: current,
            ecosystem: rule.ecosystem,
            manifestFile: manifest,
            lockfile: foundLockfile,
            distance,
          });

          visitedEcosystems.add(rule.ecosystem);
          break;
        }
      }
    }

    // Stop if we hit a git boundary or root
    const gitDir = path.join(current, ".git");
    const parent = path.dirname(current);
    if (fs.existsSync(gitDir) || parent === current) {
      break;
    }

    current = parent;
    distance += 1;
  }

  // Sort by closest distance first
  contexts.sort((a, b) => a.distance - b.distance);
  return contexts;
}

/**
 * Resolves the primary ecosystem for a directory.
 * If multiple ecosystems exist at the exact same distance (e.g. CWD has both package.json & pyproject.toml),
 * returns all conflicting contexts for disambiguation.
 */
export function resolvePrimaryContext(startDir: string): {
  primary?: ManifestContext;
  conflicts: ManifestContext[];
} {
  const all = detectContexts(startDir);
  if (all.length === 0) {
    return { primary: undefined, conflicts: [] };
  }

  const minDistance = all[0].distance;
  const closest = all.filter((c) => c.distance === minDistance);

  if (closest.length === 1) {
    return { primary: closest[0], conflicts: [] };
  }

  return { primary: undefined, conflicts: closest };
}
