import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PolyCloudClient, type PolyCloudClientOptions } from "../cloud/client.js";
import { getCurrentGitBranch } from "../cloud/git.js";
import type { CacheResult, CacheStorageAdapter } from "./types.js";

interface ArchiveEntry {
  path: string;
  data: string; // base64 encoded
  mode?: number;
}

export class RemoteCloudAdapter implements CacheStorageAdapter {
  readonly backend = "remote" as const;
  private client: PolyCloudClient;

  constructor(options: PolyCloudClientOptions | PolyCloudClient) {
    if (options instanceof PolyCloudClient) {
      this.client = options;
    } else {
      this.client = new PolyCloudClient(options);
    }
  }

  getClient(): PolyCloudClient {
    return this.client;
  }

  async hasKey(key: string): Promise<boolean> {
    return this.client.hasKey(key);
  }

  async save(
    key: string,
    sourceDirectories: string[],
    options?: { tag?: string },
  ): Promise<CacheResult> {
    const start = performance.now();
    const entries: ArchiveEntry[] = [];
    let totalSizeBytes = 0;

    for (const srcDir of sourceDirectories) {
      if (!fs.existsSync(srcDir)) continue;
      const baseName = path.basename(srcDir);
      this.collectFiles(srcDir, baseName, entries);
    }

    const payloadJson = JSON.stringify(entries);
    const compressedBuffer = zlib.gzipSync(Buffer.from(payloadJson));
    totalSizeBytes = compressedBuffer.length;

    const branch = options?.tag || getCurrentGitBranch();
    const durationMs = Math.round(performance.now() - start);

    const uploaded = await this.client.upload(key, compressedBuffer, {
      tag: branch,
      durationMs,
    });

    return {
      hit: uploaded,
      key,
      durationMs: Math.round(performance.now() - start),
      sizeBytes: totalSizeBytes,
      storageBackend: "remote",
    };
  }

  async restore(key: string, targetBaseDir: string): Promise<CacheResult> {
    const start = performance.now();
    const buffer = await this.client.download(key);

    if (!buffer) {
      return {
        hit: false,
        key,
        durationMs: Math.round(performance.now() - start),
        storageBackend: "remote",
      };
    }

    try {
      const decompressed = zlib.gunzipSync(buffer);
      const entries = JSON.parse(decompressed.toString("utf8")) as ArchiveEntry[];

      for (const entry of entries) {
        const targetPath = path.join(targetBaseDir, entry.path);
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const fileBuf = Buffer.from(entry.data, "base64");
        fs.writeFileSync(targetPath, fileBuf, { mode: entry.mode });
      }

      return {
        hit: true,
        key,
        durationMs: Math.round(performance.now() - start),
        sizeBytes: buffer.length,
        storageBackend: "remote",
      };
    } catch {
      return {
        hit: false,
        key,
        durationMs: Math.round(performance.now() - start),
        storageBackend: "remote",
      };
    }
  }

  async clean(options?: { branch?: string }): Promise<{ removedKeys: number; freedBytes: number }> {
    const purgeResult = await this.client.purge(options?.branch);
    return {
      removedKeys: purgeResult?.deletedCount ?? 0,
      freedBytes: purgeResult?.freedBytes ?? 0,
    };
  }

  private collectFiles(currentDir: string, relPrefix: string, entries: ArchiveEntry[]): void {
    if (!fs.existsSync(currentDir)) return;

    try {
      const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const ent of dirEntries) {
        const fullPath = path.join(currentDir, ent.name);
        const relPath = path.join(relPrefix, ent.name);

        if (ent.isDirectory()) {
          this.collectFiles(fullPath, relPath, entries);
        } else if (ent.isFile()) {
          const stats = fs.statSync(fullPath);
          const data = fs.readFileSync(fullPath).toString("base64");
          entries.push({
            path: relPath.replace(/\\/g, "/"),
            data,
            mode: stats.mode,
          });
        }
      }
    } catch {
      // Ignore directory read locks
    }
  }
}
