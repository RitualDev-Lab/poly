/**
 * Poly Core Types
 * Universal Package & Dependency Orchestration Specification
 */

export type BuiltinEcosystem =
  | "npm"
  | "jsr"
  | "pypi"
  | "conda"
  | "cargo"
  | "go"
  | "nuget"
  | "composer"
  | "gem"
  | "pub";
export type Ecosystem = BuiltinEcosystem | (string & {});

export interface EngineContext {
  cwd?: string;
  manifest?: string;
  lockfile?: string;
  ecosystem?: Ecosystem;
  preferredCli?: string;
}

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

export interface SecurityConfig {
  quarantineHours?: number;
  quarantineAction?: "rollback" | "block";
  licenses?: {
    policy?: "allowlist" | "denylist";
    allowed?: string[];
    denied?: string[];
    onViolation?: "block" | "warn";
  };
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
    deno?: string;
    conda?: string;
    concurrency?: number;
    [key: string]: string | number | undefined;
  };
  tasks?: Record<string, TaskDefinition | string>;
  scripts?: Record<string, TaskDefinition | string>;
  security?: SecurityConfig;
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
