import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RegistryVerifier } from "../registry/verifier.js";
import { loadWorkspaceConfig } from "../workspace/config.js";
import { verifyCompositeLockfile } from "../workspace/lockfile.js";
import type { DiagnosticCheckItem, DiagnosticStatus, DoctorReport } from "./types.js";

export class PolyDoctor {
  /**
   * Executes a comprehensive system, toolchain, registry, and workspace health inspection.
   */
  async diagnose(workspaceDir = process.cwd()): Promise<DoctorReport> {
    const start = performance.now();
    const checks: DiagnosticCheckItem[] = [];

    // 1. Toolchain Diagnostics
    this.checkNodeToolchain(checks);
    this.checkPythonToolchain(checks);
    this.checkRustToolchain(checks);
    this.checkGoToolchain(checks);

    // 2. Build Environment
    this.checkBuildEnvironment(checks);

    // 3. Network & Registry Connectivity
    await this.checkRegistryConnectivity(workspaceDir, checks);

    // 4. Workspace & Lockfile Integrity
    this.checkWorkspaceIntegrity(workspaceDir, checks);

    // Calculate overall status
    const failCount = checks.filter((c) => c.status === "FAIL").length;
    const warnCount = checks.filter((c) => c.status === "WARN").length;
    const passedCount = checks.filter((c) => c.status === "OK").length;

    let overallStatus: DiagnosticStatus = "OK";
    if (failCount > 0) {
      overallStatus = "FAIL";
    } else if (warnCount > 0) {
      overallStatus = "WARN";
    }

    return {
      overallStatus,
      passedCount,
      warnCount,
      failCount,
      checks,
      durationMs: Math.round(performance.now() - start),
    };
  }

  private checkNodeToolchain(checks: DiagnosticCheckItem[]): void {
    const ver = process.version;
    const major = Number.parseInt(ver.replace("v", "").split(".")[0], 10);
    if (major >= 20) {
      checks.push({
        id: "toolchain-node",
        name: "Node.js Runtime",
        category: "Toolchain",
        status: "OK",
        version: ver,
        message: `Node.js runtime active (${ver})`,
      });
    } else {
      checks.push({
        id: "toolchain-node",
        name: "Node.js Runtime",
        category: "Toolchain",
        status: "WARN",
        version: ver,
        message: `Node.js ${ver} detected. Poly recommends Node >= 20.0.0 for optimal performance.`,
        remediation: "Upgrade Node.js to >= 20.0.0",
      });
    }

    // Node Package Managers
    const managers: Array<{ name: string; cmd: string }> = [
      { name: "pnpm", cmd: "pnpm" },
      { name: "bun", cmd: "bun" },
      { name: "yarn", cmd: "yarn" },
      { name: "npm", cmd: "npm" },
    ];
    const availableManagers: string[] = [];

    for (const m of managers) {
      const res = this.runCommandSafe(m.cmd, ["-v"]);
      if (res.available) {
        availableManagers.push(`${m.name} (${res.output.trim()})`);
      }
    }

    if (availableManagers.length > 0) {
      const hasFast = availableManagers.some((m) => m.startsWith("pnpm") || m.startsWith("bun"));
      checks.push({
        id: "toolchain-node-managers",
        name: "Node Package Managers",
        category: "Toolchain",
        status: "OK",
        message: `Detected: ${availableManagers.join(", ")}${hasFast ? " (High-speed runner ready)" : ""}`,
      });
    } else {
      checks.push({
        id: "toolchain-node-managers",
        name: "Node Package Managers",
        category: "Toolchain",
        status: "FAIL",
        message: "No Node package manager (pnpm, bun, yarn, npm) found in PATH.",
        remediation: "Install npm or pnpm globally: npm install -g pnpm",
      });
    }
  }

  private checkPythonToolchain(checks: DiagnosticCheckItem[]): void {
    const isWindows = process.platform === "win32";
    const preferredCmd = isWindows ? "python" : "python3";
    const fallbackCmd = isWindows ? "python3" : "python";

    let pyRes = this.runCommandSafe(preferredCmd, ["--version"]);
    if (!pyRes.available) {
      pyRes = this.runCommandSafe(fallbackCmd, ["--version"]);
    }

    if (pyRes.available) {
      checks.push({
        id: "toolchain-python",
        name: "Python Runtime",
        category: "Toolchain",
        status: "OK",
        version: pyRes.output.trim(),
        message: `${pyRes.output.trim()} active`,
      });
    } else {
      checks.push({
        id: "toolchain-python",
        name: "Python Runtime",
        category: "Toolchain",
        status: "WARN",
        message: "Python runtime not detected in system PATH. (Optional if no Python services).",
        remediation: "Install Python 3.10+ from https://python.org or uv python install",
      });
    }

    // Check uv
    const uvRes = this.runCommandSafe("uv", ["--version"]);
    if (uvRes.available) {
      checks.push({
        id: "toolchain-python-uv",
        name: "Astral uv Package Manager",
        category: "Toolchain",
        status: "OK",
        version: uvRes.output.trim(),
        message: `uv active (${uvRes.output.trim()}) — ultra-fast sub-second resolver enabled`,
      });
    } else if (pyRes.available) {
      checks.push({
        id: "toolchain-python-uv",
        name: "Astral uv Package Manager",
        category: "Toolchain",
        status: "WARN",
        message: "uv is not installed. Falling back to pip/poetry (10x-50x slower).",
        remediation:
          "Install uv for lightning-fast Python installs: curl -LsSf https://astral.sh/uv/install.sh | sh",
      });
    }
  }

  private checkRustToolchain(checks: DiagnosticCheckItem[]): void {
    const cargoRes = this.runCommandSafe("cargo", ["--version"]);
    if (cargoRes.available) {
      checks.push({
        id: "toolchain-rust-cargo",
        name: "Rust & Cargo",
        category: "Toolchain",
        status: "OK",
        version: cargoRes.output.trim(),
        message: `${cargoRes.output.trim()} active`,
      });
    } else {
      checks.push({
        id: "toolchain-rust-cargo",
        name: "Rust & Cargo",
        category: "Toolchain",
        status: "WARN",
        message: "Cargo toolchain not found in PATH. (Optional if no Rust crates).",
        remediation: "Install Rust from https://rustup.rs",
      });
    }
  }

  private checkGoToolchain(checks: DiagnosticCheckItem[]): void {
    const goRes = this.runCommandSafe("go", ["version"]);
    if (goRes.available) {
      checks.push({
        id: "toolchain-go",
        name: "Go Compiler",
        category: "Toolchain",
        status: "OK",
        version: goRes.output.trim(),
        message: `${goRes.output.trim()} active`,
      });
    } else {
      checks.push({
        id: "toolchain-go",
        name: "Go Compiler",
        category: "Toolchain",
        status: "WARN",
        message: "Go toolchain not found in PATH. (Optional if no Go modules).",
        remediation: "Install Go from https://golang.org/dl",
      });
    }
  }

  private checkBuildEnvironment(checks: DiagnosticCheckItem[]): void {
    const hasGcc = this.runCommandSafe("gcc", ["--version"]).available;
    const hasClang = this.runCommandSafe("clang", ["--version"]).available;
    const hasMsvc =
      process.platform === "win32" && this.runCommandSafe("where.exe", ["cl.exe"]).available;

    if (hasGcc || hasClang || hasMsvc) {
      const name = hasGcc ? "gcc" : hasClang ? "clang" : "msvc cl.exe";
      checks.push({
        id: "build-compiler",
        name: "C/C++ Compiler",
        category: "BuildEnvironment",
        status: "OK",
        message: `Native C/C++ compiler detected (${name})`,
      });
    } else {
      checks.push({
        id: "build-compiler",
        name: "C/C++ Compiler",
        category: "BuildEnvironment",
        status: "WARN",
        message:
          "No C/C++ native compiler (gcc, clang, cl.exe) found. Native C-extensions may fail to compile from source.",
        remediation:
          process.platform === "win32"
            ? "Install Visual Studio Build Tools or LLVM"
            : "Install build-essential or Xcode command line tools",
      });
    }
  }

  private async checkRegistryConnectivity(
    workspaceDir: string,
    checks: DiagnosticCheckItem[],
  ): Promise<void> {
    const defaultEndpoints = [
      { name: "npm Registry", url: "https://registry.npmjs.org" },
      { name: "PyPI Simple API", url: "https://pypi.org/simple" },
      { name: "crates.io", url: "https://crates.io" },
    ];

    await Promise.all(
      defaultEndpoints.map(async (ep) => {
        const start = performance.now();
        try {
          const res = await fetch(ep.url, {
            method: "HEAD",
            signal: AbortSignal.timeout(2000),
          });
          const latencyMs = Math.round(performance.now() - start);

          if (res.ok || res.status === 401 || res.status === 403) {
            checks.push({
              id: `registry-${ep.name.toLowerCase().replace(/\s+/g, "-")}`,
              name: ep.name,
              category: "NetworkRegistry",
              status: "OK",
              message: `Reachable (${latencyMs}ms)`,
            });
          } else {
            checks.push({
              id: `registry-${ep.name.toLowerCase().replace(/\s+/g, "-")}`,
              name: ep.name,
              category: "NetworkRegistry",
              status: "WARN",
              message: `Returned HTTP ${res.status} (${latencyMs}ms)`,
            });
          }
        } catch (err) {
          checks.push({
            id: `registry-${ep.name.toLowerCase().replace(/\s+/g, "-")}`,
            name: ep.name,
            category: "NetworkRegistry",
            status: "WARN",
            message: `Unreachable: ${(err as Error).message}`,
            remediation: "Check your network connection, corporate proxy, or VPN settings.",
          });
        }
      }),
    );

    // Verify custom enterprise registries if configured
    const verifier = new RegistryVerifier();
    const customResults = await verifier.verifyAll(workspaceDir);
    for (const r of customResults) {
      checks.push({
        id: `registry-custom-${r.ecosystem}`,
        name: `Private Mirror (${r.ecosystem.toUpperCase()})`,
        category: "NetworkRegistry",
        status: r.isReachable ? "OK" : "FAIL",
        message: r.isReachable
          ? `Reachable at ${r.url} (${r.latencyMs}ms)`
          : `Connection failed: ${r.error ?? `HTTP ${r.httpStatus}`}`,
        remediation: r.isReachable
          ? undefined
          : `Ensure corporate mirror at ${r.url} is accessible and VPN is connected.`,
      });
    }
  }

  private checkWorkspaceIntegrity(workspaceDir: string, checks: DiagnosticCheckItem[]): void {
    // Check poly.toml
    const tomlPath = path.join(workspaceDir, "poly.toml");
    if (fs.existsSync(tomlPath)) {
      try {
        const config = loadWorkspaceConfig(workspaceDir);
        checks.push({
          id: "workspace-config",
          name: "Workspace Manifest (poly.toml)",
          category: "WorkspaceIntegrity",
          status: "OK",
          message: `Valid configuration (${config?.members.length ?? 0} member pattern(s))`,
        });
      } catch (err) {
        checks.push({
          id: "workspace-config",
          name: "Workspace Manifest (poly.toml)",
          category: "WorkspaceIntegrity",
          status: "FAIL",
          message: `Syntax error in poly.toml: ${(err as Error).message}`,
          remediation: "Fix the syntax errors in poly.toml",
        });
      }
    } else {
      checks.push({
        id: "workspace-config",
        name: "Workspace Manifest (poly.toml)",
        category: "WorkspaceIntegrity",
        status: "OK",
        message: "No root poly.toml (Operating in single-project auto-discovery mode)",
      });
    }

    // Check poly.lock
    const lockPath = path.join(workspaceDir, "poly.lock");
    if (fs.existsSync(lockPath)) {
      const drift = verifyCompositeLockfile(workspaceDir);
      if (drift.isDrifted) {
        checks.push({
          id: "workspace-lock-drift",
          name: "Composite Lockfile (poly.lock)",
          category: "WorkspaceIntegrity",
          status: "FAIL",
          message: `Drift detected: ${drift.issues.length} issue(s) found out of sync with disk.`,
          remediation: "Run 'poly sync' to reconcile poly.lock with project manifests.",
        });
      } else {
        checks.push({
          id: "workspace-lock-drift",
          name: "Composite Lockfile (poly.lock)",
          category: "WorkspaceIntegrity",
          status: "OK",
          message: "Cryptographically verified. Zero drift detected.",
        });
      }
    }
  }

  private runCommandSafe(
    command: string,
    args: string[] = [],
  ): { available: boolean; output: string } {
    try {
      const output = execSync(`${command} ${args.join(" ")}`, {
        timeout: 2500,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      });
      return { available: true, output };
    } catch {
      return { available: false, output: "" };
    }
  }
}
