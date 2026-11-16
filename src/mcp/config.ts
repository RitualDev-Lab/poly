import fs from "node:fs";
import path from "node:path";

export interface McpClientConfig {
  mcpServers: {
    poly: {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
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
5. **Security & Compliance Auditing**:
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
    fs.writeFileSync(mcpJsonPath, JSON.stringify(generateMcpConfig(), null, 2), "utf-8");
    createdFiles.push(mcpJsonPath);

    // 2. .cursor/rules/poly.mdc
    const rulesDir = path.join(cursorDir, "rules");
    if (!fs.existsSync(rulesDir)) fs.mkdirSync(rulesDir, { recursive: true });

    const rulePath = path.join(rulesDir, "poly.mdc");
    fs.writeFileSync(rulePath, generateCursorRule(), "utf-8");
    createdFiles.push(rulePath);
  }

  if (target === "claude" || target === "all") {
    // Claude desktop config snippet file
    const claudePath = path.join(cwd, "claude_mcp_config.json");
    fs.writeFileSync(claudePath, JSON.stringify(generateMcpConfig(), null, 2), "utf-8");
    createdFiles.push(claudePath);
  }

  return { createdFiles };
}
