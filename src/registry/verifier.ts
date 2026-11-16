import type { Ecosystem } from "../types.js";
import { RegistryRouter } from "./router.js";
import type { RegistryHealthStatus } from "./types.js";

export class RegistryVerifier {
  private router = new RegistryRouter();

  /**
   * Tests connectivity to all configured enterprise registries.
   */
  async verifyAll(workspaceDir: string): Promise<RegistryHealthStatus[]> {
    const config = this.router.loadRegistryConfig(workspaceDir);
    const checks: Promise<RegistryHealthStatus>[] = [];

    if (config.npm?.url) checks.push(this.checkEndpoint("npm", config.npm.url));
    if (config.pypi?.url) checks.push(this.checkEndpoint("pypi", config.pypi.url));
    if (config.cargo?.url) checks.push(this.checkEndpoint("cargo", config.cargo.url));
    if (config.go?.url) checks.push(this.checkEndpoint("go", config.go.url));

    return Promise.all(checks);
  }

  private async checkEndpoint(ecosystem: Ecosystem, url: string): Promise<RegistryHealthStatus> {
    const start = performance.now();
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Math.round(performance.now() - start);
      return {
        ecosystem,
        url,
        isReachable: res.ok || res.status === 401 || res.status === 403, // 401/403 means reachable behind auth
        latencyMs,
        httpStatus: res.status,
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      return {
        ecosystem,
        url,
        isReachable: false,
        latencyMs,
        error: (err as Error).message,
      };
    }
  }
}
