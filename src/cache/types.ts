export interface CacheKeyConfig {
  workspaceDir: string;
  os: string;
  arch: string;
  lockfileHash: string;
  prefix?: string;
}

export interface CacheEntryMeta {
  key: string;
  createdAt: string;
  compressedSizeBytes: number;
  uncompressedSizeBytes: number;
  directories: string[];
}

export interface CacheResult {
  hit: boolean;
  key: string;
  durationMs: number;
  sizeBytes?: number;
  storageBackend: "local" | "s3" | "r2";
}

export interface CacheStorageAdapter {
  readonly backend: "local" | "s3" | "r2";
  hasKey(key: string): Promise<boolean>;
  save(key: string, sourceDirectories: string[]): Promise<CacheResult>;
  restore(key: string, targetBaseDir: string): Promise<CacheResult>;
  clean(): Promise<{ removedKeys: number; freedBytes: number }>;
}
