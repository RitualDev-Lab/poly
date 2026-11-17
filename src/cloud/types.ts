export interface UserCloudConfig {
  apiUrl: string;
  token: string;
  workspace: string;
  user?: {
    name?: string;
    role?: string;
  };
  updatedAt?: string;
}

export interface CloudHealthResponse {
  status: string;
  version?: string;
  storageBackend?: string;
  uptimeSeconds?: number;
  [key: string]: unknown;
}

export interface WorkspaceStats {
  workspaceSlug: string;
  totalArtifacts: number;
  totalSizeBytes: number;
  quotaBytes: number;
  quotaUsedPercent: number;
  hitRatePercent: number;
  totalHits: number;
  totalMisses: number;
  totalDurationSavedSeconds: number;
  estimatedSavingsUsd: number;
  deduplicationSavingsBytes?: number;
  deduplicationRatio?: number;
}

export interface CacheStatusReport {
  healthy: boolean;
  apiUrl: string;
  workspace: string;
  latencyMs: number;
  health?: CloudHealthResponse;
  stats?: WorkspaceStats;
  errorMessage?: string;
}

export interface CachePurgeResult {
  status: string;
  workspace: string;
  branch: string;
  deletedCount: number;
  freedBytes: number;
  deletedHashes?: string[];
}
