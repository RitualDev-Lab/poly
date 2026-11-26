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
            "User-Agent": "poly-firewall/0.6.2 (developer@ritualdev.in)",
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

    if (ecosystem === "nuget") {
      const res = await fetch(
        `https://api.nuget.org/v3/registration5-semver1/${encodeURIComponent(packageName.toLowerCase())}/index.json`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      );
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        items?: Array<{
          items?: Array<{
            catalogEntry?: {
              version?: string;
              published?: string;
              licenseExpression?: string;
            };
          }>;
        }>;
      };
      const versions: Record<string, PackageVersionMetadata> = {};
      let latestVersion: string | undefined;
      for (const page of data.items ?? []) {
        for (const entry of page.items ?? []) {
          const cat = entry.catalogEntry;
          if (!cat?.version) continue;
          latestVersion = cat.version;
          versions[cat.version] = {
            version: cat.version,
            publishedAt: cat.published,
            license: normalizeLicenseString(cat.licenseExpression),
          };
        }
      }
      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "nuget",
        latestVersion,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "composer") {
      const pkgKey = packageName.toLowerCase();
      const res = await fetch(`https://repo.packagist.org/p2/${pkgKey}.json`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        packages?: Record<string, Array<{ version?: string; time?: string; license?: string[] }>>;
      };
      const entries = data.packages?.[pkgKey] ?? Object.values(data.packages ?? {})[0] ?? [];
      const versions: Record<string, PackageVersionMetadata> = {};
      let latestVersion: string | undefined;
      for (const item of entries) {
        if (!item.version || item.version.includes("dev")) continue;
        const clean = item.version.replace(/^v/, "");
        if (!latestVersion) latestVersion = clean;
        versions[clean] = {
          version: clean,
          publishedAt: item.time,
          license: normalizeLicenseString(item.license?.[0]),
        };
      }
      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "composer",
        latestVersion,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "gem") {
      const res = await fetch(
        `https://rubygems.org/api/v1/versions/${encodeURIComponent(packageName)}.json`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      );
      clearTimeout(timer);
      if (!res.ok) return null;

      const items = (await res.json()) as Array<{
        number?: string;
        created_at?: string;
        licenses?: string[];
        prerelease?: boolean;
      }>;
      const versions: Record<string, PackageVersionMetadata> = {};
      let latestVersion: string | undefined;
      for (const item of items) {
        if (!item.number) continue;
        if (!latestVersion && !item.prerelease) latestVersion = item.number;
        versions[item.number] = {
          version: item.number,
          publishedAt: item.created_at,
          license: normalizeLicenseString(item.licenses?.[0]),
        };
      }
      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "gem",
        latestVersion,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "pub") {
      const res = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(packageName)}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        latest?: { version?: string; published?: string };
        versions?: Array<{ version?: string; published?: string }>;
      };
      const versions: Record<string, PackageVersionMetadata> = {};
      for (const v of data.versions ?? []) {
        if (!v.version) continue;
        versions[v.version] = {
          version: v.version,
          publishedAt: v.published,
          license: "BSD-3-CLAUSE",
        };
      }
      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "pub",
        latestVersion: data.latest?.version,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "maven" || ecosystem === "gradle" || ecosystem === "sbt") {
      const normalized = packageName.includes("/") ? packageName.replace("/", ":") : packageName;
      const [groupId, artifactId] = normalized.split(":", 2);
      if (!groupId || !artifactId) {
        clearTimeout(timer);
        return null;
      }
      const url = `https://search.maven.org/solrsearch/select?q=g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}&core=gav&rows=20&wt=json`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        response?: { docs?: Array<{ v?: string; timestamp?: number }> };
      };
      const versions: Record<string, PackageVersionMetadata> = {};
      let latestVersion: string | undefined;
      for (const doc of data.response?.docs ?? []) {
        if (!doc.v) continue;
        if (!latestVersion) latestVersion = doc.v;
        versions[doc.v] = {
          version: doc.v,
          publishedAt: doc.timestamp ? new Date(doc.timestamp).toISOString() : undefined,
          license: "APACHE-2.0",
        };
      }
      const meta: RegistryMetadata = {
        name: normalized,
        ecosystem,
        latestVersion,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "hex" || ecosystem === "rebar3") {
      const res = await fetch(`https://hex.pm/api/packages/${encodeURIComponent(packageName)}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        meta?: { licenses?: string[] };
        latest_stable_version?: string;
        releases?: Array<{ version?: string; inserted_at?: string }>;
      };
      const license = normalizeLicenseString(data.meta?.licenses?.[0]);
      const versions: Record<string, PackageVersionMetadata> = {};
      for (const rel of data.releases ?? []) {
        if (!rel.version) continue;
        versions[rel.version] = {
          version: rel.version,
          publishedAt: rel.inserted_at,
          license,
        };
      }
      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem,
        latestVersion: data.latest_stable_version ?? data.releases?.[0]?.version,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "cocoapods") {
      const res = await fetch(
        `https://trunk.cocoapods.org/api/v1/pods/${encodeURIComponent(packageName)}`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      );
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        versions?: Array<{ name?: string; created_at?: string }>;
      };
      const versions: Record<string, PackageVersionMetadata> = {};
      let latestVersion: string | undefined;
      for (const v of data.versions ?? []) {
        if (!v.name) continue;
        latestVersion = v.name;
        versions[v.name] = {
          version: v.name,
          publishedAt: v.created_at,
          license: "MIT",
        };
      }
      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem: "cocoapods",
        latestVersion,
        versions,
      };
      REGISTRY_CACHE.set(cacheKey, meta);
      return meta;
    }

    if (ecosystem === "swift" || ecosystem === "carthage") {
      const stripped = packageName
        .replace(/^https?:\/\//i, "")
        .replace(/^github\.com\//i, "")
        .replace(/\.git$/i, "");
      const [owner, repo] = stripped.split("/", 2);
      if (!owner || !repo) {
        clearTimeout(timer);
        return null;
      }
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tags`, {
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "poly-firewall/0.6.2 (developer@ritualdev.in)",
        },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const tags = (await res.json()) as Array<{ name?: string }>;
      const versions: Record<string, PackageVersionMetadata> = {};
      let latestVersion: string | undefined;
      for (const t of tags) {
        if (!t.name) continue;
        const clean = t.name.replace(/^v/, "");
        if (!latestVersion) latestVersion = clean;
        versions[clean] = {
          version: clean,
          license: "UNKNOWN",
        };
      }
      const meta: RegistryMetadata = {
        name: packageName,
        ecosystem,
        latestVersion,
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
