import fs from "node:fs";
import path from "node:path";
import { engineRegistry } from "../engines/registry.js";
import type { Ecosystem } from "../types.js";
import type { CorporateRegistryConfig, RegistryEndpoint } from "./types.js";

export class RegistryRouter {
  /**
   * Resolves corporate registry endpoints from poly.toml or environment variables.
   */
  loadRegistryConfig(workspaceDir: string): CorporateRegistryConfig {
    const config: CorporateRegistryConfig = {};

    // 1. Environment variable overrides (e.g. CI secrets)
    if (process.env.POLY_NPM_REGISTRY && process.env.POLY_NPM_REGISTRY !== "undefined") {
      config.npm = { url: process.env.POLY_NPM_REGISTRY };
    }
    if (process.env.POLY_PYPI_REGISTRY && process.env.POLY_PYPI_REGISTRY !== "undefined") {
      config.pypi = { url: process.env.POLY_PYPI_REGISTRY };
    }
    if (process.env.POLY_CARGO_REGISTRY && process.env.POLY_CARGO_REGISTRY !== "undefined") {
      config.cargo = { url: process.env.POLY_CARGO_REGISTRY };
    }
    if (process.env.POLY_GO_PROXY && process.env.POLY_GO_PROXY !== "undefined") {
      config.go = { url: process.env.POLY_GO_PROXY };
    }
    if (process.env.POLY_CONDA_CHANNELS && process.env.POLY_CONDA_CHANNELS !== "undefined") {
      config.conda = { url: process.env.POLY_CONDA_CHANNELS };
    }

    // 2. Read poly.toml [registries.<ecosystem>] section
    const tomlPath = path.join(workspaceDir, "poly.toml");
    if (fs.existsSync(tomlPath)) {
      const parsed = this.parseRegistriesFromToml(fs.readFileSync(tomlPath, "utf-8"));
      for (const [eco, endpoint] of Object.entries(parsed)) {
        if (endpoint && !config[eco]) {
          config[eco] = endpoint;
        }
      }
    }

    return config;
  }

  /**
   * Injects native environment variables to route package downloads to private mirrors.
   */
  injectEnvironmentVariables(
    ecosystem: Ecosystem,
    workspaceDir: string,
    existingEnv: NodeJS.ProcessEnv = process.env,
  ): NodeJS.ProcessEnv {
    const registries = this.loadRegistryConfig(workspaceDir);
    const env = { ...existingEnv };
    const endpoint = registries[ecosystem];
    const adapter = engineRegistry.getAdapter(ecosystem);

    if (endpoint && adapter?.injectRegistryEnv) {
      adapter.injectRegistryEnv(endpoint, env);
    }

    return env;
  }

  /**
   * Appends native CLI argument flags for private registry routing.
   */
  injectCliFlags(ecosystem: Ecosystem, baseArgs: string[], workspaceDir: string): string[] {
    const registries = this.loadRegistryConfig(workspaceDir);
    const args = [...baseArgs];
    const endpoint = registries[ecosystem];
    const adapter = engineRegistry.getAdapter(ecosystem);

    if (endpoint && adapter?.injectRegistryFlags) {
      adapter.injectRegistryFlags(endpoint, args);
    }

    return args;
  }

  private parseRegistriesFromToml(content: string): CorporateRegistryConfig {
    const config: CorporateRegistryConfig = {};
    const lines = content.split("\n");
    let currentEco: Ecosystem | undefined;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      const regHeader = line.match(/^\[registries\.([a-z0-9_-]+)\]$/i);
      if (regHeader) {
        currentEco = engineRegistry.resolveEcosystem(regHeader[1]) ?? regHeader[1].toLowerCase();
        continue;
      }
      if (line.startsWith("[")) {
        currentEco = undefined;
      }

      if (!currentEco) continue;

      const eqIdx = line.indexOf("=");
      if (eqIdx !== -1) {
        const key = line.substring(0, eqIdx).trim();
        const val = line
          .substring(eqIdx + 1)
          .trim()
          .replace(/["']/g, "");

        if (!config[currentEco]) {
          config[currentEco] = { url: "" };
        }
        const endpoint = config[currentEco] as RegistryEndpoint;

        if (key === "url") endpoint.url = val;
        if (key === "ca_file") endpoint.caFile = val;
        if (key === "auth_token_env") endpoint.authTokenEnv = val;
        if (key === "trusted_host") endpoint.trustedHost = val;
      }
    }

    return config;
  }
}
