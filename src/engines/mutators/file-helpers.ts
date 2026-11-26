import fs from "node:fs";
import path from "node:path";

export interface ManifestMutationResult {
  manifestFile: string;
  changed: boolean;
}

/**
 * Resolves the first existing manifest candidate inside cwd, reads it safely,
 * runs a pure string transform, and writes back only when content changes.
 */
export function applyManifestTransform(
  cwd: string,
  candidates: readonly string[],
  transform: (content: string, resolvedPath: string) => string,
): ManifestMutationResult | null {
  for (const rel of candidates) {
    if (!rel || rel.includes("*") || rel.includes("?")) continue;
    const fullPath = path.join(cwd, rel);
    if (!fs.existsSync(fullPath)) continue;

    const current = fs.readFileSync(fullPath, "utf-8");
    const next = transform(current, fullPath);
    const changed = next !== current;
    if (changed) {
      fs.writeFileSync(fullPath, next, "utf-8");
    }
    return { manifestFile: rel, changed };
  }
  return null;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanVersionSpec(version?: string): string | undefined {
  return version?.replace(/^[~^>=<\s]+/, "").trim() || undefined;
}
