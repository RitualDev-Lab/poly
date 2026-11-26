import fs from "node:fs";
import type { Ecosystem, EngineContext, PackageSpec } from "../types.js";
import type { BaseEngine } from "./base.js";
import { type EngineAdapter, defineDeclarativeAdapter } from "./declarative.js";
import { GoEngine } from "./go.js";
import { NodeEngine } from "./node.js";
import { PythonEngine } from "./python.js";
import { RustEngine } from "./rust.js";

/**
 * Central extensible EngineAdapter registry powering detection, PURL parsing,
 * native command dispatch, OSV compliance mapping, and private registry injection.
 */
export class EngineRegistry {
  private adapters = new Map<string, EngineAdapter>();
  private aliasIndex = new Map<string, string>();
  private purlIndex = new Map<string, string>();

  register(adapter: EngineAdapter): void {
    const key = adapter.ecosystem.toLowerCase();
    this.adapters.set(key, adapter);
    this.aliasIndex.set(key, adapter.ecosystem);
    this.purlIndex.set(key, adapter.ecosystem);

    for (const alias of adapter.aliases ?? []) {
      this.aliasIndex.set(alias.toLowerCase(), adapter.ecosystem);
    }
    for (const purlType of adapter.purlTypes ?? []) {
      this.purlIndex.set(purlType.toLowerCase(), adapter.ecosystem);
    }
  }

  unregister(ecosystem: string): boolean {
    const key = ecosystem.toLowerCase();
    const existing = this.adapters.get(key);
    if (!existing) return false;

    this.adapters.delete(key);
    this.aliasIndex.delete(key);
    this.purlIndex.delete(key);

    for (const alias of existing.aliases ?? []) {
      if (this.aliasIndex.get(alias.toLowerCase()) === existing.ecosystem) {
        this.aliasIndex.delete(alias.toLowerCase());
      }
    }
    for (const purlType of existing.purlTypes ?? []) {
      if (this.purlIndex.get(purlType.toLowerCase()) === existing.ecosystem) {
        this.purlIndex.delete(purlType.toLowerCase());
      }
    }
    return true;
  }

  resolveEcosystem(token: string): Ecosystem | undefined {
    return this.aliasIndex.get(token.trim().toLowerCase());
  }

  resolvePurlType(purlType: string): Ecosystem | undefined {
    return this.purlIndex.get(purlType.trim().toLowerCase());
  }

  getAdapter(ecosystemOrAlias: string): EngineAdapter | undefined {
    const resolved = this.resolveEcosystem(ecosystemOrAlias);
    if (!resolved) return undefined;
    return this.adapters.get(resolved.toLowerCase());
  }

  getAdapters(): EngineAdapter[] {
    return Array.from(this.adapters.values());
  }

  listEcosystems(): Ecosystem[] {
    return this.getAdapters().map((a) => a.ecosystem);
  }

  isSupported(ecosystemOrAlias: string): boolean {
    return this.getAdapter(ecosystemOrAlias) !== undefined;
  }

  createEngine(ecosystemOrAlias: string, ctx?: EngineContext): BaseEngine {
    const adapter = this.getAdapter(ecosystemOrAlias);
    if (!adapter) {
      throw new Error(
        `Unsupported ecosystem '${ecosystemOrAlias}'. Registered ecosystems: ${this.listEcosystems().join(", ")}`,
      );
    }
    return adapter.createEngine({ ...ctx, ecosystem: adapter.ecosystem });
  }

  getOsvEcosystem(ecosystem: string): string | undefined {
    return this.getAdapter(ecosystem)?.osvEcosystem;
  }

  getSbomPurlType(ecosystem: string): string {
    const adapter = this.getAdapter(ecosystem);
    return adapter?.sbomPurlType ?? adapter?.purlTypes?.[0] ?? ecosystem;
  }
}

export const engineRegistry = new EngineRegistry();

// Built-in Ecosystem Adapters (Node/npm, Deno/JSR, Python/PyPI, Conda, Rust/Cargo, Go)
const npmAdapter: EngineAdapter = {
  id: "node",
  ecosystem: "npm",
  aliases: ["node"],
  purlTypes: ["npm"],
  manifests: ["package.json"],
  lockfiles: ["pnpm-lock.yaml", "bun.lockb", "bun.lock", "yarn.lock", "package-lock.json"],
  osvEcosystem: "npm",
  sbomPurlType: "npm",
  defaultCli: "npm",
  supportedClis: ["pnpm", "bun", "yarn", "npm", "deno"],
  createEngine: (ctx) => new NodeEngine(ctx),
  resolveScriptCommand: (script) => ["npm", ["run", script]],
  injectRegistryEnv: (endpoint, env) => {
    env.NPM_CONFIG_REGISTRY = endpoint.url;
    env.npm_config_registry = endpoint.url;
    if (endpoint.caFile) env.NPM_CONFIG_CAFILE = endpoint.caFile;
  },
  injectRegistryFlags: (endpoint, args) => {
    if (!args.includes("--registry")) {
      args.push("--registry", endpoint.url);
    }
  },
  injectSandboxFlags: (_command, args) => {
    const modified = [...args];
    if (!modified.includes("--ignore-scripts")) {
      modified.push("--ignore-scripts");
    }
    return modified;
  },
  resolveEphemeralCommand: (spec, trailingArgs, commandExists) => {
    const base = spec.namespace ? `${spec.namespace}/${spec.name}` : spec.name;
    const fullPkg = spec.version ? `${base}@${spec.version}` : base;
    if (commandExists("bun")) {
      return { command: "bunx", args: [fullPkg, ...trailingArgs] };
    }
    return { command: "npx", args: ["--yes", fullPkg, ...trailingArgs] };
  },
};

const jsrAdapter: EngineAdapter = {
  id: "deno",
  ecosystem: "jsr",
  aliases: ["deno"],
  purlTypes: ["jsr"],
  manifests: ["deno.json", "deno.jsonc"],
  lockfiles: ["deno.lock"],
  osvEcosystem: "npm",
  sbomPurlType: "jsr",
  defaultCli: "deno",
  supportedClis: ["deno", "pnpm", "bun", "npm", "yarn"],
  createEngine: (ctx) => new NodeEngine({ ...ctx, ecosystem: "jsr" }),
  resolveScriptCommand: (script) => ["deno", ["task", script]],
  injectSandboxFlags: (command, args) => {
    if (command !== "deno") {
      const modified = [...args];
      if (!modified.includes("--ignore-scripts")) modified.push("--ignore-scripts");
      return modified;
    }
    return args;
  },
  resolveEphemeralCommand: (spec, trailingArgs, commandExists) => {
    const base = spec.namespace ? `${spec.namespace}/${spec.name}` : spec.name;
    const fullPkg = spec.version ? `${base}@${spec.version}` : base;
    if (commandExists("deno")) {
      return { command: "deno", args: ["run", `jsr:${fullPkg}`, ...trailingArgs] };
    }
    return { command: "npx", args: ["--yes", "jsr", "run", fullPkg, ...trailingArgs] };
  },
};

const pypiAdapter: EngineAdapter = {
  id: "python",
  ecosystem: "pypi",
  aliases: ["python", "pip", "pipenv", "uv", "poetry"],
  purlTypes: ["pypi"],
  manifests: ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"],
  lockfiles: ["uv.lock", "poetry.lock", "Pipfile.lock"],
  osvEcosystem: "PyPI",
  sbomPurlType: "pypi",
  defaultCli: "uv",
  supportedClis: ["uv", "poetry", "pipenv", "pip"],
  createEngine: (ctx) => new PythonEngine(ctx),
  resolveScriptCommand: (script) => ["python", ["-m", script]],
  injectRegistryEnv: (endpoint, env) => {
    env.UV_INDEX_URL = endpoint.url;
    env.PIP_INDEX_URL = endpoint.url;
    if (endpoint.trustedHost) env.PIP_TRUSTED_HOST = endpoint.trustedHost;
  },
  injectRegistryFlags: (endpoint, args) => {
    if (!args.includes("--index-url")) {
      args.push("--index-url", endpoint.url);
    }
  },
  injectSandboxFlags: (command, args) => {
    if (command === "pip" && !args.includes("--no-build-isolation")) {
      return [...args, "--no-build-isolation"];
    }
    return args;
  },
};

const condaAdapter: EngineAdapter = {
  id: "conda",
  ecosystem: "conda",
  aliases: ["anaconda", "mamba", "micromamba"],
  purlTypes: ["conda"],
  manifests: ["environment.yml", "environment.yaml"],
  lockfiles: ["conda-lock.yml"],
  osvEcosystem: undefined,
  sbomPurlType: "conda",
  defaultCli: "conda",
  supportedClis: ["mamba", "micromamba", "conda"],
  createEngine: (ctx) => new PythonEngine({ ...ctx, ecosystem: "conda" }),
  resolveScriptCommand: (script) => [
    "conda",
    ["run", "--no-capture-output", "python", "-m", script],
  ],
  injectRegistryEnv: (endpoint, env) => {
    env.CONDA_CHANNELS = endpoint.url;
  },
  resolveEphemeralCommand: (spec, trailingArgs, commandExists) => {
    const runner = commandExists("mamba") ? "mamba" : commandExists("conda") ? "conda" : null;
    if (!runner) return null;
    return {
      command: runner,
      args: ["run", spec.name, ...trailingArgs],
    };
  },
};

const cargoAdapter: EngineAdapter = {
  id: "rust",
  ecosystem: "cargo",
  aliases: ["rust"],
  purlTypes: ["cargo"],
  manifests: ["Cargo.toml"],
  lockfiles: ["Cargo.lock"],
  osvEcosystem: "crates.io",
  sbomPurlType: "cargo",
  defaultCli: "cargo",
  supportedClis: ["cargo"],
  createEngine: () => new RustEngine(),
  resolveScriptCommand: (script) => {
    if (script === "dev" || script === "start") return ["cargo", ["run"]];
    if (script === "test") return ["cargo", ["test"]];
    return ["cargo", [script]];
  },
  injectRegistryEnv: (endpoint, env) => {
    env.CARGO_REGISTRIES_CRATES_IO_INDEX = endpoint.url;
  },
};

const goAdapter: EngineAdapter = {
  id: "go",
  ecosystem: "go",
  aliases: ["golang"],
  purlTypes: ["golang", "go"],
  manifests: ["go.mod"],
  lockfiles: ["go.sum"],
  osvEcosystem: "Go",
  sbomPurlType: "golang",
  defaultCli: "go",
  supportedClis: ["go"],
  createEngine: () => new GoEngine(),
  resolveScriptCommand: (script) => {
    if (script === "dev" || script === "start") return ["go", ["run", "."]];
    if (script === "test") return ["go", ["test", "./..."]];
    return ["go", [script]];
  },
  injectRegistryEnv: (endpoint, env) => {
    env.GOPROXY = endpoint.url;
  },
  resolveEphemeralCommand: (spec, trailingArgs) => {
    const target = spec.version ? `${spec.name}@${spec.version}` : `${spec.name}@latest`;
    return { command: "go", args: ["run", target, ...trailingArgs] };
  },
};

engineRegistry.register(npmAdapter);
engineRegistry.register(jsrAdapter);
engineRegistry.register(pypiAdapter);
engineRegistry.register(condaAdapter);
engineRegistry.register(cargoAdapter);
engineRegistry.register(goAdapter);

/** Ensures a PackageSpec target cleanly detects its first existing manifest file in cwd if missing. */
export function resolveEcosystemLockContext(ecosystem: Ecosystem, cwd: string): EngineContext {
  const adapter = engineRegistry.getAdapter(ecosystem);
  if (!adapter) return { cwd, ecosystem };

  let manifest: string | undefined;
  let lockfile: string | undefined;

  for (const m of adapter.manifests) {
    if (!m.includes("*") && !m.includes("?") && fs.existsSync(`${cwd}/${m}`)) {
      manifest = m;
      break;
    }
  }
  for (const l of adapter.lockfiles) {
    if (fs.existsSync(`${cwd}/${l}`)) {
      lockfile = l;
      break;
    }
  }

  return { cwd, ecosystem: adapter.ecosystem, manifest, lockfile };
}

export { defineDeclarativeAdapter };
