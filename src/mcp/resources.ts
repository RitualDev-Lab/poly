import fs from "node:fs";
import path from "node:path";
import type { McpResource, McpResourceContent } from "./types.js";

export const POLY_MCP_RESOURCES: McpResource[] = [
  {
    uri: "poly://workspace/config",
    name: "Workspace Configuration (poly.toml)",
    description: "The root configuration file describing workspace members, engines, and tasks.",
    mimeType: "text/plain",
  },
  {
    uri: "poly://workspace/lock",
    name: "Composite Lockfile (poly.lock)",
    description: "The composite cryptographic lockfile containing hashes of all manifests.",
    mimeType: "text/plain",
  },
];

export function handleResourceRead(uri: string, workspaceDir: string): McpResourceContent {
  const cwd = path.resolve(workspaceDir);

  if (uri === "poly://workspace/config") {
    const tomlPath = path.join(cwd, "poly.toml");
    if (!fs.existsSync(tomlPath)) {
      throw new Error(`Workspace configuration file 'poly.toml' not found at '${cwd}'`);
    }
    return {
      uri,
      mimeType: "text/plain",
      text: fs.readFileSync(tomlPath, "utf-8"),
    };
  }

  if (uri === "poly://workspace/lock") {
    const lockPath = path.join(cwd, "poly.lock");
    if (!fs.existsSync(lockPath)) {
      throw new Error(`Composite lockfile 'poly.lock' not found at '${cwd}'`);
    }
    return {
      uri,
      mimeType: "text/plain",
      text: fs.readFileSync(lockPath, "utf-8"),
    };
  }

  throw new Error(`Unknown resource URI: '${uri}'`);
}
