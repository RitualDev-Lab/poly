import fs from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, resolveWorkspaceMembers } from "../workspace/config.js";
import type { CommandDefinition, SupportedShell } from "./types.js";

export const POLY_COMMANDS: CommandDefinition[] = [
  { name: "add", description: "Add dependencies across ecosystems (e.g. npm:zod, pypi:fastapi)" },
  {
    name: "remove",
    aliases: ["rm"],
    description: "Remove dependencies using the active ecosystem manager",
  },
  {
    name: "install",
    aliases: ["sync", "i"],
    description: "Install & synchronize dependencies across all workspace members",
  },
  { name: "update", aliases: ["up"], description: "Update dependencies across all ecosystems" },
  {
    name: "upgrade",
    description: "Batch upgrade outdated dependencies across all monorepo members",
  },
  {
    name: "outdated",
    description: "Scan outdated dependencies across Node.js, Python, Rust, and Go",
  },
  {
    name: "run",
    description: "Run cross-stack orchestrated tasks (e.g. poly run dev, poly run test)",
  },
  { name: "test", description: "Run unit and integration test suites across all stack members" },
  {
    name: "detect",
    description: "Detect project environments and primary ecosystem (--json for compact)",
  },
  {
    name: "list",
    aliases: ["ls"],
    description: "List workspace members and direct dependencies (--json for compact)",
  },
  { name: "lock", description: "Manage or verify composite poly.lock cryptographic integrity" },
  {
    name: "audit",
    description: "Scan dependencies across all ecosystems for known security vulnerabilities (OSV)",
  },
  { name: "fix", description: "Automatically patch vulnerabilities discovered during audit" },
  {
    name: "license",
    description: "Audit license compliance and detect copyleft contamination risks",
  },
  {
    name: "sbom",
    description: "Generate compliant CycloneDX v1.5 or SPDX v2.3 Software Bill of Materials",
  },
  {
    name: "cache",
    description: "Manage CI dependency cache (save, restore, clean, status, purge)",
  },
  { name: "login", description: "Authenticate against hosted poly-cloud-api server" },
  { name: "logout", description: "Remove stored poly-cloud-api authentication credentials" },
  { name: "whoami", description: "Show active authenticated identity and Poly Cloud API server" },
  {
    name: "registry",
    description: "Verify reachability and latency of enterprise registry mirrors",
  },
  {
    name: "doctor",
    description: "Diagnose system health, toolchains, compilers, and network connectivity",
  },
  {
    name: "docker",
    description: "Generate multi-stage production Dockerfile, compose, and devcontainer",
  },
  {
    name: "attest",
    description: "Generate, sign, or verify SLSA v1.0 in-toto supply chain attestations",
  },
  {
    name: "policy",
    description: "Evaluate corporate compliance policy (license whitelist & CVE thresholds)",
  },
  {
    name: "mcp",
    description: "Start stdio MCP server or 1-click install for Claude Desktop, Cursor, Windsurf",
  },
  {
    name: "init",
    description: "Initialize workspace or generate AI agent guidelines (.cursorrules, CLAUDE.md)",
  },
  { name: "completion", description: "Generate native shell tab auto-completion script" },
  { name: "which", description: "Show active CLI binary for an ecosystem (npm, pypi, cargo, go)" },
];

export const POLY_FLAGS = [
  "--dev",
  "-D",
  "--frozen",
  "--verify",
  "--check",
  "--fail-on",
  "--format",
  "--json",
  "--output",
  "-o",
  "--filter",
  "--url",
  "-u",
  "--token",
  "-t",
  "--workspace",
  "-w",
  "--branch",
  "-b",
  "--all",
  "--silent",
  "-s",
  "--interactive",
  "-i",
  "-h",
  "--help",
  "-v",
  "--version",
];

/**
 * Resolves dynamic completions based on workspace context (tasks, members, etc.)
 */
export function resolveDynamicCompletions(type: string, cwd: string = process.cwd()): string[] {
  switch (type.toLowerCase()) {
    case "run":
    case "tasks": {
      const tasks = new Set<string>(["build", "dev", "test", "lint"]);
      // 1. poly.toml tasks
      const config = loadWorkspaceConfig(cwd);
      if (config?.tasks) {
        for (const t of Object.keys(config.tasks)) tasks.add(t);
      }
      // 2. package.json scripts
      const pkgPath = path.join(cwd, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (pkg.scripts) {
            for (const s of Object.keys(pkg.scripts)) tasks.add(s);
          }
        } catch {
          // Ignore
        }
      }
      return Array.from(tasks);
    }

    case "filter":
    case "members": {
      const members = resolveWorkspaceMembers(cwd);
      return members.map((m) => m.relativeDir);
    }

    case "which":
    case "ecosystems":
      return ["npm", "pypi", "cargo", "go"];

    case "shells":
      return ["bash", "zsh", "fish", "powershell"];

    case "commands":
      return POLY_COMMANDS.map((c) => c.name);

    default:
      return [];
  }
}

/**
 * Generates completion script for Bash.
 */
function generateBashCompletion(): string {
  const cmdNames = POLY_COMMANDS.flatMap((c) => [c.name, ...(c.aliases || [])]).join(" ");
  const flagNames = POLY_FLAGS.join(" ");

  return `#!/usr/bin/env bash
# ⚡ Poly Bash Tab Completion
# Source this file or add to ~/.bashrc:
# eval "$(poly completion bash)"

_poly_completions() {
    local cur prev
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    local commands="${cmdNames}"
    local flags="${flagNames}"

    if [ "\$COMP_CWORD" -eq 1 ]; then
        COMPREPLY=( $(compgen -W "\$commands \$flags" -- "\$cur") )
        return 0
    fi

    case "\$prev" in
        completion)
            COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "\$cur") )
            return 0
            ;;
        which)
            COMPREPLY=( $(compgen -W "npm pypi cargo go" -- "\$cur") )
            return 0
            ;;
        run)
            local tasks
            tasks=$(poly __complete run 2>/dev/null)
            COMPREPLY=( $(compgen -W "\$tasks" -- "\$cur") )
            return 0
            ;;
        --filter)
            local members
            members=$(poly __complete filter 2>/dev/null)
            COMPREPLY=( $(compgen -W "\$members" -- "\$cur") )
            return 0
            ;;
        mcp)
            COMPREPLY=( $(compgen -W "install --config" -- "\$cur") )
            return 0
            ;;
        init)
            COMPREPLY=( $(compgen -W "--ide cursor claude all" -- "\$cur") )
            return 0
            ;;
        cache)
            COMPREPLY=( $(compgen -W "save restore clean status purge" -- "\$cur") )
            return 0
            ;;
        *)
            if [[ "\$cur" == -* ]]; then
                COMPREPLY=( $(compgen -W "\$flags" -- "\$cur") )
                return 0
            fi
            ;;
    esac
}

complete -F _poly_completions poly
`;
}

/**
 * Generates completion script for Zsh.
 */
function generateZshCompletion(): string {
  const zshEntries = POLY_COMMANDS.map(
    (c) => `        '${c.name}:${c.description.replace(/'/g, "")}'`,
  ).join("\n");

  return `#compdef poly
# ⚡ Poly Zsh Tab Completion
# Add to ~/.zshrc:
# eval "$(poly completion zsh)"

_poly() {
    local -a commands
    commands=(
${zshEntries}
    )

    _arguments -C \\
        '1: :->command' \\
        '*: :->args'

    case \$state in
        command)
            _describe 'poly command' commands
            ;;
        args)
            case \$words[2] in
                completion)
                    _values 'shell' bash zsh fish powershell
                    ;;
                which)
                    _values 'ecosystem' npm pypi cargo go
                    ;;
                run)
                    local -a tasks
                    tasks=(\${(f)"\$(poly __complete run 2>/dev/null)"})
                    _describe 'workspace tasks' tasks
                    ;;
                mcp)
                    _values 'mcp subcommand' install
                    ;;
                cache)
                    _values 'cache action' save restore clean status purge
                    ;;
            esac
            ;;
    esac
}

_poly "\$@"
`;
}

/**
 * Generates completion script for Fish.
 */
function generateFishCompletion(): string {
  const fishEntries = POLY_COMMANDS.map(
    (c) =>
      `complete -c poly -n "__fish_use_subcommand" -a ${c.name} -d '${c.description.replace(/'/g, "")}'`,
  ).join("\n");

  return `# ⚡ Poly Fish Tab Completion
# Save to ~/.config/fish/completions/poly.fish
complete -c poly -f

# Commands
${fishEntries}

# Dynamic completions
complete -c poly -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell"
complete -c poly -n "__fish_seen_subcommand_from which" -a "npm pypi cargo go"
complete -c poly -n "__fish_seen_subcommand_from mcp" -a "install"
complete -c poly -n "__fish_seen_subcommand_from cache" -a "save restore clean status purge"
complete -c poly -n "__fish_seen_subcommand_from run" -a "(poly __complete run 2>/dev/null)"
`;
}

/**
 * Generates completion script for PowerShell.
 */
function generatePowerShellCompletion(): string {
  const psEntries = POLY_COMMANDS.map(
    (c) =>
      `        [System.Management.Automation.CompletionResult]::new('${c.name}', '${c.name}', 'ParameterValue', '${c.description.replace(/'/g, "''")}')`,
  ).join(",\n");

  return `# ⚡ Poly PowerShell Tab Completion
# Add to \$PROFILE:
# poly completion powershell | Out-String | Invoke-Expression

Register-ArgumentCompleter -Native -CommandName poly -ScriptBlock {
    param(\$wordToComplete, \$commandAst, \$cursorPosition)

    \$elements = \$commandAst.CommandElements
    \$commandCount = \$elements.Count

    if (\$commandCount -le 2) {
        \$commands = @(
${psEntries}
        )
        \$commands | Where-Object { \$_.CompletionText -like "\$wordToComplete*" }
        return
    }

    \$subCommand = \$elements[1].Extent.Text.ToLower()

    switch (\$subCommand) {
        "completion" {
            @("bash", "zsh", "fish", "powershell") |
                Where-Object { \$_ -like "\$wordToComplete*" } |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new(\$_, \$_, "ParameterValue", "\$_ shell completion") }
        }
        "which" {
            @("npm", "pypi", "cargo", "go") |
                Where-Object { \$_ -like "\$wordToComplete*" } |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new(\$_, \$_, "ParameterValue", "Ecosystem package manager") }
        }
        "run" {
            \$tasks = poly __complete run 2>\$null
            \$tasks | Where-Object { \$_ -like "\$wordToComplete*" } |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new(\$_, \$_, "ParameterValue", "Task from poly.toml or package.json") }
        }
        "cache" {
            @("save", "restore", "clean", "status", "purge") |
                Where-Object { \$_ -like "\$wordToComplete*" } |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new(\$_, \$_, "ParameterValue", "Cache command") }
        }
        "mcp" {
            @("install", "--config") |
                Where-Object { \$_ -like "\$wordToComplete*" } |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new(\$_, \$_, "ParameterValue", "MCP option") }
        }
    }
}
`;
}

/**
 * Generates the full completion script for the requested shell.
 */
export function generateCompletionScript(shell: SupportedShell): string {
  switch (shell.toLowerCase() as SupportedShell) {
    case "bash":
      return generateBashCompletion();
    case "zsh":
      return generateZshCompletion();
    case "fish":
      return generateFishCompletion();
    case "powershell":
      return generatePowerShellCompletion();
    default:
      throw new Error(`Unsupported shell '${shell}'. Poly supports: bash, zsh, fish, powershell`);
  }
}
