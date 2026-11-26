import type { RegistryEndpoint } from "../registry/types.js";
import type { Ecosystem, EngineContext, PackageSpec } from "../types.js";
import { BaseEngine } from "./base.js";

export interface DeclarativeCommandSpec {
  /** Primary CLI binary or resolver for dynamic manager selection (e.g. ["mamba", "conda"]). */
  command: string | readonly string[] | ((ctx?: EngineContext) => string);
  /** Formats add command arguments for a parsed PackageSpec. */
  add: (pkg: PackageSpec, ctx?: EngineContext) => string[];
  /** Formats remove command arguments for a parsed PackageSpec. */
  remove: (pkg: PackageSpec, ctx?: EngineContext) => string[];
  /** Formats workspace/project install/sync command arguments. */
  install: (ctx?: EngineContext) => string[];
  /** Formats dependency update command arguments. */
  update: (pkg?: PackageSpec, ctx?: EngineContext) => string[];
  /** Optional Tier 2 manifest mutator executed prior to CLI add command. */
  mutateAdd?: (
    pkg: PackageSpec,
    cwd: string,
    ctx?: EngineContext,
  ) => { manifestFile: string; changed: boolean } | null;
  /** Optional Tier 2 manifest mutator executed prior to CLI remove command. */
  mutateRemove?: (
    pkg: PackageSpec,
    cwd: string,
    ctx?: EngineContext,
  ) => { manifestFile: string; changed: boolean } | null;
}

export interface EngineAdapter {
  readonly id: string;
  readonly ecosystem: Ecosystem;
  readonly aliases?: readonly string[];
  readonly purlTypes?: readonly string[];
  /** Exact filenames or wildcard globs (e.g. "*.csproj", "*.rockspec", "*.cabal"). */
  readonly manifests: readonly string[];
  readonly lockfiles: readonly string[];
  readonly osvEcosystem?: string;
  readonly sbomPurlType?: string;
  readonly defaultCli: string;
  readonly supportedClis?: readonly string[];
  createEngine(ctx?: EngineContext): BaseEngine;
  resolveScriptCommand?: (script: string, ctx?: EngineContext) => [string, string[]];
  injectRegistryEnv?: (endpoint: RegistryEndpoint, env: NodeJS.ProcessEnv) => void;
  injectRegistryFlags?: (endpoint: RegistryEndpoint, args: string[]) => void;
  injectSandboxFlags?: (command: string, args: string[]) => string[];
  resolveEphemeralCommand?: (
    spec: PackageSpec,
    trailingArgs: string[],
    commandExists: (cmd: string) => boolean,
  ) => { command: string; args: string[] } | null;
}

/**
 * Declarative CLI engine enabling Tier 1 package managers to be added in ~20 lines of config.
 */
export class DeclarativeEngine extends BaseEngine {
  readonly name: string;
  readonly ecosystem: Ecosystem;
  private readonly spec: DeclarativeCommandSpec;
  private readonly ctx?: EngineContext;
  private readonly activeCommand: string;

  constructor(
    name: string,
    ecosystem: Ecosystem,
    spec: DeclarativeCommandSpec,
    ctx?: EngineContext,
  ) {
    super();
    this.name = name;
    this.ecosystem = ecosystem;
    this.spec = spec;
    this.ctx = ctx;
    this.activeCommand = this.resolveCommand();
  }

  private resolveCommand(): string {
    if (this.ctx?.preferredCli) return this.ctx.preferredCli;
    if (typeof this.spec.command === "function") return this.spec.command(this.ctx);
    if (typeof this.spec.command === "string") return this.spec.command;
    for (const candidate of this.spec.command) {
      if (this.isCommandAvailable(candidate)) return candidate;
    }
    return this.spec.command[0];
  }

  override getEffectiveCli(): string {
    return this.activeCommand;
  }

  resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] } {
    return { command: this.activeCommand, args: this.spec.add(pkg, this.ctx) };
  }

  resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] } {
    return { command: this.activeCommand, args: this.spec.remove(pkg, this.ctx) };
  }

  resolveInstallArgs(): { command: string; args: string[] } {
    return { command: this.activeCommand, args: this.spec.install(this.ctx) };
  }

  resolveUpdateArgs(pkg?: PackageSpec): { command: string; args: string[] } {
    return { command: this.activeCommand, args: this.spec.update(pkg, this.ctx) };
  }

  override applyManifestAdd(
    pkg: PackageSpec,
    cwd: string,
  ): { manifestFile: string; changed: boolean } | null {
    return this.spec.mutateAdd ? this.spec.mutateAdd(pkg, cwd, this.ctx) : null;
  }

  override applyManifestRemove(
    pkg: PackageSpec,
    cwd: string,
  ): { manifestFile: string; changed: boolean } | null {
    return this.spec.mutateRemove ? this.spec.mutateRemove(pkg, cwd, this.ctx) : null;
  }
}

/**
 * Helper factory to define a declarative EngineAdapter for Tier 1 CLI package managers in ~20 lines.
 */
export function defineDeclarativeAdapter(config: {
  id: string;
  ecosystem: Ecosystem;
  aliases?: readonly string[];
  purlTypes?: readonly string[];
  manifests: readonly string[];
  lockfiles: readonly string[];
  osvEcosystem?: string;
  sbomPurlType?: string;
  commands: DeclarativeCommandSpec;
  supportedClis?: readonly string[];
  resolveScriptCommand?: (script: string, ctx?: EngineContext) => [string, string[]];
  injectRegistryEnv?: (endpoint: RegistryEndpoint, env: NodeJS.ProcessEnv) => void;
  injectRegistryFlags?: (endpoint: RegistryEndpoint, args: string[]) => void;
  injectSandboxFlags?: (command: string, args: string[]) => string[];
  resolveEphemeralCommand?: EngineAdapter["resolveEphemeralCommand"];
}): EngineAdapter {
  const defaultCli =
    typeof config.commands.command === "string"
      ? config.commands.command
      : Array.isArray(config.commands.command)
        ? config.commands.command[0]
        : config.id;

  return {
    id: config.id,
    ecosystem: config.ecosystem,
    aliases: config.aliases,
    purlTypes: config.purlTypes,
    manifests: config.manifests,
    lockfiles: config.lockfiles,
    osvEcosystem: config.osvEcosystem,
    sbomPurlType: config.sbomPurlType,
    defaultCli,
    supportedClis:
      config.supportedClis ??
      (Array.isArray(config.commands.command) ? config.commands.command : [defaultCli]),
    createEngine: (ctx) => new DeclarativeEngine(config.id, config.ecosystem, config.commands, ctx),
    resolveScriptCommand: config.resolveScriptCommand,
    injectRegistryEnv: config.injectRegistryEnv,
    injectRegistryFlags: config.injectRegistryFlags,
    injectSandboxFlags: config.injectSandboxFlags,
    resolveEphemeralCommand: config.resolveEphemeralCommand,
  };
}
