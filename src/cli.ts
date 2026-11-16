#!/usr/bin/env node

import { PolyDispatcher } from "./dispatcher/index.js";
import type { Ecosystem } from "./types.js";
import { logError, logHeader } from "./ui/reporter.js";

const VERSION = "0.1.0";

const HELP_TEXT = `
⚡ poly — The Universal Polyglot CLI Package & Dependency Orchestrator
Version: ${VERSION}

USAGE:
  poly <command> [arguments] [options]

COMMANDS:
  add <package...>    Add dependencies (supports shorthand 'npm:zod', 'pypi:fastapi', 'cargo:tokio')
  remove, rm <pkg...> Remove dependencies using the active ecosystem manager
  install, i          Install dependencies for the current workspace
  which <ecosystem>   Show active CLI binary for an ecosystem (npm, pypi, cargo, go)

OPTIONS:
  -D, --dev           Install as a development dependency
  --all               Operate across all detected ecosystems in parallel
  --silent, -s        Suppress detailed subprocess stdout logs
  -h, --help          Show this help message
  -v, --version       Show poly version

EXAMPLES:
  poly add npm:zod
  poly add pypi:fastapi -D
  poly add cargo:tokio
  poly add requests          # Auto-detects Python or Node from directory context
  poly install               # Syncs dependencies for closest project
  poly install --all         # Syncs all polyglot projects across monorepo
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
  const dispatcher = new PolyDispatcher();
  const isDev = args.includes("-D") || args.includes("--dev");
  const isAll = args.includes("--all");
  const isSilent = args.includes("-s") || args.includes("--silent");

  const positionalArgs = args.slice(1).filter((arg) => !arg.startsWith("-"));

  try {
    switch (command) {
      case "add": {
        if (positionalArgs.length === 0) {
          logError("Missing package argument. Example: 'poly add pypi:fastapi' or 'poly add zod'");
          process.exit(1);
        }

        for (const pkg of positionalArgs) {
          await dispatcher.add(pkg, { isDev, silent: isSilent });
        }
        break;
      }

      case "remove":
      case "rm": {
        if (positionalArgs.length === 0) {
          logError("Missing package argument. Example: 'poly remove lodash'");
          process.exit(1);
        }

        for (const pkg of positionalArgs) {
          await dispatcher.remove(pkg, { silent: isSilent });
        }
        break;
      }

      case "install":
      case "i": {
        await dispatcher.install({ all: isAll, silent: isSilent });
        break;
      }

      case "which": {
        const ecosystem = positionalArgs[0]?.toLowerCase() as Ecosystem;
        if (!ecosystem || !["npm", "pypi", "cargo", "go"].includes(ecosystem)) {
          logError("Please specify a valid ecosystem: 'npm', 'pypi', 'cargo', or 'go'");
          process.exit(1);
        }

        const info = dispatcher.which(ecosystem);
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
