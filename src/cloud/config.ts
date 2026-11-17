import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserCloudConfig } from "./types.js";

export function getUserConfigDir(): string {
  return path.join(os.homedir(), ".poly");
}

export function getUserConfigPath(): string {
  return path.join(getUserConfigDir(), "config.json");
}

/**
 * Loads stored user credentials from ~/.poly/config.json.
 */
export function loadUserConfig(customPath?: string): UserCloudConfig | null {
  const filePath = customPath || getUserConfigPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.apiUrl && parsed.token) {
      return {
        apiUrl: String(parsed.apiUrl).replace(/\/+$/, ""),
        token: String(parsed.token),
        workspace: parsed.workspace ? String(parsed.workspace) : "default",
        user: parsed.user,
        updatedAt: parsed.updatedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Stores credentials securely in ~/.poly/config.json (0o600 on POSIX).
 */
export function saveUserConfig(config: UserCloudConfig, customPath?: string): void {
  const filePath = customPath || getUserConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const payload: UserCloudConfig = {
    apiUrl: config.apiUrl.replace(/\/+$/, ""),
    token: config.token.trim(),
    workspace: (config.workspace || "default").trim(),
    user: config.user,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
    mode: 0o600,
  });
}

/**
 * Deletes ~/.poly/config.json.
 */
export function deleteUserConfig(customPath?: string): boolean {
  const filePath = customPath || getUserConfigPath();
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Resolves cloud configuration following precedence:
 * 1. Explicit CLI options (--url, --token, --workspace)
 * 2. Environment variables (POLY_CACHE_URL, POLY_CACHE_TOKEN, POLY_CACHE_WORKSPACE)
 * 3. ~/.poly/config.json
 */
export function resolveCloudConfig(
  options?: { apiUrl?: string; token?: string; workspace?: string },
  customPath?: string,
): UserCloudConfig | null {
  const fileConfig = loadUserConfig(customPath);

  const envUrl = process.env.POLY_CACHE_URL || process.env.POLY_CLOUD_URL;
  const envToken = process.env.POLY_CACHE_TOKEN || process.env.POLY_TOKEN;
  const envWorkspace =
    process.env.POLY_CACHE_WORKSPACE || process.env.POLY_WORKSPACE || process.env.POLY_TEAM;

  const apiUrl = options?.apiUrl || envUrl || fileConfig?.apiUrl;
  const token = options?.token || envToken || fileConfig?.token;
  const workspace = options?.workspace || envWorkspace || fileConfig?.workspace || "default";

  if (!apiUrl || !token) {
    return null;
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    token: token.trim(),
    workspace: workspace.trim(),
    user: fileConfig?.user,
    updatedAt: fileConfig?.updatedAt,
  };
}
