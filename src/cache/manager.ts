import fs from "node:fs";
import path from "node:path";
import { resolveCloudConfig } from "../cloud/config.js";
import { resolveWorkspaceMembers } from "../workspace/config.js";
import { LocalDiskAdapter } from "./adapter.js";
import { computeCacheKey } from "./key.js";
import { RemoteCloudAdapter } from "./remote.js";
import type { CacheResult, CacheStorageAdapter } from "./types.js";

export class PolyCacheManager {
  private defaultAdapter: CacheStorageAdapter;

  constructor(
    adapter?: CacheStorageAdapter,
    options?: { autoRemote?: boolean; customConfigPath?: string },
  ) {
    if (adapter) {
      this.defaultAdapter = adapter;
    } else if (options?.autoRemote !== false) {
      const cloudConfig = resolveCloudConfig(undefined, options?.customConfigPath);
      if (cloudConfig) {
        this.defaultAdapter = new RemoteCloudAdapter(cloudConfig);
      } else {
        this.defaultAdapter = new LocalDiskAdapter();
      }
    } else {
      this.defaultAdapter = new LocalDiskAdapter();
    }
  }

  getAdapter(): CacheStorageAdapter {
    return this.defaultAdapter;
  }

  /**
   * Caches all active dependency artifacts across workspace members.
   */
  async save(
    workspaceDir: string,
    options?: { key?: string; adapter?: CacheStorageAdapter; tag?: string },
  ): Promise<CacheResult> {
    const adapter = options?.adapter ?? this.defaultAdapter;
    const key = options?.key ?? computeCacheKey(workspaceDir);
    const targetDirs = this.discoverCacheableDirectories(workspaceDir);

    return adapter.save(key, targetDirs, { tag: options?.tag });
  }

  /**
   * Restores cached dependency artifacts into the workspace.
   */
  async restore(
    workspaceDir: string,
    options?: { key?: string; adapter?: CacheStorageAdapter },
  ): Promise<CacheResult> {
    const adapter = options?.adapter ?? this.defaultAdapter;
    const key = options?.key ?? computeCacheKey(workspaceDir);

    return adapter.restore(key, workspaceDir);
  }

  /**
   * Purges cached entries (local or remote branch).
   */
  async clean(options?: { adapter?: CacheStorageAdapter; branch?: string }): Promise<{
    removedKeys: number;
    freedBytes: number;
  }> {
    const adapter = options?.adapter ?? this.defaultAdapter;
    return adapter.clean({ branch: options?.branch });
  }

  /**
   * Discovers node_modules, .venv, and target folders across all members.
   */
  discoverCacheableDirectories(workspaceDir: string): string[] {
    const members = resolveWorkspaceMembers(workspaceDir);
    const dirs: string[] = [];

    // Check root node_modules or .venv
    for (const name of ["node_modules", ".venv", "target"]) {
      const p = path.join(workspaceDir, name);
      if (fs.existsSync(p)) dirs.push(p);
    }

    for (const m of members) {
      for (const name of ["node_modules", ".venv", "target"]) {
        const p = path.join(m.absoluteDir, name);
        if (fs.existsSync(p) && !dirs.includes(p)) {
          dirs.push(p);
        }
      }
    }

    return dirs;
  }
}
