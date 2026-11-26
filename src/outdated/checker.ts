import fs from "node:fs";
import path from "node:path";
import type { Ecosystem } from "../types.js";
import { resolveWorkspaceMembers } from "../workspace/config.js";
import { extractBackendMobileDependencies } from "../workspace/crypto.js";
import { compareSemver } from "./semver.js";
import type { OutdatedDependency, OutdatedScanReport } from "./types.js";

const REGISTRY_CACHE = new Map<string, string | null>();
const FETCH_TIMEOUT_MS = 2500;

interface RawDependencyRef {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  memberPath: string;
}

/**
 * Queries npm registry for latest published version of a package.
 */
async function fetchNpmLatest(name: string): Promise<string | null> {
  const cacheKey = `npm:${name}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const url = `https://registry.npmjs.org/${name.startsWith("@") ? name.replace("/", "%2F") : name}/latest`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }

    const data = (await res.json()) as { version?: string };
    const latest = data.version || null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

/**
 * Queries PyPI for latest published version of a package.
 */
async function fetchPypiLatest(name: string): Promise<string | null> {
  const cacheKey = `pypi:${name}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }

    const data = (await res.json()) as { info?: { version?: string } };
    const latest = data.info?.version || null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

/**
 * Queries crates.io for latest published version of a crate.
 */
async function fetchCratesLatest(name: string): Promise<string | null> {
  const cacheKey = `cargo:${name}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "poly-cli/0.5.1 (developer@ritualdev.in)" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }

    const data = (await res.json()) as { crate?: { max_version?: string } };
    const latest = data.crate?.max_version || null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

/**
 * Queries Go proxy (proxy.golang.org) for latest published version of a module.
 */
async function fetchGoLatest(name: string): Promise<string | null> {
  const cacheKey = `go:${name}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const url = `https://proxy.golang.org/${name}/@latest`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }

    const data = (await res.json()) as { Version?: string };
    const latest = data.Version?.replace(/^v/, "") || null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

async function fetchNugetLatest(name: string): Promise<string | null> {
  const cacheKey = `nuget:${name.toLowerCase()}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(
      `https://api.nuget.org/v3-flatcontainer/${encodeURIComponent(name.toLowerCase())}/index.json`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }
    const data = (await res.json()) as { versions?: string[] };
    const stable = (data.versions ?? []).filter((v) => !v.includes("-"));
    const latest = stable[stable.length - 1] ?? data.versions?.[data.versions.length - 1] ?? null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

async function fetchComposerLatest(name: string): Promise<string | null> {
  const pkgKey = name.toLowerCase();
  const cacheKey = `composer:${pkgKey}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`https://repo.packagist.org/p2/${pkgKey}.json`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }
    const data = (await res.json()) as {
      packages?: Record<string, Array<{ version?: string }>>;
    };
    const list = data.packages?.[pkgKey] ?? Object.values(data.packages ?? {})[0] ?? [];
    const stable = list.find(
      (v) => v.version && !v.version.includes("dev") && !v.version.includes("-"),
    );
    const latest = (stable?.version ?? list[0]?.version)?.replace(/^v/, "") || null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

async function fetchGemLatest(name: string): Promise<string | null> {
  const cacheKey = `gem:${name}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(
      `https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`,
      {
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }
    const items = (await res.json()) as Array<{ number?: string; prerelease?: boolean }>;
    const latest = items.find((i) => i.number && !i.prerelease)?.number ?? items[0]?.number ?? null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

async function fetchPubLatest(name: string): Promise<string | null> {
  const cacheKey = `pub:${name}`;
  if (REGISTRY_CACHE.has(cacheKey)) return REGISTRY_CACHE.get(cacheKey) || null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(name)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      REGISTRY_CACHE.set(cacheKey, null);
      return null;
    }
    const data = (await res.json()) as { latest?: { version?: string } };
    const latest = data.latest?.version || null;
    REGISTRY_CACHE.set(cacheKey, latest);
    return latest;
  } catch {
    REGISTRY_CACHE.set(cacheKey, null);
    return null;
  }
}

/**
 * Dispatches to registry fetcher based on ecosystem.
 */
export async function fetchLatestVersion(
  name: string,
  ecosystem: Ecosystem,
): Promise<string | null> {
  switch (ecosystem) {
    case "npm":
      return fetchNpmLatest(name);
    case "pypi":
      return fetchPypiLatest(name);
    case "cargo":
      return fetchCratesLatest(name);
    case "go":
      return fetchGoLatest(name);
    case "nuget":
      return fetchNugetLatest(name);
    case "composer":
      return fetchComposerLatest(name);
    case "gem":
      return fetchGemLatest(name);
    case "pub":
      return fetchPubLatest(name);
    default:
      return null;
  }
}

/**
 * Extracts raw dependency declarations from a manifest file.
 */
function extractDeclaredDependencies(
  manifestPath: string,
  ecosystem: Ecosystem,
  memberPath: string,
): RawDependencyRef[] {
  if (!fs.existsSync(manifestPath)) return [];
  const content = fs.readFileSync(manifestPath, "utf-8");
  const deps: RawDependencyRef[] = [];

  switch (ecosystem) {
    case "npm": {
      try {
        const json = JSON.parse(content);
        const allDeps = { ...json.dependencies, ...json.devDependencies };
        for (const [name, ver] of Object.entries(allDeps)) {
          if (
            typeof ver === "string" &&
            !ver.startsWith("link:") &&
            !ver.startsWith("file:") &&
            !ver.startsWith("workspace:")
          ) {
            deps.push({ name, version: ver, ecosystem: "npm", memberPath });
          }
        }
      } catch {
        // Ignore parse error
      }
      break;
    }

    case "pypi": {
      const lines = content.split("\n");
      let inDeps = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("dependencies = [") || trimmed.startsWith("dev-dependencies = [")) {
          inDeps = true;
          continue;
        }
        if (inDeps && trimmed.startsWith("]")) {
          inDeps = false;
          continue;
        }
        if (inDeps) {
          const match = trimmed.match(/"([a-zA-Z0-9_\-\.]+)(?:[><=~^!]+([^",]+))?"/);
          if (match) {
            deps.push({
              name: match[1],
              version: match[2] || "0.0.0",
              ecosystem: "pypi",
              memberPath,
            });
          }
        } else if (!trimmed.startsWith("#") && trimmed.includes("==")) {
          // requirements.txt format: pkg==1.2.3
          const parts = trimmed.split("==");
          if (parts[0] && parts[1]) {
            deps.push({
              name: parts[0].trim(),
              version: parts[1].trim(),
              ecosystem: "pypi",
              memberPath,
            });
          }
        }
      }
      break;
    }

    case "cargo": {
      const lines = content.split("\n");
      let inDeps = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[dependencies]") || trimmed.startsWith("[dev-dependencies]")) {
          inDeps = true;
          continue;
        }
        if (trimmed.startsWith("[") && inDeps) {
          inDeps = false;
          continue;
        }
        if (inDeps && trimmed.includes("=")) {
          const [key, val] = trimmed.split("=").map((s) => s.trim());
          if (key && val) {
            const verMatch = val.match(/"([^"]+)"/);
            if (verMatch) {
              deps.push({
                name: key,
                version: verMatch[1],
                ecosystem: "cargo",
                memberPath,
              });
            }
          }
        }
      }
      break;
    }

    case "go": {
      const lines = content.split("\n");
      let inRequire = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("require (")) {
          inRequire = true;
          continue;
        }
        if (inRequire && trimmed.startsWith(")")) {
          inRequire = false;
          continue;
        }
        if (inRequire || trimmed.startsWith("require ")) {
          const parts = (
            trimmed.startsWith("require ") ? trimmed.replace("require ", "") : trimmed
          ).split(/\s+/);
          if (parts.length >= 2) {
            deps.push({
              name: parts[0],
              version: parts[1].replace(/^v/, ""),
              ecosystem: "go",
              memberPath,
            });
          }
        }
      }
      break;
    }

    case "nuget":
    case "composer":
    case "gem":
    case "pub": {
      for (const item of extractBackendMobileDependencies(manifestPath, content, ecosystem)) {
        if (item.version === "any" || item.version === "latest") continue;
        deps.push({
          name: item.name,
          version: item.version,
          ecosystem: item.ecosystem,
          memberPath,
        });
      }
      break;
    }
  }

  return deps;
}

/**
 * Scans all workspace members concurrently and identifies outdated dependencies across all 4 ecosystems.
 */
export async function scanOutdatedDependencies(
  workspaceDir: string,
  options?: { filter?: string },
): Promise<OutdatedScanReport> {
  const startTime = Date.now();
  const members = resolveWorkspaceMembers(workspaceDir);
  const filter = options?.filter;
  const filtered = filter ? members.filter((m) => m.relativeDir.includes(filter)) : members;

  const rawDeps: RawDependencyRef[] = [];
  for (const member of filtered) {
    const manifestPath = path.join(member.absoluteDir, member.context.manifestFile);
    const memberDeps = extractDeclaredDependencies(
      manifestPath,
      member.context.ecosystem,
      member.relativeDir,
    );
    rawDeps.push(...memberDeps);
  }

  // Deduplicate registry lookups across members
  const uniqueKeys = new Map<string, { name: string; ecosystem: Ecosystem }>();
  for (const dep of rawDeps) {
    const key = `${dep.ecosystem}:${dep.name}`;
    if (!uniqueKeys.has(key)) {
      uniqueKeys.set(key, { name: dep.name, ecosystem: dep.ecosystem });
    }
  }

  // Concurrently fetch latest versions for all unique dependencies
  const lookupPromises = Array.from(uniqueKeys.entries()).map(async ([key, item]) => {
    const latest = await fetchLatestVersion(item.name, item.ecosystem);
    return { key, latest };
  });

  const lookupResults = await Promise.all(lookupPromises);
  const latestMap = new Map<string, string>();
  for (const res of lookupResults) {
    if (res.latest) {
      latestMap.set(res.key, res.latest);
    }
  }

  // Compare versions and build report
  const outdatedList: OutdatedDependency[] = [];
  let majorCount = 0;
  let minorCount = 0;
  let patchCount = 0;

  for (const dep of rawDeps) {
    const key = `${dep.ecosystem}:${dep.name}`;
    const latest = latestMap.get(key);
    if (!latest) continue;

    const { isOutdated, diff } = compareSemver(dep.version, latest);
    if (isOutdated) {
      if (diff === "major") majorCount++;
      else if (diff === "minor") minorCount++;
      else if (diff === "patch") patchCount++;

      outdatedList.push({
        name: dep.name,
        ecosystem: dep.ecosystem,
        current: dep.version,
        latest,
        diff,
        memberPath: dep.memberPath,
      });
    }
  }

  // Sort: major first, then minor, then patch, then name
  const diffOrder: Record<string, number> = { major: 0, minor: 1, patch: 2, unknown: 3 };
  outdatedList.sort((a, b) => {
    const ordA = diffOrder[a.diff] ?? 4;
    const ordB = diffOrder[b.diff] ?? 4;
    if (ordA !== ordB) return ordA - ordB;
    return a.name.localeCompare(b.name);
  });

  return {
    totalScanned: rawDeps.length,
    outdatedCount: outdatedList.length,
    majorCount,
    minorCount,
    patchCount,
    durationMs: Date.now() - startTime,
    packages: outdatedList,
  };
}
