import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Ecosystem } from "../types.js";

/**
 * Computes a standardized SHA-256 digest of a file.
 */
export function computeFileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Extracts top-level direct dependencies from native manifest files.
 */
export function extractDirectDependencies(manifestPath: string, ecosystem: Ecosystem): string[] {
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const content = fs.readFileSync(manifestPath, "utf-8");
  const deps: string[] = [];

  switch (ecosystem) {
    case "npm": {
      try {
        const json = JSON.parse(content);
        if (json.dependencies) {
          for (const [name, ver] of Object.entries(json.dependencies)) {
            deps.push(`npm:${name}@${ver}`);
          }
        }
        if (json.devDependencies) {
          for (const [name, ver] of Object.entries(json.devDependencies)) {
            deps.push(`npm:${name}@${ver}`);
          }
        }
      } catch {
        // Ignore JSON parse errors in malformed manifests
      }
      break;
    }

    case "pypi": {
      // Parse dependencies = [ "fastapi>=0.110.0", ... ] in pyproject.toml or requirements.txt
      const lines = content.split("\n");
      let inDepsSection = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("dependencies = [")) {
          inDepsSection = true;
          continue;
        }
        if (inDepsSection) {
          if (trimmed.startsWith("]")) {
            inDepsSection = false;
            continue;
          }
          const clean = trimmed.replace(/[",]/g, "").trim();
          if (clean && !clean.startsWith("#")) {
            deps.push(`pypi:${clean}`);
          }
        } else if (
          path.basename(manifestPath) === "requirements.txt" &&
          trimmed &&
          !trimmed.startsWith("#")
        ) {
          deps.push(`pypi:${trimmed}`);
        }
      }
      break;
    }

    case "cargo": {
      // Parse [dependencies] section in Cargo.toml
      const lines = content.split("\n");
      let inDeps = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "[dependencies]") {
          inDeps = true;
          continue;
        }
        if (inDeps) {
          if (trimmed.startsWith("[")) {
            inDeps = false;
            continue;
          }
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const name = trimmed.substring(0, eqIdx).trim();
            const val = trimmed
              .substring(eqIdx + 1)
              .trim()
              .replace(/"/g, "");
            deps.push(`cargo:${name}@${val}`);
          }
        }
      }
      break;
    }

    case "go": {
      // Parse require (...) block in go.mod
      const lines = content.split("\n");
      let inRequire = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("require (")) {
          inRequire = true;
          continue;
        }
        if (inRequire) {
          if (trimmed.startsWith(")")) {
            inRequire = false;
            continue;
          }
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            deps.push(`go:${parts[0]}@${parts[1]}`);
          }
        } else if (trimmed.startsWith("require ") && !trimmed.includes("(")) {
          const parts = trimmed.substring(8).trim().split(/\s+/);
          if (parts.length >= 2) {
            deps.push(`go:${parts[0]}@${parts[1]}`);
          }
        }
      }
      break;
    }
  }

  return deps.sort();
}
