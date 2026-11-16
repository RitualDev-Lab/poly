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

export interface TaskDefinition {
  parallel?: string[];
  sequence?: string[];
  command?: string;
}

export interface WorkspaceConfig {
  name: string;
  version?: string;
  members: string[];
  engines?: {
    python?: string;
    node?: string;
    rust?: string;
    go?: string;
    concurrency?: number;
  };
  tasks?: Record<string, TaskDefinition | string>;
}

export interface MemberLockSnapshot {
  path: string;
  ecosystem: Ecosystem;
  manifest: string;
  manifestHash: string;
  lockfile?: string;
  lockfileHash?: string;
  directDependencies: string[];
}

export interface CompositeLockfile {
  meta: {
    schemaVersion: number;
    hashAlgorithm: string;
    generatedAt: string;
    generatedBy: string;
  };
  engines: Array<{
    name: string;
    version?: string;
    resolvedPath?: string;
  }>;
  members: MemberLockSnapshot[];
}

export interface DriftIssue {
  memberPath: string;
  file: string;
  expectedHash: string;
  actualHash: string;
  reason: string;
}

export interface DriftReport {
  isDrifted: boolean;
  issues: DriftIssue[];
}
