import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CacheResult, CacheStorageAdapter } from "./types.js";

/**
 * High-speed local filesystem storage adapter.
 */
export class LocalDiskAdapter implements CacheStorageAdapter {
  readonly backend = "local" as const;
  private cacheRootDir: string;

  constructor(customRootDir?: string) {
    if (customRootDir) {
      this.cacheRootDir = customRootDir;
    } else {
      const home = os.homedir();
      this.cacheRootDir =
        process.platform === "win32"
          ? path.join(process.env.LOCALAPPDATA || home, "poly", "cache")
          : path.join(home, ".cache", "poly");
    }

    if (!fs.existsSync(this.cacheRootDir)) {
      fs.mkdirSync(this.cacheRootDir, { recursive: true });
    }
  }

  getRootDir(): string {
    return this.cacheRootDir;
  }

  async hasKey(key: string): Promise<boolean> {
    const keyDir = path.join(this.cacheRootDir, key);
    return fs.existsSync(keyDir);
  }

  async save(key: string, sourceDirectories: string[]): Promise<CacheResult> {
    const start = performance.now();
    const targetKeyDir = path.join(this.cacheRootDir, key);

    if (fs.existsSync(targetKeyDir)) {
      fs.rmSync(targetKeyDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetKeyDir, { recursive: true });

    let totalSizeBytes = 0;

    for (const src of sourceDirectories) {
      if (!fs.existsSync(src)) continue;
      const baseName = path.basename(src);
      const dest = path.join(targetKeyDir, baseName);

      fs.cpSync(src, dest, { recursive: true });
      totalSizeBytes += this.calculateDirSize(dest);
    }

    const durationMs = Math.round(performance.now() - start);
    return {
      hit: true,
      key,
      durationMs,
      sizeBytes: totalSizeBytes,
      storageBackend: "local",
    };
  }

  async restore(key: string, targetBaseDir: string): Promise<CacheResult> {
    const start = performance.now();
    const sourceKeyDir = path.join(this.cacheRootDir, key);

    if (!fs.existsSync(sourceKeyDir)) {
      return {
        hit: false,
        key,
        durationMs: Math.round(performance.now() - start),
        storageBackend: "local",
      };
    }

    const entries = fs.readdirSync(sourceKeyDir);
    let totalSizeBytes = 0;

    for (const entry of entries) {
      const src = path.join(sourceKeyDir, entry);
      const dest = path.join(targetBaseDir, entry);

      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }

      fs.cpSync(src, dest, { recursive: true });
      totalSizeBytes += this.calculateDirSize(dest);
    }

    const durationMs = Math.round(performance.now() - start);
    return {
      hit: true,
      key,
      durationMs,
      sizeBytes: totalSizeBytes,
      storageBackend: "local",
    };
  }

  async clean(): Promise<{ removedKeys: number; freedBytes: number }> {
    let removedKeys = 0;
    let freedBytes = 0;

    if (fs.existsSync(this.cacheRootDir)) {
      const keys = fs.readdirSync(this.cacheRootDir);
      for (const k of keys) {
        const full = path.join(this.cacheRootDir, k);
        freedBytes += this.calculateDirSize(full);
        fs.rmSync(full, { recursive: true, force: true });
        removedKeys += 1;
      }
    }

    return { removedKeys, freedBytes };
  }

  private calculateDirSize(dirPath: string): number {
    let total = 0;
    if (!fs.existsSync(dirPath)) return 0;

    try {
      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) return stats.size;

      const entries = fs.readdirSync(dirPath);
      for (const e of entries) {
        total += this.calculateDirSize(path.join(dirPath, e));
      }
    } catch {
      // Ignore permission or file lock read issues
    }
    return total;
  }
}
