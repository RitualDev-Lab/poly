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

    case "jsr": {
      // Parse deno.json / deno.jsonc imports map (jsr:@std/path@^1.0.0, npm:zod@^3.22.0)
      try {
        const cleanJson = content.replace(/^\s*\/\/.*$/gm, "");
        const parsed = JSON.parse(cleanJson) as { imports?: Record<string, string> };
        for (const target of Object.values(parsed.imports ?? {})) {
          if (
            typeof target === "string" &&
            (target.startsWith("jsr:") || target.startsWith("npm:"))
          ) {
            deps.push(target);
          }
        }
      } catch {
        // Ignore malformed deno.json/jsonc
      }
      break;
    }

    case "pypi": {
      const fileName = path.basename(manifestPath);
      const lines = content.split("\n");

      if (fileName === "Pipfile") {
        let inPackages = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "[packages]" || trimmed === "[dev-packages]") {
            inPackages = true;
            continue;
          }
          if (trimmed.startsWith("[")) {
            inPackages = false;
            continue;
          }
          if (inPackages && trimmed && !trimmed.startsWith("#")) {
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx !== -1) {
              const name = trimmed.substring(0, eqIdx).trim().replace(/["']/g, "");
              const rawVer = trimmed
                .substring(eqIdx + 1)
                .trim()
                .replace(/["']/g, "");
              if (name) {
                deps.push(rawVer && rawVer !== "*" ? `pypi:${name}${rawVer}` : `pypi:${name}`);
              }
            }
          }
        }
        break;
      }

      // Parse dependencies = [ "fastapi>=0.110.0", ... ] in pyproject.toml or requirements.txt
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
        } else if (fileName === "requirements.txt" && trimmed && !trimmed.startsWith("#")) {
          deps.push(`pypi:${trimmed}`);
        }
      }
      break;
    }

    case "conda": {
      // Parse environment.yml dependencies: (- numpy=1.26.4, nested pip: items)
      const lines = content.split("\n");
      let inDeps = false;
      let inPip = false;

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        if (trimmed === "dependencies:") {
          inDeps = true;
          inPip = false;
          continue;
        }
        if (
          inDeps &&
          !rawLine.startsWith(" ") &&
          !rawLine.startsWith("-") &&
          trimmed.endsWith(":")
        ) {
          inDeps = false;
          inPip = false;
          continue;
        }
        if (!inDeps) continue;

        if (trimmed === "- pip:" || trimmed === "pip:") {
          inPip = true;
          continue;
        }
        if (trimmed.startsWith("- ")) {
          const item = trimmed.slice(2).trim().replace(/["']/g, "");
          if (!item) continue;
          const indent = rawLine.search(/\S|$/);
          if (inPip && indent >= 4) {
            deps.push(`pypi:${item}`);
          } else {
            inPip = false;
            deps.push(`conda:${item}`);
          }
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
