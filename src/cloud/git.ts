import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Discovers the active git branch name across local workstations and CI environments.
 */
export function getCurrentGitBranch(cwd: string = process.cwd()): string {
  // 1. CI / Runner Environment Variables
  if (process.env.POLY_CACHE_BRANCH) {
    return process.env.POLY_CACHE_BRANCH.trim();
  }
  if (process.env.GITHUB_HEAD_REF) {
    return process.env.GITHUB_HEAD_REF.trim();
  }
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME.trim();
  }
  if (process.env.CI_COMMIT_REF_NAME) {
    return process.env.CI_COMMIT_REF_NAME.trim();
  }
  if (process.env.GIT_BRANCH) {
    return process.env.GIT_BRANCH.replace(/^origin\//, "").trim();
  }

  // 2. Try git CLI rev-parse
  try {
    const stdout = child_process
      .execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      })
      .trim();
    if (stdout && stdout !== "HEAD") {
      return stdout;
    }
  } catch {
    // Suppress git error (e.g., in non-git directory or git not in PATH)
  }

  // 3. Fallback: inspect .git/HEAD directly
  try {
    let dir = cwd;
    for (let i = 0; i < 6; i++) {
      const headFile = path.join(dir, ".git", "HEAD");
      if (fs.existsSync(headFile)) {
        const headContent = fs.readFileSync(headFile, "utf8").trim();
        if (headContent.startsWith("ref: refs/heads/")) {
          return headContent.replace("ref: refs/heads/", "").trim();
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Ignore filesystem read errors
  }

  return "main";
}
