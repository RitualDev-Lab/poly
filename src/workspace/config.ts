import fs from "node:fs";
import path from "node:path";
import { detectContexts } from "../detector/tree-walker.js";
import type { ManifestContext, WorkspaceConfig } from "../types.js";

export interface ResolvedMember {
  relativeDir: string;
  absoluteDir: string;
  context: ManifestContext;
}

/**
 * Parses poly.toml or poly.json from workspace root
 */
export function loadWorkspaceConfig(workspaceDir: string): WorkspaceConfig | undefined {
  const tomlPath = path.join(workspaceDir, "poly.toml");
  const jsonPath = path.join(workspaceDir, "poly.json");

  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, "utf-8");
      return JSON.parse(content) as WorkspaceConfig;
    } catch {
      // Ignore parse failure
    }
  }

  if (fs.existsSync(tomlPath)) {
    return parseSimplePolyToml(fs.readFileSync(tomlPath, "utf-8"));
  }

  return undefined;
}

/**
 * Lightweight zero-dependency TOML parser for poly.toml
 */
export function parseSimplePolyToml(content: string): WorkspaceConfig {
  const lines = content.split("\n");
  const config: WorkspaceConfig = {
    name: "poly-workspace",
    members: [],
    engines: {},
    tasks: {},
  };

  let currentSection = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.substring(1, line.length - 1).trim();
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.substring(0, eqIdx).trim();
    const val = line.substring(eqIdx + 1).trim();

    if (currentSection === "" || currentSection === "meta") {
      if (key === "name") config.name = val.replace(/["']/g, "");
      if (key === "version") config.version = val.replace(/["']/g, "");
    } else if (currentSection === "workspace") {
      if (key === "members") {
        // e.g. members = ["apps/*", "services/inference"]
        const matches = val.match(/["']([^"']+)["']/g);
        if (matches) {
          config.members = matches.map((m) => m.replace(/["']/g, ""));
        }
      }
    } else if (currentSection === "engines") {
      if (!config.engines) config.engines = {};
      const cleanVal = val.replace(/["']/g, "");
      if (key === "python") config.engines.python = cleanVal;
      if (key === "node") config.engines.node = cleanVal;
      if (key === "rust") config.engines.rust = cleanVal;
      if (key === "go") config.engines.go = cleanVal;
      if (key === "concurrency") config.engines.concurrency = Number.parseInt(cleanVal, 10);
    } else if (currentSection === "tasks") {
      if (!config.tasks) config.tasks = {};
      // Tasks can be string commands or parallel arrays
      const cleanVal = val.replace(/["']/g, "");
      if (cleanVal.includes("[")) {
        const matches = cleanVal.match(/["']([^"']+)["']/g);
        config.tasks[key] = { parallel: matches ? matches.map((m) => m.replace(/["']/g, "")) : [] };
      } else {
        config.tasks[key] = cleanVal;
      }
    }
  }

  return config;
}

/**
 * Expands glob members and discovers all polyglot workspace projects
 */
export function resolveWorkspaceMembers(workspaceDir: string): ResolvedMember[] {
  const config = loadWorkspaceConfig(workspaceDir);
  const resolved: ResolvedMember[] = [];
  const seenPaths = new Set<string>();

  if (config && config.members.length > 0) {
    for (const memberPattern of config.members) {
      if (memberPattern.endsWith("/*")) {
        const parentDir = path.join(workspaceDir, memberPattern.slice(0, -2));
        if (fs.existsSync(parentDir)) {
          const entries = fs.readdirSync(parentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const fullPath = path.join(parentDir, entry.name);
              addMemberIfContextFound(fullPath, workspaceDir, resolved, seenPaths);
            }
          }
        }
      } else {
        const fullPath = path.join(workspaceDir, memberPattern);
        addMemberIfContextFound(fullPath, workspaceDir, resolved, seenPaths);
      }
    }
  } else {
    // Auto-discover mode: walk top-level subdirectories
    const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    // Also check root itself
    addMemberIfContextFound(workspaceDir, workspaceDir, resolved, seenPaths);

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        const fullPath = path.join(workspaceDir, entry.name);
        addMemberIfContextFound(fullPath, workspaceDir, resolved, seenPaths);
      }
    }
  }

  return resolved;
}

function addMemberIfContextFound(
  fullPath: string,
  workspaceDir: string,
  resolved: ResolvedMember[],
  seenPaths: Set<string>,
): void {
  if (seenPaths.has(fullPath) || !fs.existsSync(fullPath)) {
    return;
  }

  const contexts = detectContexts(fullPath);
  const localContext = contexts.find((c) => c.distance === 0);
  if (localContext) {
    seenPaths.add(fullPath);
    let rel = path.relative(workspaceDir, fullPath).replace(/\\/g, "/");
    if (!rel) rel = ".";

    resolved.push({
      relativeDir: rel,
      absoluteDir: fullPath,
      context: localContext,
    });
  }
}
