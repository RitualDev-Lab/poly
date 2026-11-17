import type {
  CachePurgeResult,
  CacheStatusReport,
  CloudHealthResponse,
  WorkspaceStats,
} from "./types.js";

export interface PolyCloudClientOptions {
  apiUrl: string;
  token: string;
  workspace?: string;
  timeoutMs?: number;
}

export class PolyCloudClient {
  readonly apiUrl: string;
  readonly token: string;
  readonly workspace: string;
  readonly timeoutMs: number;

  constructor(options: PolyCloudClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.token = options.token.trim();
    this.workspace = (options.workspace || "default").trim();
    this.timeoutMs = options.timeoutMs || 15000;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "x-poly-team": this.workspace,
    };
  }

  private getUrl(urlPath: string): string {
    const sep = urlPath.includes("?") ? "&" : "?";
    return `${this.apiUrl}${urlPath}${sep}team=${encodeURIComponent(this.workspace)}`;
  }

  /**
   * Health probe and cluster latency measurement.
   */
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; data?: CloudHealthResponse }> {
    const start = performance.now();
    try {
      const res = await fetch(`${this.apiUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        return { ok: false, latencyMs };
      }
      const data = (await res.json()) as CloudHealthResponse;
      return { ok: true, latencyMs, data };
    } catch {
      return { ok: false, latencyMs: Math.round(performance.now() - start) };
    }
  }

  /**
   * Verifies authentication credentials and workspace accessibility.
   */
  async verifyAuth(): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
    stats?: WorkspaceStats;
  }> {
    try {
      const res = await fetch(
        this.getUrl(`/api/v1/workspaces/${encodeURIComponent(this.workspace)}/stats`),
        {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (res.status === 401) {
        return { ok: false, status: 401, error: "Invalid or expired API token" };
      }
      if (res.status === 403) {
        return { ok: false, status: 403, error: "Token lacks required permissions for workspace" };
      }
      if (res.status === 404) {
        return {
          ok: false,
          status: 404,
          error: `Workspace '${this.workspace}' not found on server`,
        };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, error: `Server returned HTTP ${res.status}` };
      }
      const body = (await res.json()) as { stats?: WorkspaceStats };
      return { ok: true, status: 200, stats: body.stats };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Fetches ROI and cache hit statistics for the active workspace.
   */
  async getWorkspaceStats(): Promise<WorkspaceStats | null> {
    const auth = await this.verifyAuth();
    return auth.ok && auth.stats ? auth.stats : null;
  }

  /**
   * Composite status report: probes cluster latency and fetches workspace metrics.
   */
  async getStatus(): Promise<CacheStatusReport> {
    const health = await this.healthCheck();
    if (!health.ok) {
      return {
        healthy: false,
        apiUrl: this.apiUrl,
        workspace: this.workspace,
        latencyMs: health.latencyMs,
        errorMessage: `Failed to connect to Poly Cloud API at ${this.apiUrl}`,
      };
    }

    const authCheck = await this.verifyAuth();
    if (!authCheck.ok) {
      return {
        healthy: false,
        apiUrl: this.apiUrl,
        workspace: this.workspace,
        latencyMs: health.latencyMs,
        health: health.data,
        errorMessage: authCheck.error || "Authentication failed",
      };
    }

    return {
      healthy: true,
      apiUrl: this.apiUrl,
      workspace: this.workspace,
      latencyMs: health.latencyMs,
      health: health.data,
      stats: authCheck.stats,
    };
  }

  /**
   * Invalidate remote cache artifacts for a specific branch or the entire workspace.
   */
  async purge(branch?: string): Promise<CachePurgeResult | null> {
    try {
      const bodyPayload = branch && branch !== "all" ? { branch } : {};
      const res = await fetch(
        this.getUrl(`/api/v1/workspaces/${encodeURIComponent(this.workspace)}/purge`),
        {
          method: "POST",
          headers: {
            ...this.getHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );

      if (!res.ok) return null;
      return (await res.json()) as CachePurgeResult;
    } catch {
      return null;
    }
  }

  /**
   * Probes whether an artifact key exists in the remote cache.
   */
  async hasKey(hash: string): Promise<boolean> {
    try {
      const res = await fetch(this.getUrl(`/v8/artifacts/${encodeURIComponent(hash)}`), {
        method: "HEAD",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Streams and downloads a cached binary artifact.
   */
  async download(hash: string): Promise<Buffer | null> {
    try {
      const res = await fetch(this.getUrl(`/v8/artifacts/${encodeURIComponent(hash)}`), {
        method: "GET",
        headers: this.getHeaders(),
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status !== 200) return null;
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch {
      return null;
    }
  }

  /**
   * Uploads an artifact binary payload to the remote cache.
   */
  async upload(
    hash: string,
    data: Buffer,
    options?: { tag?: string; durationMs?: number },
  ): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        ...this.getHeaders(),
        "Content-Type": "application/octet-stream",
        "Content-Length": data.length.toString(),
      };
      if (options?.tag) headers["x-artifact-tag"] = options.tag;
      if (options?.durationMs !== undefined) {
        headers["x-artifact-duration"] = options.durationMs.toString();
      }

      const res = await fetch(this.getUrl(`/v8/artifacts/${encodeURIComponent(hash)}`), {
        method: "PUT",
        headers,
        body: data,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Invalidates a single artifact by hash.
   */
  async delete(hash: string): Promise<boolean> {
    try {
      const res = await fetch(this.getUrl(`/v8/artifacts/${encodeURIComponent(hash)}`), {
        method: "DELETE",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
