#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { PolyCacheManager } from "./cache/index.js";
import {
  CrossStackAuditor,
  LicenseAuditor,
  SbomGenerator,
  type VulnerabilitySeverity,
  generateSarifReport,
} from "./compliance/index.js";
import { PolyDispatcher } from "./dispatcher/index.js";
import { PolyMcpServer, generateMcpConfig, setupIdeIntegration } from "./mcp/index.js";
import { RegistryVerifier } from "./registry/index.js";
import type { Ecosystem } from "./types.js";
import { logError, logHeader, logSuccess } from "./ui/reporter.js";
import {
  WorkspaceDispatcher,
  WorkspaceRunner,
  loadWorkspaceConfig,
  verifyCompositeLockfile,
  writeCompositeLockfile,
} from "./workspace/index.js";

const VERSION = "0.1.0";

const HELP_TEXT = `
⚡ poly — The Universal Polyglot CLI Package & Dependency Orchestrator
Version: ${VERSION}

USAGE:
  poly <command> [arguments] [options]

COMMANDS:
  add <package...>    Add dependencies (supports shorthand 'npm:zod', 'pypi:fastapi', 'cargo:tokio')
  remove, rm <pkg...> Remove dependencies using the active ecosystem manager
  install, sync, i    Install & sync dependencies across workspace members
  run <task>          Run cross-stack orchestrated tasks (e.g. 'poly run dev', 'poly run test')
  lock                Manage or verify composite 'poly.lock'
  audit               Scan dependencies across all ecosystems for known security vulnerabilities (OSV)
  license             Audit license compliance and detect copyleft contamination risks (GPL/AGPL)
  sbom                Generate compliant CycloneDX v1.5 or SPDX v2.3 Software Bill of Materials
  cache <cmd> [key]   Manage distributed CI dependency cache (save, restore, clean)
  registry test       Verify reachability and latency of enterprise registry mirrors
  mcp                 Start stdio Model Context Protocol (MCP) server for AI coding agents
  init [--ide]        Initialize workspace or generate IDE AI agent integrations (Cursor, Claude)
  which <ecosystem>   Show active CLI binary for an ecosystem (npm, pypi, cargo, go)

OPTIONS:
  -D, --dev           Install as a development dependency
  --frozen            Enforce zero-drift in CI (fails if poly.lock is out of sync)
  --verify, --check   Verify poly.lock against disk state without installing
  --fail-on <level>   Threshold to fail audit (critical, high, medium, low)
  --format <fmt>      Output format (table, json, sarif, cyclonedx, spdx)
  --json              Machine-readable JSON output mode across commands
  --output, -o <file> Save report or SBOM artifact to disk
  --filter <pattern>  Filter workspace members by directory path pattern
  --all               Operate across all detected ecosystems in parallel
  --silent, -s        Suppress detailed subprocess stdout logs
  -h, --help          Show this help message
  -v, --version       Show poly version

EXAMPLES:
  poly add npm:zod
  poly add pypi:fastapi -D
  poly add cargo:tokio
  poly install --frozen      # CI/CD mode: fails on untracked dependency drift
  poly sync                  # Synchronizes all polyglot monorepo members
  poly audit --fail-on high  # Fails build if HIGH or CRITICAL CVEs exist
  poly audit --format sarif -o security.sarif # Exports standard SARIF for GitHub
  poly license --check       # Flags forbidden AGPL/GPL copyleft licenses
  poly sbom --format cyclonedx -o sbom.json   # Exports CycloneDX 1.5 SBOM
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args.includes("-v") || args.includes("--version")) {
    console.log(`poly v${VERSION}`);
    process.exit(0);
  }

  const command = args[0].toLowerCase();
  const cwd = process.cwd();
  const isDev = args.includes("-D") || args.includes("--dev");
  const isAll = args.includes("--all");
  const isFrozen = args.includes("--frozen");
  const isVerify = args.includes("--verify") || args.includes("--check");
  const isSilent = args.includes("-s") || args.includes("--silent");
  const isJson = args.includes("--json");

  // Extract flag values
  const getFlagVal = (flag: string, short?: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    if (short) {
      const sIdx = args.indexOf(short);
      if (sIdx !== -1 && args[sIdx + 1]) return args[sIdx + 1];
    }
    return undefined;
  };

  const filterPattern = getFlagVal("--filter");
  const failOnRaw = getFlagVal("--fail-on")?.toUpperCase() as VulnerabilitySeverity | undefined;
  const formatRaw = getFlagVal("--format")?.toLowerCase();
  const outputFile = getFlagVal("--output", "-o");

  const positionalArgs = args
    .filter(
      (arg, idx, arr) =>
        !arg.startsWith("-") &&
        arr[idx - 1] !== "--filter" &&
        arr[idx - 1] !== "--fail-on" &&
        arr[idx - 1] !== "--format" &&
        arr[idx - 1] !== "--output" &&
        arr[idx - 1] !== "-o",
    )
    .slice(1);

  try {
    switch (command) {
      case "add": {
        if (positionalArgs.length === 0) {
          logError("Missing package argument. Example: 'poly add pypi:fastapi' or 'poly add zod'");
          process.exit(1);
        }

        const dispatcher = new PolyDispatcher();
        for (const pkg of positionalArgs) {
          await dispatcher.add(pkg, { isDev, silent: isSilent, cwd });
        }
        writeCompositeLockfile(cwd);
        break;
      }

      case "remove":
      case "rm": {
        if (positionalArgs.length === 0) {
          logError("Missing package argument. Example: 'poly remove lodash'");
          process.exit(1);
        }

        const dispatcher = new PolyDispatcher();
        for (const pkg of positionalArgs) {
          await dispatcher.remove(pkg, { silent: isSilent, cwd });
        }
        writeCompositeLockfile(cwd);
        break;
      }

      case "install":
      case "sync":
      case "i": {
        const workspaceConfig = loadWorkspaceConfig(cwd);

        if (workspaceConfig || isFrozen || isAll) {
          logHeader(`Synchronizing workspace (${isFrozen ? "FROZEN MODE" : "PARALLEL"})`);
          const wsDispatcher = new WorkspaceDispatcher();
          const results = await wsDispatcher.syncWorkspace(cwd, {
            frozen: isFrozen,
            silent: isSilent,
          });
          const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0);
          logSuccess(`Synchronized ${results.length} workspace members in parallel`, totalMs);
        } else {
          const dispatcher = new PolyDispatcher();
          await dispatcher.install({ all: false, silent: isSilent, cwd });
          writeCompositeLockfile(cwd);
        }
        break;
      }

      case "run": {
        const taskName = positionalArgs[0];
        if (!taskName) {
          logError("Missing task name. Example: 'poly run dev' or 'poly run test'");
          process.exit(1);
        }

        logHeader(`Running task '${taskName}' across workspace members...`);
        const runner = new WorkspaceRunner();
        const results = await runner.runTask(cwd, taskName, {
          filter: filterPattern,
          silent: isSilent,
        });

        const failed = results.filter((r) => r.exitCode !== 0);
        if (failed.length > 0) {
          logError(
            `Task '${taskName}' failed in ${failed.length} member(s): ${failed.map((f) => f.member).join(", ")}`,
          );
          process.exit(1);
        } else {
          logSuccess(`Task '${taskName}' completed successfully across all targets.`);
        }
        break;
      }

      case "lock": {
        if (isVerify) {
          const drift = verifyCompositeLockfile(cwd);
          if (isJson) {
            console.log(JSON.stringify(drift, null, 2));
            if (drift.isDrifted) process.exit(1);
          } else {
            logHeader("Verifying composite poly.lock cryptographic integrity...");
            if (drift.isDrifted) {
              logError("Supply-chain drift detected! poly.lock is out of sync with disk:");
              for (const issue of drift.issues) {
                console.error(
                  `  \x1b[31m✖\x1b[0m [${issue.memberPath}] ${issue.file}: ${issue.reason}`,
                );
              }
              process.exit(1);
            } else {
              logSuccess("poly.lock is 100% verified. All manifests and native lockfiles match.");
            }
          }
        } else {
          writeCompositeLockfile(cwd);
          logSuccess("Generated / updated composite poly.lock");
        }
        break;
      }

      case "audit": {
        logHeader("Executing cross-stack vulnerability audit (OSV)...");
        const auditor = new CrossStackAuditor();
        const report = await auditor.audit(cwd, { failOn: failOnRaw });

        if (formatRaw === "sarif") {
          const sarifJson = generateSarifReport(report);
          if (outputFile) {
            fs.writeFileSync(outputFile, sarifJson, "utf-8");
            logSuccess(`Exported SARIF report to '${outputFile}'`);
          } else {
            console.log(sarifJson);
          }
        } else if (formatRaw === "json") {
          const jsonStr = JSON.stringify(report, null, 2);
          if (outputFile) {
            fs.writeFileSync(outputFile, jsonStr, "utf-8");
            logSuccess(`Exported JSON report to '${outputFile}'`);
          } else {
            console.log(jsonStr);
          }
        } else {
          // Table / CLI terminal format
          console.log(
            `Scanned ${report.scannedPackages} packages across ecosystems (${report.durationMs}ms).`,
          );
          if (report.findings.length === 0) {
            logSuccess("0 known vulnerabilities detected. All dependencies clean.");
          } else {
            console.log(`\n\x1b[31mFound ${report.findings.length} vulnerabilities:\x1b[0m`);
            for (const f of report.findings) {
              const sevColor =
                f.severity === "CRITICAL" || f.severity === "HIGH" ? "\x1b[31m" : "\x1b[33m";
              console.log(
                `  ${sevColor}[${f.severity}]\x1b[0m \x1b[1m${f.packageName}@${f.installedVersion}\x1b[0m (${f.ecosystem}): ${f.summary}`,
              );
              if (f.fixedVersion) {
                console.log(`    ↳ Fixed in: \x1b[32m${f.fixedVersion}\x1b[0m`);
              }
            }
          }
        }

        if (report.hasFailure) {
          logError(`Audit failed: Vulnerabilities matching threshold '${failOnRaw}' detected.`);
          process.exit(1);
        }
        break;
      }

      case "license": {
        logHeader("Auditing workspace license compliance...");
        const auditor = new LicenseAuditor();
        const report = auditor.scan(cwd);

        if (formatRaw === "json") {
          const jsonStr = JSON.stringify(report, null, 2);
          if (outputFile) {
            fs.writeFileSync(outputFile, jsonStr, "utf-8");
            logSuccess(`Exported license report to '${outputFile}'`);
          } else {
            console.log(jsonStr);
          }
        } else {
          console.log(`Scanned ${report.totalPackages} packages.`);
          console.log(
            `  Permissive:   \x1b[32m${report.packages.filter((p) => p.category === "Permissive").length}\x1b[0m`,
          );
          console.log(
            `  Copyleft:     \x1b[31m${report.packages.filter((p) => p.category === "Copyleft").length}\x1b[0m`,
          );
          console.log(
            `  WeakCopyleft: \x1b[33m${report.packages.filter((p) => p.category === "WeakCopyleft").length}\x1b[0m`,
          );

          if (report.deniedPackages.length > 0) {
            console.log(
              `\n\x1b[31mForbidden Copyleft Licenses Detected (${report.deniedCount}):\x1b[0m`,
            );
            for (const p of report.deniedPackages) {
              console.log(
                `  \x1b[31m✖\x1b[0m ${p.packageName}@${p.version} (${p.ecosystem}) - \x1b[1m${p.license}\x1b[0m`,
              );
            }
          } else {
            logSuccess("Zero forbidden copyleft licenses detected.");
          }
        }

        if (isVerify && !report.isCompliant) {
          logError("License check failed: Forbidden copyleft licenses detected in dependencies.");
          process.exit(1);
        }
        break;
      }

      case "sbom": {
        const sbomFormat = (formatRaw === "spdx" ? "spdx" : "cyclonedx") as "cyclonedx" | "spdx";
        logHeader(`Generating ${sbomFormat.toUpperCase()} Software Bill of Materials (SBOM)...`);
        const generator = new SbomGenerator();
        const output = generator.generate(cwd, {
          format: sbomFormat,
          output: outputFile,
        });

        if (outputFile) {
          logSuccess(`Exported ${sbomFormat.toUpperCase()} SBOM to '${outputFile}'`);
        } else {
          console.log(output);
        }
        break;
      }

      case "cache": {
        const subCommand = positionalArgs[0]?.toLowerCase();
        const customKey = positionalArgs[1];
        const cacheManager = new PolyCacheManager();

        if (subCommand === "save") {
          logHeader("Saving dependency artifacts to distributed cache...");
          const res = await cacheManager.save(cwd, { key: customKey });
          const sizeMb = ((res.sizeBytes ?? 0) / (1024 * 1024)).toFixed(2);
          logSuccess(
            `Saved cache entry '${res.key}' (${sizeMb} MB) via ${res.storageBackend} backend`,
            res.durationMs,
          );
        } else if (subCommand === "restore") {
          logHeader("Restoring dependency artifacts from cache...");
          const res = await cacheManager.restore(cwd, { key: customKey });
          if (res.hit) {
            const sizeMb = ((res.sizeBytes ?? 0) / (1024 * 1024)).toFixed(2);
            logSuccess(`Restored cache entry '${res.key}' (${sizeMb} MB) in ${res.durationMs}ms`);
          } else {
            console.log(`Cache miss for key '${res.key}'. Fresh installation required.`);
          }
        } else if (subCommand === "clean") {
          logHeader("Purging local poly dependency cache...");
          const res = await cacheManager.clean();
          const freedMb = (res.freedBytes / (1024 * 1024)).toFixed(2);
          logSuccess(`Purged ${res.removedKeys} cache entries (freed ${freedMb} MB)`);
        } else {
          logError(
            "Invalid cache subcommand. Use: 'poly cache save', 'poly cache restore', or 'poly cache clean'",
          );
          process.exit(1);
        }
        break;
      }

      case "registry": {
        const subCommand = positionalArgs[0]?.toLowerCase();
        if (subCommand === "test" || subCommand === "check") {
          logHeader("Verifying corporate enterprise registries...");
          const verifier = new RegistryVerifier();
          const results = await verifier.verifyAll(cwd);

          if (results.length === 0) {
            console.log(
              "No custom enterprise registries configured in poly.toml or environment variables.",
            );
          } else {
            for (const r of results) {
              const statusMark = r.isReachable ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m";
              const latency = `(${r.latencyMs}ms)`;
              console.log(`  ${statusMark} [${r.ecosystem.toUpperCase()}] ${r.url} ${latency}`);
              if (!r.isReachable && r.error) {
                console.log(`    ↳ \x1b[31mError: ${r.error}\x1b[0m`);
              }
            }
          }
        } else {
          logError("Invalid registry subcommand. Use: 'poly registry test'");
          process.exit(1);
        }
        break;
      }

      case "which": {
        const ecosystem = positionalArgs[0]?.toLowerCase() as Ecosystem;
        if (!ecosystem || !["npm", "pypi", "cargo", "go"].includes(ecosystem)) {
          logError("Please specify a valid ecosystem: 'npm', 'pypi', 'cargo', or 'go'");
          process.exit(1);
        }

        const dispatcher = new PolyDispatcher();
        const info = dispatcher.which(ecosystem, cwd);
        if (isJson) {
          console.log(JSON.stringify({ ecosystem, ...info }, null, 2));
        } else {
          console.log(`Ecosystem: \x1b[36m${ecosystem}\x1b[0m`);
          console.log(`Engine:    \x1b[33m${info.engine}\x1b[0m`);
          console.log(`CLI tool:  \x1b[32m${info.effectiveCli}\x1b[0m`);
        }
        break;
      }

      case "mcp": {
        const isConfig = args.includes("--config");
        if (isConfig) {
          console.log(JSON.stringify(generateMcpConfig(), null, 2));
        } else {
          const server = new PolyMcpServer(cwd);
          server.start();
        }
        break;
      }

      case "init": {
        const isIde = args.includes("--ide");
        if (isIde) {
          const target = (positionalArgs[0]?.toLowerCase() || "all") as "cursor" | "claude" | "all";
          logHeader(`Configuring IDE extension & AI agent integration (${target})...`);
          const res = setupIdeIntegration(cwd, target);
          for (const f of res.createdFiles) {
            console.log(`  \x1b[32m✔\x1b[0m Created \x1b[1m${path.relative(cwd, f)}\x1b[0m`);
          }
          logSuccess("AI coding assistant configuration generated successfully.");
        } else {
          logHeader("Initializing poly workspace...");
          const tomlPath = path.join(cwd, "poly.toml");
          if (!fs.existsSync(tomlPath)) {
            const defaultToml = `[workspace]\nmembers = ["apps/*", "services/*", "crates/*"]\n`;
            fs.writeFileSync(tomlPath, defaultToml, "utf-8");
            logSuccess("Created poly.toml");
          } else {
            console.log("poly.toml already exists.");
          }
        }
        break;
      }

      default: {
        logError(`Unknown command '${command}'. Run 'poly --help' for usage.`);
        process.exit(1);
      }
    }
  } catch (err) {
    logError((err as Error).message);
    process.exit(1);
  }
}

main();
