import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface McpClientConfig {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  >;
}

export interface McpTargetInstallResult {
  client:
    | "claude_desktop"
    | "cursor_workspace"
    | "cursor_global"
    | "windsurf_workspace"
    | "windsurf_global";
  displayName: string;
  path: string;
  status: "created" | "updated" | "skipped";
  error?: string;
}

/**
 * Generates ready-to-use MCP client configuration snippet.
 */
export function generateMcpConfig(): McpClientConfig {
  return {
    mcpServers: {
      poly: {
        command: "poly",
        args: ["mcp"],
      },
    },
  };
}

/**
 * Returns platform-specific Claude Desktop config path.
 */
export function getClaudeDesktopConfigPath(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(home, "AppData", "Roaming"),
        "Claude",
        "claude_desktop_config.json",
      );
    default:
      return path.join(home, ".config", "Claude", "claude_desktop_config.json");
  }
}

/**
 * Returns Cursor global configuration path.
 */
export function getCursorGlobalConfigPath(): string {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

/**
 * Returns Windsurf global configuration path.
 */
export function getWindsurfGlobalConfigPath(): string {
  return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
}

/**
 * Safely injects the poly MCP server configuration into a target JSON file.
 * Preserves all existing MCP servers and keys.
 */
function injectPolyIntoConfigFile(
  filePath: string,
  client: McpTargetInstallResult["client"],
  displayName: string,
): McpTargetInstallResult {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let existingData: Record<string, unknown> = {};
    const exists = fs.existsSync(filePath);

    if (exists) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        existingData = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // If file is corrupt or empty, initialize clean object
        existingData = {};
      }
    }

    if (!existingData.mcpServers || typeof existingData.mcpServers !== "object") {
      existingData.mcpServers = {};
    }

    const mcpServers = existingData.mcpServers as Record<string, unknown>;
    mcpServers.poly = {
      command: "poly",
      args: ["mcp"],
    };

    fs.writeFileSync(filePath, `${JSON.stringify(existingData, null, 2)}\n`, "utf-8");

    return {
      client,
      displayName,
      path: filePath,
      status: exists ? "updated" : "created",
    };
  } catch (err) {
    return {
      client,
      displayName,
      path: filePath,
      status: "skipped",
      error: (err as Error).message,
    };
  }
}

/**
 * Automatically detects Claude Desktop, Cursor, and Windsurf and injects Poly's MCP server.
 */
export function installMcpConfig(
  workspaceDir: string = process.cwd(),
  options?: {
    customClaudePath?: string;
    customCursorPath?: string;
    customWindsurfPath?: string;
  },
): { success: boolean; targets: McpTargetInstallResult[] } {
  const cwd = path.resolve(workspaceDir);
  const results: McpTargetInstallResult[] = [];

  // 1. Claude Desktop (Global)
  const claudePath = options?.customClaudePath || getClaudeDesktopConfigPath();
  results.push(injectPolyIntoConfigFile(claudePath, "claude_desktop", "Claude Desktop"));

  // 2. Cursor (Workspace: .cursor/mcp.json)
  const cursorWsPath = path.join(cwd, ".cursor", "mcp.json");
  results.push(injectPolyIntoConfigFile(cursorWsPath, "cursor_workspace", "Cursor (Workspace)"));

  // 3. Cursor (Global: ~/.cursor/mcp.json)
  const cursorGlobalPath = options?.customCursorPath || getCursorGlobalConfigPath();
  results.push(injectPolyIntoConfigFile(cursorGlobalPath, "cursor_global", "Cursor (Global)"));

  // 4. Windsurf (Workspace: .windsurf/mcp.json)
  const windsurfWsPath = path.join(cwd, ".windsurf", "mcp.json");
  results.push(
    injectPolyIntoConfigFile(windsurfWsPath, "windsurf_workspace", "Windsurf (Workspace)"),
  );

  // 5. Windsurf (Global: ~/.codeium/windsurf/mcp_config.json)
  const windsurfGlobalPath = options?.customWindsurfPath || getWindsurfGlobalConfigPath();
  results.push(
    injectPolyIntoConfigFile(windsurfGlobalPath, "windsurf_global", "Windsurf (Global)"),
  );

  const hasSuccess = results.some((r) => r.status === "created" || r.status === "updated");
  return { success: hasSuccess, targets: results };
}

/**
 * Generates comprehensive CLAUDE.md guidelines for Anthropic Claude Code & Claude Desktop.
 */
export function generateClaudeMd(): string {
  return `# CLAUDE.md — Polyglot Repository Guidelines (poly)

This repository is managed by **Poly** (\`poly\`), the universal polyglot package manager and orchestrator for Node.js, Python, Rust, and Go.

## Critical Rules for Autonomous Coding Agents:
1. **Never guess or invoke native package managers directly**:
   - ❌ Do NOT run \`npm install\`, \`pnpm add\`, \`yarn add\`, \`pip install\`, \`uv add\`, or \`cargo add\` in subdirectories.
   - ✔ ALWAYS use \`poly add --agent\`, \`poly remove\`, and \`poly sync\`.

2. **Package Management Commands (Token-Saving & Sandboxed)**:
   - **Add Dependency**: \`poly add <ecosystem>:<package>\` (use \`--agent\` for token savings & sandboxing)
     - Node.js: \`poly add --agent npm:zod\`
     - Python: \`poly add --agent pypi:fastapi\`
     - Rust: \`poly add --agent cargo:tokio\`
     - Go: \`poly add --agent go:github.com/gin-gonic/gin\`
   - **Supply-Chain Sandboxing**: \`poly add --agent\` automatically neutralizes malicious postinstall lifecycle scripts (\`--ignore-scripts\`).
   - **Dev Dependency**: Add \`-D\` or \`--dev\` (e.g. \`poly add --agent npm:vitest -D\`)
   - **Remove Dependency**: \`poly remove <package>\`
   - **Synchronize Monorepo**: \`poly sync\` or \`poly install --agent\`

3. **Task & Test Orchestration**:
   - Run dev matrix: \`poly dev\` (parallel microservice execution with colored streaming)
   - Run tests: \`poly test\` (orchestrates unit test suites across all stack members)
   - Run tasks: \`poly run build\`, \`poly run dev\`, \`poly run <task>\`

4. **Token-Efficient Inspection (--agent / --json Mode)**:
   - When inspecting workspace state, always use structured \`--json\` flags to save ~80% context tokens:
     - \`poly detect --json\`: Inspect detected project ecosystems and manifests.
     - \`poly list --json\`: List all workspace members and direct dependencies.
     - \`poly audit --json\`: Concise OSV security vulnerability report.
     - \`poly outdated --json\`: High-speed concurrent registry outdated scan.

5. **Security & Drift Verification**:
   - Scan vulnerabilities: \`poly audit --fail-on high\`
   - Check composite lockfile drift: \`poly lock --verify\`
   - Automated CVE remediation: \`poly fix\`
`;
}

/**
 * Generates root .cursorrules for standard Cursor IDE agents.
 */
export function generateCursorRulesRoot(): string {
  return `# Universal Polyglot Package Management Rules (poly)

When working in this repository, always use \`poly\` instead of guessing subfolder package managers:

1. Package Management (Token-Saving & Sandboxed):
   - Add packages: \`poly add --agent npm:<pkg>\`, \`poly add --agent pypi:<pkg>\`, \`poly add --agent cargo:<pkg>\`, \`poly add --agent go:<pkg>\`
   - Alternatively: \`poly agent add <purl>\` (neutralizes untrusted lifecycle scripts with --ignore-scripts)
   - Dev dependencies: \`poly add --agent <pkg> -D\`
   - Remove packages: \`poly remove <pkg>\`
   - Synchronize workspace: \`poly sync\` or \`poly install --agent\`

2. Testing & Running:
   - Run dev matrix: \`poly dev\`
   - Run test suites: \`poly test\`
   - Run cross-stack tasks: \`poly run <task>\`

3. Context-Saving Inspection:
   - Inspect workspace: \`poly list --json\`
   - Detect environments: \`poly detect --json\`
   - Audit security: \`poly audit --json\`
   - Outdated packages: \`poly outdated --json\`

4. Guardrails:
   - Never run raw \`pip install\`, \`npm install\`, or \`cargo add\` directly in subdirectories.
   - Always prefer \`--agent\` or \`--json\` mode to avoid consuming excessive LLM context tokens.
`;
}

/**
 * Generates Cursor rule (.cursor/rules/poly.mdc) for AI coding assistants.
 */
export function generateCursorRule(): string {
  return `---
description: Universal Polyglot Package Management Rules (poly)
globs: ["**/package.json", "**/pyproject.toml", "**/Cargo.toml", "**/go.mod", "**/poly.toml"]
---

# Polyglot Package Management Guidelines

When adding, removing, or synchronizing dependencies across this repository, ALWAYS use the \`poly\` universal CLI orchestrator.

## Rules:
1. **Never guess or invoke native package managers directly** (\`pip\`, \`npm\`, \`cargo\`, \`yarn\`, \`pnpm\`) when adding or removing packages.
2. **Adding Dependencies**:
   - Node.js: \`poly add npm:<package>\` (e.g. \`poly add npm:zod\`)
   - Python: \`poly add pypi:<package>\` (e.g. \`poly add pypi:fastapi\`)
   - Rust: \`poly add cargo:<crate>\` (e.g. \`poly add cargo:tokio\`)
   - Go: \`poly add go:<module>\` (e.g. \`poly add go:github.com/gin-gonic/gin\`)
   - Dev Dependencies: pass \`-D\` or \`--dev\` (e.g. \`poly add npm:vitest -D\`)
3. **Removing Dependencies**:
   - \`poly remove <package>\`
4. **Synchronizing Monorepos**:
   - Run \`poly sync\` or \`poly install\` to synchronize all workspace members in parallel.
5. **Testing & Execution**:
   - Run tests: \`poly test\`
   - Run tasks: \`poly run <task>\`
6. **Token-Efficient Inspection Mode**:
   - Use \`poly list --json\` and \`poly detect --json\` for concise, structured state.
7. **Security & Compliance Auditing**:
   - Run \`poly audit\` to verify vulnerability-free dependencies.
   - Run \`poly lock --verify\` to check for supply-chain drift.
`;
}

/**
 * Writes IDE extension and agent configuration files into the project.
 */
export function setupIdeIntegration(
  workspaceDir: string,
  target: "cursor" | "claude" | "all" = "all",
): { createdFiles: string[] } {
  const createdFiles: string[] = [];
  const cwd = path.resolve(workspaceDir);

  if (target === "cursor" || target === "all") {
    // 1. .cursor/mcp.json
    const cursorDir = path.join(cwd, ".cursor");
    if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });

    const mcpJsonPath = path.join(cursorDir, "mcp.json");
    fs.writeFileSync(mcpJsonPath, `${JSON.stringify(generateMcpConfig(), null, 2)}\n`, "utf-8");
    createdFiles.push(mcpJsonPath);

    // 2. .cursor/rules/poly.mdc
    const rulesDir = path.join(cursorDir, "rules");
    if (!fs.existsSync(rulesDir)) fs.mkdirSync(rulesDir, { recursive: true });

    const rulePath = path.join(rulesDir, "poly.mdc");
    fs.writeFileSync(rulePath, generateCursorRule(), "utf-8");
    createdFiles.push(rulePath);

    // 3. .cursorrules (Root format)
    const rootCursorRulesPath = path.join(cwd, ".cursorrules");
    fs.writeFileSync(rootCursorRulesPath, generateCursorRulesRoot(), "utf-8");
    createdFiles.push(rootCursorRulesPath);
  }

  if (target === "claude" || target === "all") {
    // 4. CLAUDE.md
    const claudeMdPath = path.join(cwd, "CLAUDE.md");
    fs.writeFileSync(claudeMdPath, generateClaudeMd(), "utf-8");
    createdFiles.push(claudeMdPath);

    // 5. Claude desktop config snippet file
    const claudePath = path.join(cwd, "claude_mcp_config.json");
    fs.writeFileSync(claudePath, `${JSON.stringify(generateMcpConfig(), null, 2)}\n`, "utf-8");
    createdFiles.push(claudePath);
  }

  return { createdFiles };
}
