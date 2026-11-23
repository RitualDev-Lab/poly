import type { Ecosystem } from "../types.js";
import type { PackageVersionMetadata, RegistryMetadata } from "./types.js";

const REGISTRY_CACHE = new Map<string, RegistryMetadata>();

/**
 * Normalizes license fields that may be string or object into a standard string
 */
export function normalizeLicenseString(rawLicense: unknown): string {
  if (!rawLicense) return "UNKNOWN";
  if (typeof rawLicense === "string") return rawLicense.trim() || "UNKNOWN";
  if (typeof rawLicense === "object" && rawLicense !== null) {
    const obj = rawLicense as Record<string, unknown>;
    if (typeof obj.type === "string") return obj.type.trim();
    if (typeof obj.name === "string") return obj.name.trim();
  }
  return "UNKNOWN";
}

/**
 * Extracts license from PyPI classifiers if top-level license string is generic
 */
export function extractPyPiLicense(info: { license?: string; classifiers?: string[] }): string {
  const top = normalizeLicenseString(info.license);
  if (top !== "UNKNOWN" && !top.toLowerCase().includes("osi approved")) {
    return top;
  }
  if (Array.isArray(info.classifiers)) {
    for (const c of info.classifiers) {
      if (c.startsWith("License :: OSI Approved :: ")) {
        return c.replace("License :: OSI Approved :: ", "").replace(" License", "").trim();
      }
      if (c.startsWith("License :: ")) {
        return c.replace("License :: ", "").replace(" License", "").trim();
      }
    }
  }
  return top;
}

/**
 * Pre-flight query to official package registries for publish timestamps and licenses.
 */
export async function fetchRegistryMetadata(
  ecosystem: Ecosystem,
  packageName: string,
  timeoutMs = 2500,
): Promise<RegistryMetadata | null> {
  const cacheKey = `${ecosystem}:${packageName.toLowerCase()}`;
  const cached = REGISTRY_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (ecosystem === "npm") {
      const encoded = packageName.startsWith("@")
        ? `@${encodeURIComponent(packageName.slice(1).split("/")[0])}%2F${encodeURIComponent(packageName.slice(1).split("/")[1] || "")}`
        : encodeURIComponent(packageName);

      const res = await fetch(`https://registry.npmjs.org/${encoded}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        "dist-tags"?: Record<string, string>;
        time?: Record<string, string>;
        versions?: Record<string, { license?: unknown; version?: string }>;
      };

      const versions: Record<string, PackageVersionMetadata> = {};
      const timeMap = data.time || {};
      const versionsMap = data.versions || {};

      for (const [ver, verData] of Object.entries(versionsMap)) {
        versions[ver] = {
          version: ver,
          publishedAt: timeMap[ver],
          license: normalizeLicenseString(verData.license),
        };
      }

      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "npm",
        latestVersion: data["dist-tags"]?.latest,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "pypi") {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        info?: { version?: string; license?: string; classifiers?: string[] };
        releases?: Record<string, Array<{ upload_time_iso_8601?: string }>>;
      };

      const latestLicense = extractPyPiLicense(data.info || {});
      const versions: Record<string, PackageVersionMetadata> = {};
      const releases = data.releases || {};

      for (const [ver, files] of Object.entries(releases)) {
        const publishedAt = files?.[0]?.upload_time_iso_8601;
        versions[ver] = {
          version: ver,
          publishedAt,
          license: latestLicense,
        };
      }

      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "pypi",
        latestVersion: data.info?.version,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "cargo") {
      const res = await fetch(
        `https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`,
        {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "poly-firewall/0.6.1 (developer@ritualdev.in)",
          },
        },
      );
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        crate?: { max_version?: string };
        versions?: Array<{ num: string; license?: string; created_at?: string }>;
      };

      const versions: Record<string, PackageVersionMetadata> = {};
      for (const v of data.versions || []) {
        versions[v.num] = {
          version: v.num,
          publishedAt: v.created_at,
          license: normalizeLicenseString(v.license),
        };
      }

      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "cargo",
        latestVersion: data.crate?.max_version,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    clearTimeout(timer);
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
