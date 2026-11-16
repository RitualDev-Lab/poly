import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceMembers } from "../workspace/config.js";
import { LocalDiskAdapter } from "./adapter.js";
import { computeCacheKey } from "./key.js";
import type { CacheResult, CacheStorageAdapter } from "./types.js";

export class PolyCacheManager {
  private defaultAdapter: CacheStorageAdapter;

  constructor(adapter?: CacheStorageAdapter) {
    this.defaultAdapter = adapter ?? new LocalDiskAdapter();
  }

  /**
   * Caches all active dependency artifacts across workspace members.
   */
  async save(
    workspaceDir: string,
    options?: { key?: string; adapter?: CacheStorageAdapter },
  ): Promise<CacheResult> {
    const adapter = options?.adapter ?? this.defaultAdapter;
    const key = options?.key ?? computeCacheKey(workspaceDir);
    const targetDirs = this.discoverCacheableDirectories(workspaceDir);

    return adapter.save(key, targetDirs);
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
   * Purges all cached entries.
   */
  async clean(options?: { adapter?: CacheStorageAdapter }): Promise<{
    removedKeys: number;
    freedBytes: number;
  }> {
    const adapter = options?.adapter ?? this.defaultAdapter;
    return adapter.clean();
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
