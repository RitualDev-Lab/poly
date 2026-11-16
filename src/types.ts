/**
 * Poly Core Types
 * Universal Package & Dependency Orchestration Specification
 */

export type Ecosystem = "npm" | "pypi" | "cargo" | "go";

export interface PackageSpec {
  raw: string;
  ecosystem?: Ecosystem;
  namespace?: string;
  name: string;
  version?: string;
  features?: string[];
  isDev?: boolean;
}

export interface ManifestContext {
  directory: string;
  ecosystem: Ecosystem;
  manifestFile: string;
  lockfile?: string;
  distance: number;
}

export interface ExecutionResult {
  engine: string;
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface EngineDiscovery {
  name: string;
  path: string;
  version?: string;
  isAvailable: boolean;
}
