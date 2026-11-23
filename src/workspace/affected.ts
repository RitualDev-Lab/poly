import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type ResolvedMember, resolveWorkspaceMembers } from "./config.js";

export interface AffectedResult {
  affectedMembers: ResolvedMember[];
  allMembers: ResolvedMember[];
  changedFiles: string[];
  isAllAffected: boolean;
  affectedReasons: Map<string, string[]>;
}

/**
 * Common root/global configuration files whose modifications impact the entire monorepo.
 */
export const GLOBAL_TRIGGER_PATTERNS = [
  "poly.toml",
  "poly.json",
  "poly.lock",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "Cargo.toml",
  "go.work",
  "tsconfig.json",
  ".github/",
  ".gitignore",
];

/**
 * Inspects Git to retrieve all modified, staged, unstaged, and untracked files
 * compared against a base git reference (default: origin/main).
 */
export function getGitChangedFiles(workspaceDir: string, baseRef = "origin/main"): string[] {
  const changed = new Set<string>();

  const runGit = (args: string): string => {
    try {
      return execSync(`git ${args}`, {
        cwd: workspaceDir,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      }).trim();
    } catch {
      return "";
    }
  };

  // 1. Diff against baseRef (e.g. origin/main...HEAD)
  let diffOutput = runGit(`diff --name-only ${baseRef}...HEAD`);
  if (!diffOutput) {
    // Fallback: try baseRef directly without triple-dot
    diffOutput = runGit(`diff --name-only ${baseRef}`);
  }
  if (!diffOutput && baseRef === "origin/main") {
    // Fallback: try local main or master branch
    diffOutput = runGit("diff --name-only main...HEAD") || runGit("diff --name-only master...HEAD");
  }
  if (!diffOutput) {
    // Fallback: compare against previous commit HEAD~1
    diffOutput = runGit("diff --name-only HEAD~1");
  }

  if (diffOutput) {
    for (const line of diffOutput.split("\n")) {
      const f = line.trim();
      if (f) changed.add(f.replace(/\\/g, "/"));
    }
  }

  // 2. Unstaged changes in working tree
  const unstaged = runGit("diff --name-only");
  if (unstaged) {
    for (const line of unstaged.split("\n")) {
      const f = line.trim();
      if (f) changed.add(f.replace(/\\/g, "/"));
    }
  }

  // 3. Staged changes ready for commit
  const staged = runGit("diff --name-only --cached");
  if (staged) {
    for (const line of staged.split("\n")) {
      const f = line.trim();
      if (f) changed.add(f.replace(/\\/g, "/"));
    }
  }

  // 4. Untracked new files
  const untracked = runGit("ls-files --others --exclude-standard");
  if (untracked) {
    for (const line of untracked.split("\n")) {
      const f = line.trim();
      if (f) changed.add(f.replace(/\\/g, "/"));
    }
  }

  return Array.from(changed);
}

/**
 * Builds an inter-workspace dependency graph by inspecting project manifests
 * (package.json, Cargo.toml, pyproject.toml, go.mod).
 * Returns a map of member relativeDir -> Set of relativeDirs it depends upon.
 */
export function buildWorkspaceDependencyGraph(
  workspaceDir: string,
  members: ResolvedMember[],
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  // Create lookup tables for member by relativeDir, folder basename, and manifest package name
  const nameToMember = new Map<string, ResolvedMember>();
  for (const m of members) {
    graph.set(m.relativeDir, new Set<string>());
    nameToMember.set(m.relativeDir, m);
    nameToMember.set(path.basename(m.relativeDir), m);

    // Read package name from package.json if present
    const pkgJsonPath = path.join(m.absoluteDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        if (pkg.name) nameToMember.set(pkg.name, m);
      } catch {
        // Ignore
      }
    }
  }

  for (const member of members) {
    const deps = graph.get(member.relativeDir);
    if (!deps) continue;

    // Check package.json
    const pkgJsonPath = path.join(member.absoluteDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };
        for (const [depName, depVer] of Object.entries(allDeps)) {
          const target = nameToMember.get(depName);
          if (target && target.relativeDir !== member.relativeDir) {
            deps.add(target.relativeDir);
          } else if (typeof depVer === "string" && depVer.startsWith("workspace:")) {
            const cleanName = depName.replace(/^@[^/]+\//, "");
            const wsTarget = nameToMember.get(depName) || nameToMember.get(cleanName);
            if (wsTarget && wsTarget.relativeDir !== member.relativeDir) {
              deps.add(wsTarget.relativeDir);
            }
          }
        }
      } catch {
        // Ignore parse error
      }
    }

    // Check Cargo.toml for path dependencies
    const cargoPath = path.join(member.absoluteDir, "Cargo.toml");
    if (fs.existsSync(cargoPath)) {
      try {
        const cargoText = fs.readFileSync(cargoPath, "utf-8");
        const pathMatches = cargoText.matchAll(/path\s*=\s*["']([^"']+)["']/g);
        for (const match of pathMatches) {
          const relTarget = path
            .normalize(path.join(member.relativeDir, match[1]))
            .replace(/\\/g, "/");
          const target = members.find(
            (m) => m.relativeDir === relTarget || relTarget.endsWith(`/${m.relativeDir}`),
          );
          if (target && target.relativeDir !== member.relativeDir) {
            deps.add(target.relativeDir);
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  return graph;
}

/**
 * Resolves which workspace members are affected by git changes,
 * factoring in root triggers and downstream dependency propagation.
 */
export function resolveAffectedMembers(
  workspaceDir: string,
  options?: {
    baseRef?: string;
    changedFiles?: string[];
    filter?: string;
  },
): AffectedResult {
  const allMembers = resolveWorkspaceMembers(workspaceDir);
  const changedFiles = options?.changedFiles ?? getGitChangedFiles(workspaceDir, options?.baseRef);
  const affectedReasons = new Map<string, string[]>();

  // Check if any root trigger file was modified
  const isAllAffected = changedFiles.some((file) => {
    // Only triggers at monorepo root level
    const isRootFile = !file.includes("/") || file.startsWith(".github/");
    return isRootFile && GLOBAL_TRIGGER_PATTERNS.some((pattern) => file.startsWith(pattern));
  });

  if (isAllAffected) {
    for (const m of allMembers) {
      affectedReasons.set(m.relativeDir, ["Root configuration or global pipeline modified"]);
    }
    const filter = options?.filter;
    const filtered = filter ? allMembers.filter((m) => m.relativeDir.includes(filter)) : allMembers;

    return {
      affectedMembers: filtered,
      allMembers,
      changedFiles,
      isAllAffected: true,
      affectedReasons,
    };
  }

  // 1. Identify directly modified members
  const directlyAffected = new Set<string>();

  for (const m of allMembers) {
    if (m.relativeDir === ".") {
      const hasRootChanges = changedFiles.some((f) => !f.includes("/"));
      if (hasRootChanges) {
        directlyAffected.add(".");
        affectedReasons.set(".", ["Files modified in project root"]);
      }
      continue;
    }

    const memberPrefix = `${m.relativeDir}/`;
    const matchingFiles = changedFiles.filter(
      (f) => f.startsWith(memberPrefix) || f === m.relativeDir,
    );

    if (matchingFiles.length > 0) {
      directlyAffected.add(m.relativeDir);
      affectedReasons.set(
        m.relativeDir,
        matchingFiles.slice(0, 3).map((f) => `Modified file: ${f}`),
      );
    }
  }

  // 2. Propagate to downstream dependents via dependency graph
  const depGraph = buildWorkspaceDependencyGraph(workspaceDir, allMembers);
  const affectedSet = new Set<string>(directlyAffected);

  const queue = Array.from(directlyAffected);
  while (queue.length > 0) {
    const upstream = queue.shift();
    if (!upstream) break;
    for (const [consumer, dependencies] of depGraph.entries()) {
      if (!affectedSet.has(consumer) && dependencies.has(upstream)) {
        affectedSet.add(consumer);
        queue.push(consumer);

        const reasons = affectedReasons.get(consumer) || [];
        reasons.push(`Downstream dependent of affected project: ${upstream}`);
        affectedReasons.set(consumer, reasons);
      }
    }
  }

  let affectedMembers = allMembers.filter((m) => affectedSet.has(m.relativeDir));

  const filter = options?.filter;
  if (filter) {
    affectedMembers = affectedMembers.filter((m) => m.relativeDir.includes(filter));
  }

  return {
    affectedMembers,
    allMembers,
    changedFiles,
    isAllAffected: false,
    affectedReasons,
  };
}
