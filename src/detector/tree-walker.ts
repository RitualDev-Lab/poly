import fs from "node:fs";
import path from "node:path";
import { engineRegistry } from "../engines/registry.js";
import type { Ecosystem, ManifestContext } from "../types.js";

/**
 * Matches a single filename against an exact pattern or simple wildcard glob (e.g. *.csproj, *.rockspec, *.cabal).
 */
export function matchesManifestGlob(filename: string, pattern: string): boolean {
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return filename === pattern;
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(filename);
}

function findMatchingManifest(
  dir: string,
  patterns: readonly string[],
  cachedEntries?: string[],
): { matched?: string; entries?: string[] } {
  let entries = cachedEntries;

  for (const pattern of patterns) {
    if (!pattern.includes("*") && !pattern.includes("?")) {
      if (fs.existsSync(path.join(dir, pattern))) {
        return { matched: pattern, entries };
      }
    } else {
      if (!entries) {
        try {
          entries = fs.readdirSync(dir).sort();
        } catch {
          entries = [];
        }
      }
      const hit = entries.find((entry) => matchesManifestGlob(entry, pattern));
      if (hit) {
        return { matched: hit, entries };
      }
    }
  }

  return { matched: undefined, entries };
}

/**
 * Traverses upwards from the start directory up to the git root or system root,
 * collecting all project manifests via EngineRegistry and computing proximity scores.
 */
export function detectContexts(startDir: string): ManifestContext[] {
  let current = path.resolve(startDir);
  let distance = 0;
  const contexts: ManifestContext[] = [];
  const visitedEcosystems = new Set<Ecosystem>();

  while (true) {
    let dirEntriesCache: string[] | undefined;

    for (const adapter of engineRegistry.getAdapters()) {
      if (visitedEcosystems.has(adapter.ecosystem)) {
        continue;
      }

      const { matched: matchedManifest, entries } = findMatchingManifest(
        current,
        adapter.manifests,
        dirEntriesCache,
      );
      dirEntriesCache = entries;

      if (matchedManifest) {
        let foundLockfile: string | undefined;
        for (const lockfile of adapter.lockfiles) {
          if (fs.existsSync(path.join(current, lockfile))) {
            foundLockfile = lockfile;
            break;
          }
        }

        contexts.push({
          directory: current,
          ecosystem: adapter.ecosystem,
          manifestFile: matchedManifest,
          lockfile: foundLockfile,
          distance,
        });

        visitedEcosystems.add(adapter.ecosystem);
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
