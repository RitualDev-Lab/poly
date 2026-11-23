#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { PolyCacheManager } from "./cache/index.js";
import {
  handleCachePurge,
  handleCacheStatus,
  handleLogin,
  handleLogout,
  handleWhoami,
} from "./cloud/index.js";
import {
  AttestationEngine,
  CrossStackAuditor,
  LicenseAuditor,
  PolicyEvaluator,
  SbomGenerator,
  SecurityAutoHealer,
  type VulnerabilitySeverity,
  generateSarifReport,
} from "./compliance/index.js";
import { detectContexts, resolvePrimaryContext } from "./detector/index.js";
import { PolyDispatcher } from "./dispatcher/index.js";
import { DockerGenerator } from "./docker/index.js";
import { PolyDoctor } from "./doctor/index.js";
import {
  PolyMcpServer,
  generateMcpConfig,
  installMcpConfig,
  setupIdeIntegration,
} from "./mcp/index.js";
import { RegistryVerifier } from "./registry/index.js";
import type { Ecosystem } from "./types.js";
import { logError, logHeader, logSuccess } from "./ui/reporter.js";
import {
  WorkspaceDispatcher,
  WorkspaceRunner,
  extractDirectDependencies,
  loadWorkspaceConfig,
  resolveWorkspaceMembers,
  verifyCompositeLockfile,
  writeCompositeLockfile,
} from "./workspace/index.js";

const VERSION = "0.5.1";

const HELP_TEXT = `
⚡ poly — The Universal Polyglot CLI Package & Dependency Orchestrator
Version: ${VERSION}

USAGE:
  poly <command> [arguments] [options]

COMMANDS:
  add <package...>    Add dependencies (supports shorthand 'npm:zod', 'pypi:fastapi', 'cargo:tokio')
  remove, rm <pkg...> Remove dependencies using the active ecosystem manager
  install, sync, i    Install & sync dependencies across workspace members
  update, up [pkg...] Upgrade dependencies across all ecosystems
  run <task>          Run cross-stack orchestrated tasks (e.g. 'poly run dev', 'poly run test')
  test                Run unit and integration test suites across all stack members
  list, ls            List all workspace members and direct dependencies (--json for compact)
  detect              Detect and inspect ecosystems, manifests, and primary context (--json for compact)
  lock                Manage or verify composite 'poly.lock'
  audit               Scan dependencies across all ecosystems for known security vulnerabilities (OSV)
  fix [--dry-run]     Automatically patch vulnerabilities discovered during audit
  license             Audit license compliance and detect copyleft contamination risks (GPL/AGPL)
  sbom                Generate compliant CycloneDX v1.5 or SPDX v2.3 Software Bill of Materials
  cache <cmd>         Manage CI dependency cache (save, restore, clean, status, purge)
  login               Authenticate against hosted poly-cloud-api server (~/.poly/config.json)
  logout              Remove stored poly-cloud-api authentication credentials
  whoami              Show active authenticated identity and Poly Cloud API server
  registry test       Verify reachability and latency of enterprise registry mirrors
  doctor              Diagnose system health, toolchains, compilers, and network connectivity
  docker              Generate multi-stage production Dockerfile, compose, and devcontainer
  attest <cmd>        Generate, sign, or verify SLSA v1.0 in-toto supply chain attestations
  policy              Evaluate corporate compliance policy (license whitelist & CVE thresholds)
  mcp [install]       Start stdio MCP server or 1-click install for Claude Desktop, Cursor, Windsurf
  init [--ide]        Initialize workspace or generate AI agent guidelines (.cursorrules, CLAUDE.md)
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
  --url, -u <url>     Poly Cloud API server URL (for login, cache status)
  --token, -t <tok>   Poly Cloud API authentication token
  --workspace, -w <ws> Workspace slug (default: 'default')
  --branch, -b <name> Branch name for cache operations (default: current git branch)
  --all               Operate across all detected ecosystems in parallel / purge all branches
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
  const urlVal = getFlagVal("--url", "-u");
  const tokenVal = getFlagVal("--token", "-t");
  const workspaceVal = getFlagVal("--workspace", "-w") || getFlagVal("--team");
  const branchVal = getFlagVal("--branch", "-b");

  const flagNamesWithValues = new Set([
    "--filter",
    "--fail-on",
    "--format",
    "--output",
    "-o",
    "--url",
    "-u",
    "--token",
    "-t",
    "--workspace",
    "-w",
    "--team",
    "--branch",
    "-b",
  ]);

  const positionalArgs = args
    .filter((arg, idx, arr) => !arg.startsWith("-") && !flagNamesWithValues.has(arr[idx - 1]))
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

      case "update":
      case "upgrade":
      case "up": {
        const dispatcher = new PolyDispatcher();
        if (positionalArgs.length > 0) {
          for (const pkg of positionalArgs) {
            await dispatcher.update(pkg, { silent: isSilent, cwd });
          }
        } else {
          await dispatcher.update(undefined, { all: isAll, silent: isSilent, cwd });
        }
        writeCompositeLockfile(cwd);
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

      case "test": {
        const isJsonOutput = isJson || formatRaw === "json";
        if (!isJsonOutput) {
          logHeader("Running test suites across workspace members...");
        }
        const runner = new WorkspaceRunner();
        const results = await runner.runTask(cwd, "test", {
          filter: filterPattern,
          silent: isSilent,
        });

        const failed = results.filter((r) => r.exitCode !== 0);
        if (isJsonOutput) {
          console.log(
            JSON.stringify(
              {
                task: "test",
                total: results.length,
                passed: results.filter((r) => r.exitCode === 0).length,
                failed: failed.length,
                results: results.map((r) => ({
                  member: r.member,
                  command: r.command,
                  exitCode: r.exitCode,
                  success: r.exitCode === 0,
                })),
              },
              null,
              2,
            ),
          );
        } else {
          if (failed.length > 0) {
            logError(
              `Tests failed in ${failed.length} member(s): ${failed.map((f) => f.member).join(", ")}`,
            );
          } else {
            logSuccess("All test suites passed successfully across all workspace targets.");
          }
        }

        if (failed.length > 0) {
          process.exit(1);
        }
        break;
      }

      case "detect": {
        const isJsonOutput = isJson || formatRaw === "json";
        const contexts = detectContexts(cwd);
        const primary = resolvePrimaryContext(cwd);

        if (isJsonOutput) {
          const compactOutput = {
            root: cwd,
            primary: primary.primary
              ? {
                  ecosystem: primary.primary.ecosystem,
                  manifest: primary.primary.manifestFile,
                  lockfile: primary.primary.lockfile,
                  directory: path.relative(cwd, primary.primary.directory) || ".",
                }
              : null,
            conflicts: primary.conflicts.map((c) => ({
              ecosystem: c.ecosystem,
              manifest: c.manifestFile,
              lockfile: c.lockfile,
              directory: path.relative(cwd, c.directory) || ".",
            })),
            environments: contexts.map((c) => ({
              ecosystem: c.ecosystem,
              manifest: c.manifestFile,
              lockfile: c.lockfile,
              directory: path.relative(cwd, c.directory) || ".",
              distance: c.distance,
            })),
          };
          console.log(JSON.stringify(compactOutput, null, 2));
        } else {
          logHeader("Detecting project environments and manifests...");
          if (contexts.length === 0) {
            console.log("No recognized manifests found in current directory or parent tree.");
          } else {
            console.log(`\nFound ${contexts.length} project environment(s):`);
            for (const c of contexts) {
              const relDir = path.relative(cwd, c.directory) || ".";
              console.log(
                `  • \x1b[1m${c.ecosystem}\x1b[0m at \x1b[36m${relDir}\x1b[0m (manifest: ${c.manifestFile}${c.lockfile ? `, lockfile: ${c.lockfile}` : ""})`,
              );
            }
            if (primary.primary) {
              logSuccess(
                `Primary active ecosystem: ${primary.primary.ecosystem} (${primary.primary.manifestFile})`,
              );
            }
          }
        }
        break;
      }

      case "list":
      case "ls": {
        const isJsonOutput = isJson || formatRaw === "json";
        const members = resolveWorkspaceMembers(cwd);
        const memberList = [];
        let totalDepsCount = 0;

        for (const m of members) {
          const manifestPath = path.join(m.absoluteDir, m.context.manifestFile);
          const deps = extractDirectDependencies(manifestPath, m.context.ecosystem);
          totalDepsCount += deps.length;
          memberList.push({
            path: m.relativeDir,
            ecosystem: m.context.ecosystem,
            manifest: m.context.manifestFile,
            lockfile: m.context.lockfile,
            dependencyCount: deps.length,
            dependencies: deps,
          });
        }

        if (isJsonOutput) {
          const compactOutput = {
            workspace: path.basename(cwd),
            totalMembers: members.length,
            totalDependencies: totalDepsCount,
            members: memberList,
          };
          console.log(JSON.stringify(compactOutput, null, 2));
        } else {
          logHeader(`Listing workspace members & dependencies (${members.length} members)...`);
          for (const m of memberList) {
            console.log(
              `\n  \x1b[1m${m.path}\x1b[0m (\x1b[36m${m.ecosystem}\x1b[0m — ${m.manifest}):`,
            );
            if (m.dependencies.length === 0) {
              console.log("    (no direct dependencies declared)");
            } else {
              for (const dep of m.dependencies) {
                console.log(`    • ${dep}`);
              }
            }
          }
          console.log(
            `\nTotal: ${totalDepsCount} direct dependencies across ${members.length} workspace members.`,
          );
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
        const isJsonOutput = isJson || formatRaw === "json";
        if (!isJsonOutput) {
          logHeader("Executing cross-stack vulnerability audit (OSV)...");
        }
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
        } else if (isJsonOutput) {
          const compactReport = {
            scannedPackages: report.scannedPackages,
            vulnerablePackages: report.vulnerablePackages,
            totalFindings: report.totalFindings,
            clean: !report.hasFailure && report.totalFindings === 0,
            hasFailure: report.hasFailure,
            durationMs: report.durationMs,
            findings: report.findings.map((f) => ({
              package: f.packageName,
              version: f.installedVersion,
              ecosystem: f.ecosystem,
              severity: f.severity,
              summary: f.summary,
              fixedVersion: f.fixedVersion,
              memberPath: f.memberPath,
            })),
          };
          const jsonStr = JSON.stringify(compactReport, null, 2);
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
          if (!isJsonOutput) {
            logError(`Audit failed: Vulnerabilities matching threshold '${failOnRaw}' detected.`);
          }
          process.exit(1);
        }
        break;
      }

      case "fix": {
        const isDryRun = args.includes("--dry-run");
        logHeader(
          `Executing Automated Security Auto-Heal (${isDryRun ? "DRY-RUN" : "APPLYING PATCHES"})...`,
        );
        const healer = new SecurityAutoHealer();
        const report = await healer.fix(cwd, { dryRun: isDryRun, minSeverity: failOnRaw });

        if (isJson) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(`Scanned ${report.scannedPackages} packages (${report.durationMs}ms).`);
          console.log(`Total vulnerabilities found: ${report.totalVulnerabilities}`);
          console.log(`Remediated packages: \x1b[32m${report.fixedCount}\x1b[0m`);
          console.log(`Unfixable vulnerabilities: \x1b[33m${report.unfixableCount}\x1b[0m\n`);

          for (const r of report.remediated) {
            console.log(
              `  \x1b[32m✔\x1b[0m \x1b[1m${r.packageName}\x1b[0m (${r.ecosystem}): bumped \x1b[31m${r.previousVersion}\x1b[0m → \x1b[32m${r.fixedVersion}\x1b[0m`,
            );
            console.log(
              `    ↳ Patched: ${path.relative(cwd, r.manifestPath)} (Resolves: ${r.cveIds.join(", ")})`,
            );
          }

          if (report.fixedCount > 0 && !isDryRun) {
            logSuccess(
              `Successfully remediated ${report.fixedCount} packages and synchronized poly.lock.`,
            );
          } else if (report.fixedCount === 0) {
            logSuccess("Zero vulnerabilities required patching. Dependencies up-to-date.");
          }
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

      case "login": {
        const ok = await handleLogin({
          url: urlVal,
          token: tokenVal,
          workspace: workspaceVal,
        });
        if (!ok) process.exit(1);
        break;
      }

      case "logout": {
        handleLogout();
        break;
      }

      case "whoami": {
        handleWhoami({ json: isJson });
        break;
      }

      case "cache": {
        const subCommand = positionalArgs[0]?.toLowerCase();
        const customKey = positionalArgs[1];
        const cacheManager = new PolyCacheManager();

        if (subCommand === "login") {
          const ok = await handleLogin({
            url: urlVal,
            token: tokenVal,
            workspace: workspaceVal,
          });
          if (!ok) process.exit(1);
        } else if (subCommand === "logout") {
          handleLogout();
        } else if (subCommand === "whoami") {
          handleWhoami({ json: isJson });
        } else if (subCommand === "status") {
          const status = await handleCacheStatus({
            url: urlVal,
            token: tokenVal,
            workspace: workspaceVal,
            json: isJson,
          });
          if (!status || !status.healthy) {
            process.exit(1);
          }
        } else if (subCommand === "purge") {
          await handleCachePurge({
            branch: branchVal || customKey,
            all: isAll,
            url: urlVal,
            token: tokenVal,
            workspace: workspaceVal,
            cwd,
          });
        } else if (subCommand === "save") {
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
            "Invalid cache subcommand. Use: 'poly cache status', 'poly cache purge', 'poly cache save', 'poly cache restore', or 'poly login'",
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

      case "doctor": {
        logHeader("Diagnosing system health, toolchains, and workspace integrity...");
        const doctor = new PolyDoctor();
        const report = await doctor.diagnose(cwd);

        if (isJson) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          // Group by category
          const categories = [
            "Toolchain",
            "BuildEnvironment",
            "NetworkRegistry",
            "WorkspaceIntegrity",
          ] as const;

          for (const cat of categories) {
            const catChecks = report.checks.filter((c) => c.category === cat);
            if (catChecks.length === 0) continue;

            console.log(`\n\x1b[1m[${cat}]\x1b[0m`);
            for (const c of catChecks) {
              const icon =
                c.status === "OK"
                  ? "\x1b[32m✔\x1b[0m"
                  : c.status === "WARN"
                    ? "\x1b[33m▲\x1b[0m"
                    : "\x1b[31m✖\x1b[0m";

              console.log(`  ${icon} \x1b[1m${c.name}\x1b[0m: ${c.message}`);
              if (c.remediation) {
                console.log(`    ↳ \x1b[36mRemediation:\x1b[0m ${c.remediation}`);
              }
            }
          }

          console.log("\n──────────────────────────────────────────────────");
          console.log(
            `Diagnostic Summary (${report.durationMs}ms): ` +
              `\x1b[32m${report.passedCount} passed\x1b[0m, ` +
              `\x1b[33m${report.warnCount} warnings\x1b[0m, ` +
              `\x1b[31m${report.failCount} failed\x1b[0m`,
          );

          if (report.overallStatus === "OK") {
            logSuccess("All systems optimal. Your environment is fully configured for poly.");
          } else if (report.overallStatus === "WARN") {
            console.log(
              "\x1b[33m▲ System functional with recommendations. See remediations above.\x1b[0m",
            );
          } else {
            logError("Critical environment issues detected. Please follow the remediations above.");
            process.exit(1);
          }
        }
        break;
      }

      case "docker": {
        const isDevcontainer = args.includes("--devcontainer");
        const isDryRun = args.includes("--dry-run");
        const outDir = getFlagVal("--output-dir", "--out") || cwd;

        logHeader("Generating polyglot multi-stage Docker & container configuration...");
        const generator = new DockerGenerator();
        const artifacts = generator.generate({
          workspaceDir: cwd,
          outputDir: outDir,
          devcontainer: isDevcontainer,
          dryRun: isDryRun,
        });

        if (isJson) {
          console.log(JSON.stringify(artifacts, null, 2));
        } else {
          if (isDryRun) {
            console.log("\x1b[33m--- Dockerfile (Dry-Run Preview) ---\x1b[0m\n");
            console.log(artifacts.dockerfile);
            console.log("\x1b[33m--- docker-compose.yml (Dry-Run Preview) ---\x1b[0m\n");
            console.log(artifacts.dockerCompose);
            if (artifacts.devcontainerJson) {
              console.log(
                "\x1b[33m--- .devcontainer/devcontainer.json (Dry-Run Preview) ---\x1b[0m\n",
              );
              console.log(artifacts.devcontainerJson);
            }
          } else {
            for (const f of artifacts.createdFiles) {
              console.log(`  \x1b[32m✔\x1b[0m Created \x1b[1m${path.relative(cwd, f)}\x1b[0m`);
            }
            logSuccess("Multi-stage container files generated successfully.");
          }
        }
        break;
      }

      case "attest": {
        const subCmd = args[1] || "generate";
        const engine = new AttestationEngine();
        const outFile = getFlagVal("--output", "-o");

        if (subCmd === "keygen") {
          logHeader("Generating Ed25519 Cryptographic Signing Keypair...");
          const keyDir = getFlagVal("--output-dir", "--out") || cwd;
          const { privateKey, publicKey } = engine.generateKeyPair();
          const privPath = path.join(keyDir, "poly-key.pem");
          const pubPath = path.join(keyDir, "poly-key.pub");

          fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
          fs.writeFileSync(pubPath, publicKey, "utf-8");

          if (isJson) {
            console.log(JSON.stringify({ privateKey: privPath, publicKey: pubPath }, null, 2));
          } else {
            console.log(
              `  \x1b[32m✔\x1b[0m Generated Private Key: \x1b[1m${path.relative(cwd, privPath)}\x1b[0m`,
            );
            console.log(
              `  \x1b[32m✔\x1b[0m Generated Public Key:  \x1b[1m${path.relative(cwd, pubPath)}\x1b[0m`,
            );
            logSuccess("Ed25519 signing keypair generated successfully.");
          }
          break;
        }

        if (subCmd === "generate") {
          logHeader("Generating in-toto SLSA Provenance v1.0 Attestation...");
          const statement = engine.generateStatement({
            workspaceDir: cwd,
            builderVersion: VERSION,
          });

          if (outFile) {
            fs.writeFileSync(outFile, JSON.stringify(statement, null, 2), "utf-8");
            logSuccess(`Attestation statement written to ${outFile}`);
          } else {
            console.log(JSON.stringify(statement, null, 2));
          }
          break;
        }

        if (subCmd === "sign") {
          const keyPath = getFlagVal("--key");
          if (!keyPath) {
            logError("Missing required '--key <private-key.pem>' parameter.");
            process.exit(1);
          }

          if (!fs.existsSync(keyPath)) {
            logError(`Private key file not found: ${keyPath}`);
            process.exit(1);
          }

          logHeader("Signing in-toto Provenance Statement with Private Key...");
          const privKeyPem = fs.readFileSync(keyPath, "utf-8");
          const statement = engine.generateStatement({
            workspaceDir: cwd,
            builderVersion: VERSION,
          });
          const keyId = getFlagVal("--key-id") || "poly-key-1";
          const envelope = engine.signStatement(statement, privKeyPem, keyId);

          if (outFile) {
            fs.writeFileSync(outFile, JSON.stringify(envelope, null, 2), "utf-8");
            logSuccess(`DSSE Signed Envelope written to ${outFile}`);
          } else {
            console.log(JSON.stringify(envelope, null, 2));
          }
          break;
        }

        if (subCmd === "verify") {
          const attestFile = getFlagVal("--attestation", "--file");
          const keyPath = getFlagVal("--key");

          if (!attestFile || !keyPath) {
            logError(
              "Verification requires '--attestation <file.json>' and '--key <public-key.pem>'.",
            );
            process.exit(1);
          }

          if (!fs.existsSync(attestFile)) {
            logError(`Attestation envelope file not found: ${attestFile}`);
            process.exit(1);
          }
          if (!fs.existsSync(keyPath)) {
            logError(`Public key file not found: ${keyPath}`);
            process.exit(1);
          }

          logHeader("Verifying DSSE Supply Chain Attestation & Artifact Signatures...");
          const envelope = JSON.parse(fs.readFileSync(attestFile, "utf-8"));
          const pubKey = fs.readFileSync(keyPath, "utf-8");
          const res = engine.verifyEnvelope(envelope, pubKey, cwd);

          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            if (res.signatureVerified) {
              console.log(
                "  \x1b[32m✔\x1b[0m Cryptographic Signature: \x1b[32mVALID\x1b[0m (Authentic Publisher)",
              );
            } else {
              console.log("  \x1b[31m✖\x1b[0m Cryptographic Signature: \x1b[31mINVALID\x1b[0m");
            }

            for (const s of res.subjectResults) {
              if (s.matches) {
                console.log(
                  `  \x1b[32m✔\x1b[0m Subject '${s.name}': \x1b[32mZERO DRIFT\x1b[0m (${s.expectedHash.slice(0, 16)}...)`,
                );
              } else {
                console.log(
                  `  \x1b[31m✖\x1b[0m Subject '${s.name}': \x1b[31mTAMPERED / MISMATCH\x1b[0m`,
                );
              }
            }

            if (res.valid) {
              logSuccess("SLSA Provenance Attestation & Artifact Integrity Verified.");
            } else {
              logError(
                `Verification failed: ${res.error || "Artifact drift or invalid signature"}`,
              );
              process.exit(1);
            }
          }
          break;
        }

        logError(
          `Unknown attest command: '${subCmd}'. Valid subcommands: generate, sign, verify, keygen`,
        );
        process.exit(1);
        break;
      }

      case "policy": {
        logHeader("Evaluating Corporate Governance Policy & Security Gates...");
        const evaluator = new PolicyEvaluator();
        const shouldFail = args.includes("--fail-on-violation") || !args.includes("--no-fail");
        const cveThreshold = getFlagVal("--fail-on") as VulnerabilitySeverity | undefined;

        const report = await evaluator.evaluate(cwd, {
          failOnCveSeverity: cveThreshold,
          checkLockfileDrift: true,
        });

        if (isJson) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(`\x1b[1mPackages Scanned:\x1b[0m ${report.totalPackagesChecked}`);
          console.log(
            `\x1b[1mLicense Denials:\x1b[0m  ${report.deniedLicenseCount === 0 ? "\x1b[32m0\x1b[0m" : `\x1b[31m${report.deniedLicenseCount}\x1b[0m`}`,
          );
          console.log(
            `\x1b[1mCVE Violations:\x1b[0m   ${report.cveViolationCount === 0 ? "\x1b[32m0\x1b[0m" : `\x1b[31m${report.cveViolationCount}\x1b[0m`}\n`,
          );

          if (report.violations.length > 0) {
            console.log("\x1b[31m\x1b[1mPolicy Violations Detected:\x1b[0m");
            for (const v of report.violations) {
              console.log(`  \x1b[31m✖\x1b[0m [${v.rule}] ${v.message}`);
            }
          }

          if (report.passed) {
            logSuccess("All corporate governance and security policies passed.");
          } else {
            logError("Corporate governance policy failed with violations.");
            if (shouldFail) {
              process.exit(1);
            }
          }
        }
        break;
      }

      case "mcp": {
        const subCommand = positionalArgs[0]?.toLowerCase();
        const isInstall = subCommand === "install" || args.includes("install");
        const isConfig = args.includes("--config") || subCommand === "config";
        const isJsonOutput = isJson || formatRaw === "json";

        if (isInstall) {
          const res = installMcpConfig(cwd);
          if (isJsonOutput) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            logHeader("Auto-detecting and injecting Poly MCP server into AI coding agents...");
            for (const target of res.targets) {
              if (target.status === "created" || target.status === "updated") {
                console.log(
                  `  \x1b[32m✔\x1b[0m \x1b[1m${target.displayName}\x1b[0m: Injected poly into \x1b[36m${target.path}\x1b[0m (${target.status})`,
                );
              } else if (target.error) {
                console.log(
                  `  \x1b[33m▲\x1b[0m \x1b[1m${target.displayName}\x1b[0m: Skipped (${target.error})`,
                );
              }
            }
            logSuccess(
              "Poly MCP server installed across detected AI coding agents (Claude Desktop, Cursor, Windsurf)!",
            );
          }
        } else if (isConfig) {
          console.log(JSON.stringify(generateMcpConfig(), null, 2));
        } else {
          const server = new PolyMcpServer(cwd);
          server.start();
        }
        break;
      }

      case "init": {
        const isIde = args.includes("--ide");
        const isJsonOutput = isJson || formatRaw === "json";
        if (isIde) {
          const target = (positionalArgs[0]?.toLowerCase() || "all") as "cursor" | "claude" | "all";
          const res = setupIdeIntegration(cwd, target);
          if (isJsonOutput) {
            console.log(
              JSON.stringify(
                {
                  success: true,
                  target,
                  files: res.createdFiles.map((f) => path.relative(cwd, f)),
                },
                null,
                2,
              ),
            );
          } else {
            logHeader(`Configuring IDE extension & AI agent integration (${target})...`);
            for (const f of res.createdFiles) {
              console.log(`  \x1b[32m✔\x1b[0m Created \x1b[1m${path.relative(cwd, f)}\x1b[0m`);
            }
            logSuccess(
              "AI coding assistant directives generated (.cursorrules, .cursor/rules/poly.mdc, CLAUDE.md)!",
            );
          }
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
