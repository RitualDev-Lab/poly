import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Computes a deterministic cross-platform cache key based on poly.lock and system architecture.
 */
export function computeCacheKey(workspaceDir: string, prefix = "poly-cache-v1"): string {
  const os = process.platform;
  const arch = process.arch;

  const polyLockPath = path.join(workspaceDir, "poly.lock");
  let lockHash = "initial";

  if (fs.existsSync(polyLockPath)) {
    const content = fs.readFileSync(polyLockPath, "utf-8");
    lockHash = crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);
  }

  return `${prefix}-${os}-${arch}-${lockHash}`;
}
