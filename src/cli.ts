#!/usr/bin/env node

import { PolyDispatcher } from "./dispatcher/index.js";
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
  which <ecosystem>   Show active CLI binary for an ecosystem (npm, pypi, cargo, go)

OPTIONS:
  -D, --dev           Install as a development dependency
  --frozen            Enforce zero-drift in CI (fails if poly.lock is out of sync)
  --verify, --check   Verify poly.lock against disk state without installing
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
  poly run dev               # Runs parallel dev servers across web, api, and rust
  poly lock --verify         # Verifies poly.lock cryptographic integrity
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

  // Extract filter flag
  let filterPattern: string | undefined;
  const filterIdx = args.indexOf("--filter");
  if (filterIdx !== -1 && args[filterIdx + 1]) {
    filterPattern = args[filterIdx + 1];
  }

  const positionalArgs = args
    .slice(1)
    .filter((arg, idx, arr) => !arg.startsWith("-") && arr[idx - 1] !== "--filter");

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
        // Refresh lockfile if poly.lock exists
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
          logHeader("Verifying composite poly.lock cryptographic integrity...");
          const drift = verifyCompositeLockfile(cwd);
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
        } else {
          writeCompositeLockfile(cwd);
          logSuccess("Generated / updated composite poly.lock");
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
        console.log(`Ecosystem: \x1b[36m${ecosystem}\x1b[0m`);
        console.log(`Engine:    \x1b[33m${info.engine}\x1b[0m`);
        console.log(`CLI tool:  \x1b[32m${info.effectiveCli}\x1b[0m`);
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
