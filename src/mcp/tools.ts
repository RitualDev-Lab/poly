import type { McpTool } from "./types.js";

export const POLY_MCP_TOOLS: McpTool[] = [
  {
    name: "poly_detect_workspace",
    description:
      "Inspect the repository workspace to discover all polyglot projects, ecosystems (npm, pypi, cargo, go), manifest files, lockfiles, and active CLI package managers.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceDir: {
          type: "string",
          description: "Optional absolute or relative path to workspace root. Defaults to CWD.",
        },
      },
    },
  },
  {
    name: "poly_resolve_package",
    description:
      "Inspect how a package name or PURL specification (e.g. 'npm:zod', 'pypi:fastapi', 'cargo:tokio', 'requests') will be resolved, which native engine is selected, and whether ambiguity exists.",
    inputSchema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description: "Package specification or shorthand PURL (e.g. 'npm:zod', 'pypi:fastapi').",
        },
        workspaceDir: {
          type: "string",
          description: "Optional workspace directory path. Defaults to CWD.",
        },
      },
      required: ["package"],
    },
  },
  {
    name: "poly_add_dependency",
    description:
      "Add a dependency across any ecosystem (Node.js, Python, Rust, Go) using the optimal native package manager without needing to know specific CLI syntax.",
    inputSchema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description: "Package name or PURL (e.g. 'npm:zod', 'pypi:fastapi', 'cargo:tokio').",
        },
        isDev: {
          type: "boolean",
          description: "Whether to install as a development dependency.",
        },
        workspaceDir: {
          type: "string",
          description: "Optional workspace directory path. Defaults to CWD.",
        },
      },
      required: ["package"],
    },
  },
  {
    name: "poly_remove_dependency",
    description:
      "Remove a dependency from the active project using the optimal native package manager.",
    inputSchema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description: "Package name to remove.",
        },
        workspaceDir: {
          type: "string",
          description: "Optional workspace directory path. Defaults to CWD.",
        },
      },
      required: ["package"],
    },
  },
  {
    name: "poly_sync_workspace",
    description:
      "Synchronize all dependencies across all polyglot workspace members with optional frozen lockfile verification.",
    inputSchema: {
      type: "object",
      properties: {
        frozen: {
          type: "boolean",
          description: "Enforce zero-drift CI mode; fails if poly.lock is out of sync.",
        },
        workspaceDir: {
          type: "string",
          description: "Optional workspace directory path. Defaults to CWD.",
        },
      },
    },
  },
  {
    name: "poly_audit_security",
    description:
      "Audit all dependencies across all ecosystems for known security vulnerabilities using the OSV database.",
    inputSchema: {
      type: "object",
      properties: {
        failOn: {
          type: "string",
          enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
          description: "Optional threshold severity level.",
        },
        workspaceDir: {
          type: "string",
          description: "Optional workspace directory path. Defaults to CWD.",
        },
      },
    },
  },
  {
    name: "poly_verify_lock",
    description:
      "Cryptographically verify composite poly.lock against disk state to ensure zero supply-chain drift.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceDir: {
          type: "string",
          description: "Optional workspace directory path. Defaults to CWD.",
        },
      },
    },
  },
];
