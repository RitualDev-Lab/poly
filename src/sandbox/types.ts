export type SandboxMode = "strict" | "neutralize" | "warn" | "off";

export type LifecycleHook =
  | "preinstall"
  | "install"
  | "postinstall"
  | "prepublish"
  | "prepublishOnly";

export interface DetectedScript {
  hook: LifecycleHook;
  command: string;
  risk: "low" | "medium" | "critical";
  reasons: string[];
}

export interface SandboxScanResult {
  safe: boolean;
  package: string;
  scripts: DetectedScript[];
  blocked: boolean;
  neutralized: boolean;
  details?: string;
  remediation?: string;
}

export interface SandboxPolicy {
  mode: SandboxMode;
  allowScripts?: string[];
  blockNetworkInScripts?: boolean;
}

export interface AgentExecutionResponse<T = unknown> {
  ok: boolean;
  action: string;
  package?: string;
  ecosystem?: string;
  duration_ms?: number;
  sandboxed?: boolean;
  lockfile_synced?: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    remediation?: string;
  };
}
