import type { EngineAdapter } from "./declarative.js";
import { GoEngine } from "./go.js";
import { NodeEngine } from "./node.js";
import { PythonEngine } from "./python.js";
import { RustEngine } from "./rust.js";

export const npmAdapter: EngineAdapter = {
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

export const jsrAdapter: EngineAdapter = {
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

export const pypiAdapter: EngineAdapter = {
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

export const condaAdapter: EngineAdapter = {
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

export const cargoAdapter: EngineAdapter = {
  id: "rust",
  ecosystem: "cargo",
  aliases: ["rust"],
  purlTypes: ["cargo"],
  manifests: ["Cargo.toml"],
  lockfiles: ["Cargo.lock"],
  osvEcosystem: "crates.io",
  sbomPurlType: "cargo",
  defaultCli: "rust",
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

export const goAdapter: EngineAdapter = {
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

export const CORE_ADAPTERS: readonly EngineAdapter[] = [
  npmAdapter,
  jsrAdapter,
  pypiAdapter,
  condaAdapter,
  cargoAdapter,
  goAdapter,
];
