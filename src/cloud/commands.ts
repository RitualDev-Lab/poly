import os from "node:os";
import readline from "node:readline/promises";
import { PolyCacheManager } from "../cache/index.js";
import { logError, logHeader, logSuccess } from "../ui/reporter.js";
import { PolyCloudClient } from "./client.js";
import {
  deleteUserConfig,
  getUserConfigPath,
  resolveCloudConfig,
  saveUserConfig,
} from "./config.js";
import { getCurrentGitBranch } from "./git.js";
import type { CacheStatusReport, UserCloudConfig } from "./types.js";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m ${s}s`;
}

export function renderProgressBar(percent: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

/**
 * Handles 'poly login': interactive or flag-based authentication against poly-cloud-api.
 */
export async function handleLogin(options: {
  url?: string;
  token?: string;
  workspace?: string;
  customConfigPath?: string;
  interactive?: boolean;
}): Promise<boolean> {
  let apiUrl = options.url?.trim();
  let token = options.token?.trim();
  let workspace = options.workspace?.trim();

  // If missing and interactive terminal available
  if ((!apiUrl || !token) && (options.interactive ?? process.stdin.isTTY)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!apiUrl) {
        const answer = await rl.question("Enter Poly Cloud API URL [http://localhost:8080]: ");
        apiUrl = answer.trim() || "http://localhost:8080";
      }
      if (!token) {
        token = (await rl.question("Enter Poly API Token (poly_tok_...): ")).trim();
      }
      if (!workspace) {
        const answer = await rl.question("Enter Workspace Slug [default]: ");
        workspace = answer.trim() || "default";
      }
    } finally {
      rl.close();
    }
  }

  apiUrl = apiUrl || "http://localhost:8080";
  workspace = workspace || "default";

  if (!token) {
    logError("Missing required API token. Pass '--token <token>' or set POLY_CACHE_TOKEN.");
    return false;
  }

  logHeader("Connecting to Poly Cloud API...");
  const client = new PolyCloudClient({ apiUrl, token, workspace });
  const status = await client.getStatus();

  if (!status.healthy) {
    logError(status.errorMessage || `Failed to authenticate against Poly Cloud API at ${apiUrl}`);
    return false;
  }

  saveUserConfig(
    {
      apiUrl,
      token,
      workspace,
      user: {
        role: "verified",
        name: os.userInfo().username,
      },
    },
    options.customConfigPath,
  );

  const configPath = options.customConfigPath || getUserConfigPath();
  const latency = `${status.latencyMs}ms`;

  console.log(
    "\n\x1b[32m✔\x1b[0m \x1b[1mSuccessfully authenticated against Poly Cloud API!\x1b[0m\n",
  );
  console.log("╭────────────────────────────────────────────────────────────╮");
  console.log("│  ⚡ Poly Cloud API — Authentication Verified                │");
  console.log("├────────────────────────────────────────────────────────────┤");
  console.log(`│  Server:     ${apiUrl.padEnd(46)}│`);
  console.log(`│  Workspace:  ${workspace.padEnd(46)}│`);
  console.log(`│  Token:      ${(`${token.slice(0, 15)}...`).padEnd(46)}│`);
  console.log(`│  Cluster:    ${(`Healthy (${latency} latency)`).padEnd(46)}│`);
  console.log(`│  Config:     ${configPath.padEnd(46)}│`);
  console.log("╰────────────────────────────────────────────────────────────╯\n");

  return true;
}

/**
 * Handles 'poly logout': clears stored ~/.poly/config.json credentials.
 */
export function handleLogout(options?: { customConfigPath?: string }): boolean {
  const deleted = deleteUserConfig(options?.customConfigPath);
  if (deleted) {
    logSuccess("Logged out from Poly Cloud API. Stored credentials removed.");
    return true;
  }
  console.log("No active credentials stored in ~/.poly/config.json.");
  return false;
}

/**
 * Handles 'poly whoami': displays the currently active authenticated session.
 */
export function handleWhoami(options?: {
  customConfigPath?: string;
  json?: boolean;
}): UserCloudConfig | null {
  const config = resolveCloudConfig(undefined, options?.customConfigPath);
  if (!config) {
    if (options?.json) {
      console.log(JSON.stringify({ authenticated: false }, null, 2));
    } else {
      console.log("Not logged in to Poly Cloud API. Run 'poly login' to authenticate.");
    }
    return null;
  }

  if (options?.json) {
    console.log(
      JSON.stringify(
        {
          authenticated: true,
          apiUrl: config.apiUrl,
          workspace: config.workspace,
          tokenPrefix: config.token.slice(0, 12),
          configPath: options?.customConfigPath || getUserConfigPath(),
        },
        null,
        2,
      ),
    );
  } else {
    console.log("\x1b[1m\x1b[36m⚡ [poly]\x1b[0m \x1b[1mActive Authenticated Session\x1b[0m");
    console.log(`Server:     ${config.apiUrl}`);
    console.log(`Workspace:  ${config.workspace}`);
    console.log(`Token:      ${config.token.slice(0, 12)}...`);
    console.log(`Config:     ${options?.customConfigPath || getUserConfigPath()}`);
  }

  return config;
}

/**
 * Handles 'poly cache status': probes cluster latency and prints live ROI metrics.
 */
export async function handleCacheStatus(options?: {
  url?: string;
  token?: string;
  workspace?: string;
  customConfigPath?: string;
  json?: boolean;
}): Promise<CacheStatusReport | null> {
  const config = resolveCloudConfig(
    { apiUrl: options?.url, token: options?.token, workspace: options?.workspace },
    options?.customConfigPath,
  );

  if (!config) {
    logError(
      "Poly Cloud API is not configured. Run 'poly login' or set POLY_CACHE_URL & POLY_CACHE_TOKEN.",
    );
    return null;
  }

  const client = new PolyCloudClient({
    apiUrl: config.apiUrl,
    token: config.token,
    workspace: config.workspace,
  });

  const status = await client.getStatus();

  if (options?.json) {
    console.log(JSON.stringify(status, null, 2));
    return status;
  }

  if (!status.healthy) {
    logError(status.errorMessage || `Failed to connect to Poly Cloud API at ${config.apiUrl}`);
    return status;
  }

  const stats = status.stats;
  const hitRate = stats ? stats.hitRatePercent : 0;
  const bar = renderProgressBar(hitRate, 16);
  const hits = stats ? stats.totalHits.toLocaleString() : "0";
  const misses = stats ? stats.totalMisses.toLocaleString() : "0";
  const timeSaved = stats ? formatDuration(stats.totalDurationSavedSeconds) : "0s";
  const costSaved = stats ? `$${stats.estimatedSavingsUsd.toFixed(2)} USD` : "$0.00 USD";
  const artifactsCount = stats ? stats.totalArtifacts : 0;
  const totalSize = stats ? formatBytes(stats.totalSizeBytes) : "0 B";
  const quota = stats ? formatBytes(stats.quotaBytes) : "0 B";
  const quotaUsedPct = stats ? `${stats.quotaUsedPercent}%` : "0%";
  const dedupRatio = stats?.deduplicationRatio ? `${stats.deduplicationRatio}x` : "1.00x";
  const dedupSaved = stats?.deduplicationSavingsBytes
    ? formatBytes(stats.deduplicationSavingsBytes)
    : "0 B";
  const backend = status.health?.storageBackend || "remote";

  console.log("\n\x1b[1m\x1b[36m⚡ [poly]\x1b[0m \x1b[1mRemote Cache Cluster Status\x1b[0m");
  console.log("─────────────────────────────────────────────────────────────");
  console.log(
    `  \x1b[1mCluster:\x1b[0m     \x1b[32m● Healthy\x1b[0m (${status.latencyMs}ms latency)`,
  );
  console.log(`  \x1b[1mServer:\x1b[0m      ${config.apiUrl}`);
  console.log(`  \x1b[1mWorkspace:\x1b[0m   ${config.workspace}`);
  console.log("");
  console.log("  \x1b[1m📈 Performance & ROI Metrics:\x1b[0m");
  console.log(`  Hit Rate:    ${bar} \x1b[1m${hitRate}%\x1b[0m (${hits} hits / ${misses} misses)`);
  console.log(`  Time Saved:  \x1b[32m${timeSaved}\x1b[0m of CI compute saved`);
  console.log(`  ROI Savings: \x1b[32m${costSaved}\x1b[0m estimated developer savings`);
  console.log("");
  console.log("  \x1b[1m💾 Storage & Deduplication:\x1b[0m");
  console.log(
    `  Artifacts:   ${artifactsCount} cached (${totalSize} / ${quota} quota, ${quotaUsedPct} used)`,
  );
  console.log(
    `  Dedup Ratio: \x1b[36m${dedupRatio}\x1b[0m (${dedupSaved} deduplicated across branches)`,
  );
  console.log(`  Backend:     ${backend}`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return status;
}

/**
 * Handles 'poly cache purge': invalidates remote cache for current monorepo branch.
 */
export async function handleCachePurge(options?: {
  branch?: string;
  all?: boolean;
  url?: string;
  token?: string;
  workspace?: string;
  customConfigPath?: string;
  cwd?: string;
}): Promise<boolean> {
  const cwd = options?.cwd || process.cwd();
  const targetBranch = options?.all ? "all" : options?.branch || getCurrentGitBranch(cwd);

  const config = resolveCloudConfig(
    { apiUrl: options?.url, token: options?.token, workspace: options?.workspace },
    options?.customConfigPath,
  );

  if (config) {
    logHeader(`Purging remote cache for branch '${targetBranch}'...`);
    const client = new PolyCloudClient({
      apiUrl: config.apiUrl,
      token: config.token,
      workspace: config.workspace,
    });

    const res = await client.purge(targetBranch);
    if (res) {
      logSuccess(
        `Purged remote cache for branch '${res.branch}' (${res.deletedCount} artifacts, ${formatBytes(res.freedBytes)} freed)`,
      );
    } else {
      logError(`Failed to purge remote cache for branch '${targetBranch}'`);
    }
  }

  // Also clean local cache
  const cacheManager = new PolyCacheManager();
  const localRes = await cacheManager.clean({ branch: targetBranch });
  if (localRes.removedKeys > 0) {
    logSuccess(
      `Purged local cache entries (${localRes.removedKeys} keys, ${formatBytes(localRes.freedBytes)} freed)`,
    );
  }

  if (!config && localRes.removedKeys === 0) {
    console.log(`Local cache was already clean for branch '${targetBranch}'.`);
  }

  return true;
}
