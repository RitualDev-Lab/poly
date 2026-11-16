export type DiagnosticStatus = "OK" | "WARN" | "FAIL";

export type DiagnosticCategory =
  | "Toolchain"
  | "BuildEnvironment"
  | "NetworkRegistry"
  | "WorkspaceIntegrity";

export interface DiagnosticCheckItem {
  id: string;
  name: string;
  category: DiagnosticCategory;
  status: DiagnosticStatus;
  message: string;
  version?: string;
  remediation?: string;
}

export interface DoctorReport {
  overallStatus: DiagnosticStatus;
  passedCount: number;
  warnCount: number;
  failCount: number;
  checks: DiagnosticCheckItem[];
  durationMs: number;
}
