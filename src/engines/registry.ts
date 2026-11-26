import fs from "node:fs";
import path from "node:path";
import type { Ecosystem, EngineContext } from "../types.js";
import type { BaseEngine } from "./base.js";
import type { EngineAdapter } from "./declarative.js";

export type EngineGroupLoader = () => Promise<EngineAdapter[]>;

/**
 * Lightweight descriptor registered at startup without loading heavy engine or mutator modules.
 */
function createDescriptorStub(
  meta: Omit<EngineAdapter, "createEngine">,
  groupKey: string,
  loader: EngineGroupLoader,
  registry: EngineRegistry,
): EngineAdapter {
  return {
    ...meta,
    createEngine: () => {
      throw new Error(
        `Adapter '${meta.ecosystem}' is lazy-loaded (${groupKey}). Call 'await engineRegistry.ensureLoaded("${meta.ecosystem}")' first or import via 'engines/index.js'.`,
      );
    },
    __lazyGroup: groupKey,
    __loader: loader,
    __registry: registry,
  } as EngineAdapter & {
    __lazyGroup?: string;
    __loader?: EngineGroupLoader;
    __registry?: EngineRegistry;
  };
}

interface LazyEntry {
  groupKey: string;
  loader: EngineGroupLoader;
}

/**
 * Central extensible EngineAdapter registry powering detection, PURL parsing,
 * native command dispatch, OSV compliance mapping, private registry injection,
 * and on-demand lazy loading of ecosystem engines.
 */
export class EngineRegistry {
  private adapters = new Map<string, EngineAdapter>();
  private aliasIndex = new Map<string, string>();
  private purlIndex = new Map<string, string>();
  private lazyLoaders = new Map<string, LazyEntry>();
  private loadedAdapters = new Set<string>();
  private loadedGroups = new Map<string, Promise<EngineAdapter[]>>();

  /**
   * Registers an eager or fully hydrated EngineAdapter and marks it loaded.
   */
  register(adapter: EngineAdapter): void {
    const key = adapter.ecosystem.toLowerCase();
    this.adapters.set(key, adapter);
    this.loadedAdapters.add(key);
    this.lazyLoaders.delete(key);
    this.indexMetadata(adapter);
  }

  /**
   * Registers a lightweight adapter descriptor with an async module loader.
   * Only metadata (manifests, lockfiles, aliases, OSV/SBOM mappings) is held at startup;
   * actual engine/mutator code is dynamically imported when first activated.
   */
  registerLazy(
    meta: Omit<EngineAdapter, "createEngine">,
    groupKey: string,
    loader: EngineGroupLoader,
  ): void {
    const key = meta.ecosystem.toLowerCase();
    if (this.loadedAdapters.has(key)) return;

    const stub = createDescriptorStub(meta, groupKey, loader, this);
    this.adapters.set(key, stub);
    this.lazyLoaders.set(key, { groupKey, loader });
    this.indexMetadata(stub);
  }

  private indexMetadata(adapter: EngineAdapter): void {
    const key = adapter.ecosystem.toLowerCase();
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
    this.loadedAdapters.delete(key);
    this.lazyLoaders.delete(key);
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

  isAdapterLoaded(ecosystemOrAlias: string): boolean {
    const resolved = this.resolveEcosystem(ecosystemOrAlias);
    return resolved ? this.loadedAdapters.has(resolved.toLowerCase()) : false;
  }

  getLoadedEcosystems(): Ecosystem[] {
    return Array.from(this.loadedAdapters);
  }

  /**
   * Lazily imports and registers the implementation module for a single ecosystem on demand.
   */
  async ensureLoaded(ecosystemOrAlias: string): Promise<EngineAdapter> {
    const resolved = this.resolveEcosystem(ecosystemOrAlias);
    if (!resolved) {
      throw new Error(
        `Unsupported ecosystem '${ecosystemOrAlias}'. Registered ecosystems: ${this.listEcosystems().join(", ")}`,
      );
    }

    const key = resolved.toLowerCase();
    const lazy = this.lazyLoaders.get(key);
    if (lazy) {
      let groupPromise = this.loadedGroups.get(lazy.groupKey);
      if (!groupPromise) {
        groupPromise = lazy.loader();
        this.loadedGroups.set(lazy.groupKey, groupPromise);
      }
      const loaded = await groupPromise;
      for (const adapter of loaded) {
        this.register(adapter);
      }
    }

    const active = this.adapters.get(key);
    if (!active) {
      throw new Error(`Failed to activate engine adapter for '${ecosystemOrAlias}'.`);
    }
    return active;
  }

  /**
   * Preloads ONLY the adapters corresponding to manifests actually present in `dir` (and parent git root).
   */
  async loadForDirectory(dir: string): Promise<Ecosystem[]> {
    const activated: Ecosystem[] = [];
    const targetDir = path.resolve(dir);

    for (const adapter of this.getAdapters()) {
      let found = false;
      for (const pattern of adapter.manifests) {
        if (!pattern.includes("*") && !pattern.includes("?")) {
          if (fs.existsSync(path.join(targetDir, pattern))) {
            found = true;
            break;
          }
        } else {
          try {
            const entries = fs.readdirSync(targetDir);
            const escaped = pattern
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".");
            if (entries.some((e) => new RegExp(`^${escaped}$`, "i").test(e))) {
              found = true;
              break;
            }
          } catch {
            // ignore unreadable dir
          }
        }
      }
      if (found) {
        await this.ensureLoaded(adapter.ecosystem);
        activated.push(adapter.ecosystem);
      }
    }

    return activated;
  }

  createEngine(ecosystemOrAlias: string, ctx?: EngineContext): BaseEngine {
    const adapter = this.getAdapter(ecosystemOrAlias);
    if (!adapter) {
      throw new Error(
        `Unsupported ecosystem '${ecosystemOrAlias}'. Registered ecosystems: ${this.listEcosystems().join(", ")}`,
      );
    }
    this.loadedAdapters.add(adapter.ecosystem.toLowerCase());
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

const loadCoreGroup: EngineGroupLoader = async () =>
  Array.from((await import("./core.js")).CORE_ADAPTERS);

const loadBackendMobileGroup: EngineGroupLoader = async () =>
  Array.from((await import("./backend-mobile.js")).BACKEND_MOBILE_ADAPTERS);

const loadCppJuliaGroup: EngineGroupLoader = async () =>
  Array.from((await import("./cpp-julia.js")).CPP_JULIA_ADAPTERS);

const loadTier2ManifestGroup: EngineGroupLoader = async () =>
  Array.from((await import("./tier2-manifest.js")).TIER2_MANIFEST_ADAPTERS);

const loadLongtailGroup: EngineGroupLoader = async () =>
  Array.from((await import("./longtail.js")).LONGTAIL_ADAPTERS);

// Lightweight descriptors registered immediately (0 heavy module imports at CLI startup)
const LAZY_DESCRIPTORS: Array<{
  meta: Omit<EngineAdapter, "createEngine">;
  groupKey: string;
  loader: EngineGroupLoader;
}> = [
  // Core (Group: core)
  {
    groupKey: "core",
    loader: loadCoreGroup,
    meta: {
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
      resolveScriptCommand: (script) => ["npm", ["run", script]],
      injectRegistryEnv: (e, env) => {
        env.NPM_CONFIG_REGISTRY = e.url;
        env.npm_config_registry = e.url;
        if (e.caFile) env.NPM_CONFIG_CAFILE = e.caFile;
      },
      injectRegistryFlags: (e, args) => {
        if (!args.includes("--registry")) args.push("--registry", e.url);
      },
      injectSandboxFlags: (_command, args) => {
        const modified = [...args];
        if (!modified.includes("--ignore-scripts")) modified.push("--ignore-scripts");
        return modified;
      },
      resolveEphemeralCommand: (spec, trailingArgs, commandExists) => {
        const base = spec.namespace ? `${spec.namespace}/${spec.name}` : spec.name;
        const fullPkg = spec.version ? `${base}@${spec.version}` : base;
        if (commandExists("bun")) return { command: "bunx", args: [fullPkg, ...trailingArgs] };
        return { command: "npx", args: ["--yes", fullPkg, ...trailingArgs] };
      },
    },
  },
  {
    groupKey: "core",
    loader: loadCoreGroup,
    meta: {
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
    },
  },
  {
    groupKey: "core",
    loader: loadCoreGroup,
    meta: {
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
      resolveScriptCommand: (script) => ["python", ["-m", script]],
      injectRegistryEnv: (e, env) => {
        env.UV_INDEX_URL = e.url;
        env.PIP_INDEX_URL = e.url;
        if (e.trustedHost) env.PIP_TRUSTED_HOST = e.trustedHost;
      },
      injectRegistryFlags: (e, args) => {
        if (!args.includes("--index-url")) args.push("--index-url", e.url);
      },
      injectSandboxFlags: (command, args) => {
        if (command === "pip" && !args.includes("--no-build-isolation")) {
          return [...args, "--no-build-isolation"];
        }
        return args;
      },
    },
  },
  {
    groupKey: "core",
    loader: loadCoreGroup,
    meta: {
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
      resolveScriptCommand: (script) => [
        "conda",
        ["run", "--no-capture-output", "python", "-m", script],
      ],
      injectRegistryEnv: (e, env) => {
        env.CONDA_CHANNELS = e.url;
      },
      resolveEphemeralCommand: (spec, trailingArgs, commandExists) => {
        const runner = commandExists("mamba") ? "mamba" : commandExists("conda") ? "conda" : null;
        if (!runner) return null;
        return { command: runner, args: ["run", spec.name, ...trailingArgs] };
      },
    },
  },
  {
    groupKey: "core",
    loader: loadCoreGroup,
    meta: {
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
      resolveScriptCommand: (script) => {
        if (script === "dev" || script === "start") return ["cargo", ["run"]];
        if (script === "test") return ["cargo", ["test"]];
        return ["cargo", [script]];
      },
      injectRegistryEnv: (e, env) => {
        env.CARGO_REGISTRIES_CRATES_IO_INDEX = e.url;
      },
    },
  },
  {
    groupKey: "core",
    loader: loadCoreGroup,
    meta: {
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
      resolveScriptCommand: (script) => {
        if (script === "dev" || script === "start") return ["go", ["run", "."]];
        if (script === "test") return ["go", ["test", "./..."]];
        return ["go", [script]];
      },
      injectRegistryEnv: (e, env) => {
        env.GOPROXY = e.url;
      },
      resolveEphemeralCommand: (spec, trailingArgs) => {
        const target = spec.version ? `${spec.name}@${spec.version}` : `${spec.name}@latest`;
        return { command: "go", args: ["run", target, ...trailingArgs] };
      },
    },
  },
  // Phase 2 Backend & Mobile
  {
    groupKey: "backend-mobile",
    loader: loadBackendMobileGroup,
    meta: {
      id: "dotnet",
      ecosystem: "nuget",
      aliases: ["dotnet", "csharp", "paket"],
      purlTypes: ["nuget"],
      manifests: ["*.csproj", "*.fsproj", "*.vbproj", "paket.dependencies"],
      lockfiles: ["packages.lock.json", "paket.lock"],
      osvEcosystem: "NuGet",
      sbomPurlType: "nuget",
      defaultCli: "dotnet",
      supportedClis: ["dotnet", "paket"],
    },
  },
  {
    groupKey: "backend-mobile",
    loader: loadBackendMobileGroup,
    meta: {
      id: "composer",
      ecosystem: "composer",
      aliases: ["php", "packagist", "pear"],
      purlTypes: ["composer"],
      manifests: ["composer.json", "package.xml"],
      lockfiles: ["composer.lock"],
      osvEcosystem: "Packagist",
      sbomPurlType: "composer",
      defaultCli: "composer",
      supportedClis: ["composer", "pear"],
    },
  },
  {
    groupKey: "backend-mobile",
    loader: loadBackendMobileGroup,
    meta: {
      id: "bundler",
      ecosystem: "gem",
      aliases: ["ruby", "bundler", "rubygems"],
      purlTypes: ["gem"],
      manifests: ["Gemfile", "*.gemspec"],
      lockfiles: ["Gemfile.lock"],
      osvEcosystem: "RubyGems",
      sbomPurlType: "gem",
      defaultCli: "bundle",
      supportedClis: ["bundle", "gem"],
    },
  },
  {
    groupKey: "backend-mobile",
    loader: loadBackendMobileGroup,
    meta: {
      id: "pub",
      ecosystem: "pub",
      aliases: ["dart", "flutter"],
      purlTypes: ["pub"],
      manifests: ["pubspec.yaml"],
      lockfiles: ["pubspec.lock"],
      osvEcosystem: "Pub",
      sbomPurlType: "pub",
      defaultCli: "dart",
      supportedClis: ["dart", "flutter"],
    },
  },
  // Phase 3 C/C++ & Julia
  {
    groupKey: "cpp-julia",
    loader: loadCppJuliaGroup,
    meta: {
      id: "conan",
      ecosystem: "conan",
      aliases: ["cpp", "c++"],
      purlTypes: ["conan"],
      manifests: ["conanfile.txt", "conanfile.py"],
      lockfiles: ["conan.lock"],
      osvEcosystem: "ConanCenter",
      sbomPurlType: "conan",
      defaultCli: "conan",
      supportedClis: ["conan"],
    },
  },
  {
    groupKey: "cpp-julia",
    loader: loadCppJuliaGroup,
    meta: {
      id: "vcpkg",
      ecosystem: "vcpkg",
      aliases: [],
      purlTypes: ["vcpkg"],
      manifests: ["vcpkg.json", "vcpkg-configuration.json"],
      lockfiles: ["vcpkg-configuration.json"],
      sbomPurlType: "vcpkg",
      defaultCli: "vcpkg",
      supportedClis: ["vcpkg"],
    },
  },
  {
    groupKey: "cpp-julia",
    loader: loadCppJuliaGroup,
    meta: {
      id: "meson",
      ecosystem: "meson",
      aliases: ["wrap", "wrapdb"],
      purlTypes: ["meson", "wrap"],
      manifests: ["meson.build"],
      lockfiles: [],
      sbomPurlType: "meson",
      defaultCli: "meson",
      supportedClis: ["meson"],
    },
  },
  {
    groupKey: "cpp-julia",
    loader: loadCppJuliaGroup,
    meta: {
      id: "julia",
      ecosystem: "julia",
      aliases: ["pkg.jl", "pkgjl"],
      purlTypes: ["julia"],
      manifests: ["Project.toml"],
      lockfiles: ["Manifest.toml"],
      sbomPurlType: "julia",
      defaultCli: "julia",
      supportedClis: ["julia"],
    },
  },
  // Phase 4 Tier 2 Manifest-Rewriting
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "maven",
      ecosystem: "maven",
      aliases: ["mvn", "java", "jvm", "ivy"],
      purlTypes: ["maven"],
      manifests: ["pom.xml", "ivy.xml"],
      lockfiles: [],
      osvEcosystem: "Maven",
      sbomPurlType: "maven",
      defaultCli: "mvn",
      supportedClis: ["mvn", "ant"],
    },
  },
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "gradle",
      ecosystem: "gradle",
      aliases: ["kts", "kotlin"],
      purlTypes: ["gradle"],
      manifests: ["build.gradle.kts", "build.gradle", "gradle/libs.versions.toml"],
      lockfiles: ["gradle.lockfile"],
      osvEcosystem: "Maven",
      sbomPurlType: "maven",
      defaultCli: "gradle",
      supportedClis: ["gradle"],
    },
  },
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "sbt",
      ecosystem: "sbt",
      aliases: ["scala"],
      purlTypes: ["sbt"],
      manifests: ["build.sbt"],
      lockfiles: [],
      osvEcosystem: "Maven",
      sbomPurlType: "maven",
      defaultCli: "sbt",
      supportedClis: ["sbt"],
    },
  },
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "mix",
      ecosystem: "hex",
      aliases: ["elixir", "mix"],
      purlTypes: ["hex"],
      manifests: ["mix.exs"],
      lockfiles: ["mix.lock"],
      osvEcosystem: "Hex",
      sbomPurlType: "hex",
      defaultCli: "mix",
      supportedClis: ["mix"],
    },
  },
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "rebar3",
      ecosystem: "rebar3",
      aliases: ["erlang", "rebar"],
      purlTypes: ["rebar3"],
      manifests: ["rebar.config"],
      lockfiles: ["rebar.lock"],
      osvEcosystem: "Hex",
      sbomPurlType: "hex",
      defaultCli: "rebar3",
      supportedClis: ["rebar3"],
    },
  },
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "swift",
      ecosystem: "swift",
      aliases: ["spm", "swiftpm"],
      purlTypes: ["swift"],
      manifests: ["Package.swift"],
      lockfiles: ["Package.resolved"],
      osvEcosystem: "SwiftURL",
      sbomPurlType: "swift",
      defaultCli: "swift",
      supportedClis: ["swift"],
    },
  },
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "cocoapods",
      ecosystem: "cocoapods",
      aliases: ["pod", "pods"],
      purlTypes: ["cocoapods"],
      manifests: ["Podfile", "*.podspec"],
      lockfiles: ["Podfile.lock"],
      sbomPurlType: "cocoapods",
      defaultCli: "pod",
      supportedClis: ["pod"],
    },
  },
  {
    groupKey: "tier2-manifest",
    loader: loadTier2ManifestGroup,
    meta: {
      id: "carthage",
      ecosystem: "carthage",
      aliases: [],
      purlTypes: ["carthage"],
      manifests: ["Cartfile"],
      lockfiles: ["Cartfile.resolved"],
      sbomPurlType: "github",
      defaultCli: "carthage",
      supportedClis: ["carthage"],
    },
  },
  // Phase 5 Long-Tail Scripting
  {
    groupKey: "longtail",
    loader: loadLongtailGroup,
    meta: {
      id: "hackage",
      ecosystem: "hackage",
      aliases: ["haskell", "cabal", "stack"],
      purlTypes: ["hackage"],
      manifests: ["*.cabal", "package.yaml"],
      lockfiles: ["cabal.project.freeze", "stack.yaml.lock"],
      osvEcosystem: "Hackage",
      sbomPurlType: "hackage",
      defaultCli: "cabal",
      supportedClis: ["cabal", "stack"],
    },
  },
  {
    groupKey: "longtail",
    loader: loadLongtailGroup,
    meta: {
      id: "cran",
      ecosystem: "cran",
      aliases: ["r", "pak", "renv"],
      purlTypes: ["cran"],
      manifests: ["DESCRIPTION", "renv.lock"],
      lockfiles: ["renv.lock"],
      osvEcosystem: "CRAN",
      sbomPurlType: "cran",
      defaultCli: "Rscript",
      supportedClis: ["Rscript"],
    },
  },
  {
    groupKey: "longtail",
    loader: loadLongtailGroup,
    meta: {
      id: "cpan",
      ecosystem: "cpan",
      aliases: ["perl", "cpanm", "ppm"],
      purlTypes: ["cpan"],
      manifests: ["cpanfile", "Makefile.PL"],
      lockfiles: ["cpanfile.snapshot"],
      sbomPurlType: "cpan",
      defaultCli: "cpanm",
      supportedClis: ["cpanm", "cpan", "ppm"],
    },
  },
  {
    groupKey: "longtail",
    loader: loadLongtailGroup,
    meta: {
      id: "luarocks",
      ecosystem: "luarocks",
      aliases: ["lua"],
      purlTypes: ["luarocks"],
      manifests: ["*.rockspec"],
      lockfiles: [],
      sbomPurlType: "luarocks",
      defaultCli: "luarocks",
      supportedClis: ["luarocks"],
    },
  },
];

for (const item of LAZY_DESCRIPTORS) {
  engineRegistry.registerLazy(item.meta, item.groupKey, item.loader);
}

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
