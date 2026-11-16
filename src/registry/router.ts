import fs from "node:fs";
import path from "node:path";
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

    // 2. Read poly.toml [registries] section
    const tomlPath = path.join(workspaceDir, "poly.toml");
    if (fs.existsSync(tomlPath)) {
      const parsed = this.parseRegistriesFromToml(fs.readFileSync(tomlPath, "utf-8"));
      if (parsed.npm && !config.npm) config.npm = parsed.npm;
      if (parsed.pypi && !config.pypi) config.pypi = parsed.pypi;
      if (parsed.cargo && !config.cargo) config.cargo = parsed.cargo;
      if (parsed.go && !config.go) config.go = parsed.go;
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

    switch (ecosystem) {
      case "npm": {
        if (registries.npm?.url) {
          env.NPM_CONFIG_REGISTRY = registries.npm.url;
          env.npm_config_registry = registries.npm.url;
        }
        if (registries.npm?.caFile) {
          env.NPM_CONFIG_CAFILE = registries.npm.caFile;
        }
        break;
      }

      case "pypi": {
        if (registries.pypi?.url) {
          env.UV_INDEX_URL = registries.pypi.url;
          env.PIP_INDEX_URL = registries.pypi.url;
        }
        if (registries.pypi?.trustedHost) {
          env.PIP_TRUSTED_HOST = registries.pypi.trustedHost;
        }
        break;
      }

      case "go": {
        if (registries.go?.url) {
          env.GOPROXY = registries.go.url;
        }
        break;
      }

      case "cargo": {
        if (registries.cargo?.url) {
          env.CARGO_REGISTRIES_CRATES_IO_INDEX = registries.cargo.url;
        }
        break;
      }
    }

    return env;
  }

  /**
   * Appends native CLI argument flags for private registry routing.
   */
  injectCliFlags(ecosystem: Ecosystem, baseArgs: string[], workspaceDir: string): string[] {
    const registries = this.loadRegistryConfig(workspaceDir);
    const args = [...baseArgs];

    switch (ecosystem) {
      case "npm": {
        if (registries.npm?.url && !args.includes("--registry")) {
          args.push("--registry", registries.npm.url);
        }
        break;
      }

      case "pypi": {
        if (registries.pypi?.url && !args.includes("--index-url")) {
          args.push("--index-url", registries.pypi.url);
        }
        break;
      }
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

      if (line === "[registries.npm]") currentEco = "npm";
      else if (line === "[registries.pypi]") currentEco = "pypi";
      else if (line === "[registries.cargo]") currentEco = "cargo";
      else if (line === "[registries.go]") currentEco = "go";
      else if (line.startsWith("[")) currentEco = undefined;

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
