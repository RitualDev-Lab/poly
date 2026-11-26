import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { engineRegistry } from "../engines/registry.js";
import { parsePackageSpec } from "../purl/parser.js";
import type { Ecosystem } from "../types.js";
import { logError, logHeader, logInfo } from "../ui/reporter.js";

export interface TryOptions {
  args?: string[];
  silent?: boolean;
  cache?: boolean;
}

/**
 * Checks whether an executable exists in system PATH
 */
export function commandExists(cmd: string): boolean {
  try {
    const isWindows = process.platform === "win32";
    const testCmd = isWindows ? "where" : "which";
    const res = spawnSync(testCmd, [cmd], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Spawns an ephemeral command with child process stdio inheritance and handles cleanup.
 */
export async function executeEphemeral(
  executable: string,
  args: string[],
  cleanupDir?: string,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    const cleanup = () => {
      if (cleanupDir && fs.existsSync(cleanupDir)) {
        try {
          fs.rmSync(cleanupDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    };

    child.on("close", (code) => {
      cleanup();
      resolve(code ?? 0);
    });

    child.on("error", (err) => {
      logError(`Failed to execute '${executable}': ${err.message}`);
      cleanup();
      resolve(1);
    });

    process.on("SIGINT", () => {
      cleanup();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(143);
    });
  });
}

/**
 * Executes an ephemeral package via poly try / polyx across all 4 ecosystems.
 */
export async function runEphemeralTry(
  packageInput: string,
  trailingArgs: string[] = [],
  options?: TryOptions,
): Promise<number> {
  const spec = parsePackageSpec(packageInput);
  const ecosystem: Ecosystem = spec.ecosystem || "npm";
  const pkgName = spec.name;
  const versionTag = spec.version ? `@${spec.version}` : "";
  const fullPkg = `${pkgName}${versionTag}`;

  if (!options?.silent) {
    logHeader(`Ephemeral Sandbox: ${packageInput}`);
    logInfo(`Provisioning ${fullPkg} (${ecosystem}) in zero-footprint sandbox...`);
  }

  // Delegate ecosystems registering an ephemeral runner (npm, jsr, conda, go, etc.)
  const adapter = engineRegistry.getAdapter(ecosystem);
  if (adapter?.resolveEphemeralCommand) {
    const resolved = adapter.resolveEphemeralCommand(spec, trailingArgs, commandExists);
    if (resolved) {
      return executeEphemeral(resolved.command, resolved.args);
    }
  }

  // 2. Python Ecosystem: prefer uvx -> fallback pipx run -> fallback temp venv
  if (ecosystem === "pypi") {
    const hasUvx = commandExists("uvx");
    if (hasUvx) {
      return executeEphemeral("uvx", [fullPkg, ...trailingArgs]);
    }

    const hasPipx = commandExists("pipx");
    if (hasPipx) {
      return executeEphemeral("pipx", ["run", fullPkg, ...trailingArgs]);
    }

    // Isolated temp venv fallback
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-try-pypi-"));
    const pipCmd = process.platform === "win32" ? "python" : "python3";
    const installArgs = ["-m", "pip", "install", "--quiet", "--target", tmpDir, fullPkg];

    const installRes = spawnSync(pipCmd, installArgs, { stdio: "inherit" });
    if (installRes.status !== 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return installRes.status || 1;
    }

    // Locate binary in tmpDir/bin or Scripts
    const binDir =
      process.platform === "win32" ? path.join(tmpDir, "Scripts") : path.join(tmpDir, "bin");
    const binExe = path.join(binDir, pkgName);
    const targetBin = fs.existsSync(binExe) ? binExe : pkgName;

    return executeEphemeral(targetBin, trailingArgs, tmpDir);
  }

  // 3. Rust Ecosystem: cargo run / cargo install
  if (ecosystem === "cargo") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-try-cargo-"));
    const hasBinstall = commandExists("cargo-binstall");
    if (hasBinstall) {
      spawnSync("cargo-binstall", ["--no-confirm", "--root", tmpDir, fullPkg], {
        stdio: "inherit",
      });
      const binExe = path.join(
        tmpDir,
        "bin",
        pkgName + (process.platform === "win32" ? ".exe" : ""),
      );
      return executeEphemeral(binExe, trailingArgs, tmpDir);
    }

    // Default cargo install
    spawnSync("cargo", ["install", "--root", tmpDir, fullPkg], { stdio: "inherit" });
    const binExe = path.join(tmpDir, "bin", pkgName + (process.platform === "win32" ? ".exe" : ""));
    return executeEphemeral(binExe, trailingArgs, tmpDir);
  }

  // 4. Go Ecosystem: go run <pkg>@latest
  if (ecosystem === "go") {
    const goPkg = fullPkg.includes("@") ? fullPkg : `${fullPkg}@latest`;
    return executeEphemeral("go", ["run", goPkg, ...trailingArgs]);
  }

  logError(`Unsupported ecosystem '${ecosystem}' for ephemeral execution.`);
  return 1;
}
