import { execSync, spawn } from "node:child_process";
import type { ExecutionResult, PackageSpec } from "../types.js";

export abstract class BaseEngine {
  abstract readonly name: string;
  abstract readonly ecosystem: string;

  /**
   * Returns the effective CLI executable resolved for this engine instance.
   */
  getEffectiveCli(): string {
    return this.name;
  }

  /**
   * Checks if an executable command is available in the current PATH.
   */
  protected isCommandAvailable(command: string): boolean {
    const isWindows = process.platform === "win32";
    const checkCmd = isWindows ? `where.exe ${command}` : `which ${command}`;
    try {
      execSync(checkCmd, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the CLI command and arguments to add a dependency.
   */
  abstract resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] };

  /**
   * Resolves the CLI command and arguments to remove a dependency.
   */
  abstract resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] };

  /**
   * Resolves the CLI command and arguments to install/sync all dependencies.
   */
  abstract resolveInstallArgs(): { command: string; args: string[] };

  /**
   * Resolves the CLI command and arguments to update dependencies.
   */
  abstract resolveUpdateArgs(pkg?: PackageSpec): { command: string; args: string[] };

  /**
   * Executes a native command asynchronously with performance timing.
   */
  async execute(
    command: string,
    args: string[],
    cwd: string,
    options?: { silent?: boolean; env?: NodeJS.ProcessEnv },
  ): Promise<ExecutionResult> {
    const start = performance.now();

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        shell: process.platform === "win32",
        stdio: options?.silent ? "pipe" : "inherit",
        env: options?.env ? { ...process.env, ...options.env } : process.env,
      });

      let stdout = "";
      let stderr = "";

      if (options?.silent && child.stdout && child.stderr) {
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      child.on("error", (err) => {
        reject(err);
      });

      child.on("close", (code) => {
        const durationMs = Math.round(performance.now() - start);
        resolve({
          engine: this.name,
          command,
          args,
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs,
        });
      });
    });
  }
}
