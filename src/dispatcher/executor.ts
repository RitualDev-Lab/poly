import { detectContexts, resolvePrimaryContext } from "../detector/tree-walker.js";
import { type BaseEngine, engineRegistry } from "../engines/index.js";
import { parsePackageSpec } from "../purl/parser.js";
import { RegistryRouter } from "../registry/index.js";
import { evaluateSandboxGate, injectSandboxFlags } from "../sandbox/index.js";
import { enforcePackageFirewall } from "../security/index.js";
import type { Ecosystem, ExecutionResult, PackageSpec } from "../types.js";
import { promptDisambiguation } from "../ui/prompt.js";
import { logExecutionPlan, logInfo, logSuccess } from "../ui/reporter.js";

export interface DispatcherOptions {
  isDev?: boolean;
  cwd?: string;
  silent?: boolean;
  all?: boolean;
  sandbox?: boolean;
  allowScripts?: string[];
  allowUntested?: boolean;
  agent?: boolean;
}

export class PolyDispatcher {
  private registryRouter = new RegistryRouter();

  /**
   * Resolves ecosystem and adds a package using the native manager
   */
  async add(packageInput: string, options?: DispatcherOptions): Promise<ExecutionResult> {
    const cwd = options?.cwd ?? process.cwd();
    const pkg = parsePackageSpec(packageInput, { isDev: options?.isDev });

    // 1. Resolve ecosystem if not explicitly prefixed
    if (!pkg.ecosystem) {
      pkg.ecosystem = await this.resolveEcosystemForPackage(pkg.name, cwd, options?.agent);
    }

    // 2. Pre-flight Live Supply-Chain & License Firewall
    const firewallResult = await enforcePackageFirewall(pkg, {
      allowUntested: options?.allowUntested,
      cwd,
    });
    if (firewallResult.rollbackOccurred) {
      pkg.version = firewallResult.effectiveVersion;
      if (!options?.silent && !options?.agent) {
        logInfo(`[firewall] ${firewallResult.rollbackReason} (pass --allow-untested to bypass)`);
      }
    }

    // 3. Pre-flight Supply-Chain Sandbox Check
    const isSandboxed = options?.sandbox || options?.agent || false;
    if (isSandboxed) {
      const gate = await evaluateSandboxGate(pkg, {
        enabled: true,
        allowScripts: options?.allowScripts,
      });
      if (gate.blocked) {
        throw new Error(
          `[SECURITY GATE] Package '${pkg.name}' was blocked by Poly supply-chain sandbox.\n` +
            `Reason: ${gate.details}\n` +
            `Remediation: ${gate.remediation}`,
        );
      }
    }

    // 3. Select native engine
    const engine = this.getEngineForEcosystem(pkg.ecosystem, cwd);
    const { command, args } = engine.resolveAddArgs(pkg);
    const routedArgs = this.registryRouter.injectCliFlags(pkg.ecosystem, args, cwd);
    const routedEnv = this.registryRouter.injectEnvironmentVariables(pkg.ecosystem, cwd);

    // 4. Inject Sandbox Flags (e.g. --ignore-scripts)
    const finalArgs = injectSandboxFlags(pkg.ecosystem, command, routedArgs, pkg.name, {
      enabled: isSandboxed,
      allowScripts: options?.allowScripts,
    });

    if (!options?.silent && !options?.agent) {
      logExecutionPlan("add", pkg, engine.name, command, finalArgs);
    }

    // 4.5 Apply Tier 2 manifest mutation if supported by engine (JVM, Elixir, Swift)
    const mutation = engine.applyManifestAdd?.(pkg, cwd);
    if (mutation?.changed && !options?.silent && !options?.agent) {
      logInfo(`[manifest] Updated ${mutation.manifestFile}`);
    }

    // 5. Execute native command
    const result = await engine.execute(command, finalArgs, cwd, {
      silent: options?.silent || options?.agent,
      env: routedEnv,
    });
    if (result.exitCode === 0 && !options?.silent && !options?.agent) {
      logSuccess(`Added ${pkg.name} (${pkg.ecosystem}) via ${engine.name}`, result.durationMs);
    }

    return result;
  }

  /**
   * Resolves ecosystem and removes a package using the native manager
   */
  async remove(packageInput: string, options?: DispatcherOptions): Promise<ExecutionResult> {
    const cwd = options?.cwd ?? process.cwd();
    const pkg = parsePackageSpec(packageInput);

    if (!pkg.ecosystem) {
      pkg.ecosystem = await this.resolveEcosystemForPackage(pkg.name, cwd);
    }

    const engine = this.getEngineForEcosystem(pkg.ecosystem, cwd);
    const mutation = engine.applyManifestRemove?.(pkg, cwd);
    if (mutation?.changed && !options?.silent && !options?.agent) {
      logInfo(`[manifest] Updated ${mutation.manifestFile}`);
    }
    const { command, args } = engine.resolveRemoveArgs(pkg);

    if (!options?.silent) {
      logExecutionPlan("remove", pkg, engine.name, command, args);
    }

    const result = await engine.execute(command, args, cwd, options);
    if (result.exitCode === 0 && !options?.silent) {
      logSuccess(`Removed ${pkg.name} (${pkg.ecosystem}) via ${engine.name}`, result.durationMs);
    }

    return result;
  }

  /**
   * Installs or syncs dependencies
   */
  async install(options?: DispatcherOptions): Promise<ExecutionResult[]> {
    const cwd = options?.cwd ?? process.cwd();
    const isSandboxed = options?.sandbox || options?.agent || false;

    if (options?.all) {
      const allContexts = detectContexts(cwd);
      if (allContexts.length === 0) {
        throw new Error(`No project manifests found in '${cwd}' or parent directories.`);
      }

      const results: ExecutionResult[] = [];
      for (const ctx of allContexts) {
        const engine = this.getEngineForEcosystem(ctx.ecosystem, ctx.directory);
        const { command, args } = engine.resolveInstallArgs();
        const routedArgs = this.registryRouter.injectCliFlags(ctx.ecosystem, args, ctx.directory);
        const routedEnv = this.registryRouter.injectEnvironmentVariables(
          ctx.ecosystem,
          ctx.directory,
        );
        const finalArgs = injectSandboxFlags(ctx.ecosystem, command, routedArgs, undefined, {
          enabled: isSandboxed,
          allowScripts: options?.allowScripts,
        });
        const res = await engine.execute(command, finalArgs, ctx.directory, {
          silent: options?.silent || options?.agent,
          env: routedEnv,
        });
        results.push(res);
      }
      return results;
    }

    const { primary, conflicts } = resolvePrimaryContext(cwd);
    let targetEcosystem: Ecosystem;

    if (primary) {
      targetEcosystem = primary.ecosystem;
    } else if (conflicts.length > 0) {
      if (options?.agent) {
        targetEcosystem = conflicts[0].ecosystem;
      } else {
        targetEcosystem = await promptDisambiguation("dependencies", conflicts);
      }
    } else {
      throw new Error(`No project manifests found in '${cwd}' or parent directories.`);
    }

    const engine = this.getEngineForEcosystem(targetEcosystem, cwd);
    const { command, args } = engine.resolveInstallArgs();
    const routedArgs = this.registryRouter.injectCliFlags(targetEcosystem, args, cwd);
    const routedEnv = this.registryRouter.injectEnvironmentVariables(targetEcosystem, cwd);
    const finalArgs = injectSandboxFlags(targetEcosystem, command, routedArgs, undefined, {
      enabled: isSandboxed,
      allowScripts: options?.allowScripts,
    });
    const result = await engine.execute(command, finalArgs, cwd, {
      silent: options?.silent || options?.agent,
      env: routedEnv,
    });

    if (result.exitCode === 0 && !options?.silent && !options?.agent) {
      logSuccess(`Installed ${targetEcosystem} dependencies via ${engine.name}`, result.durationMs);
    }

    return [result];
  }

  /**
   * Updates dependencies to their latest compatible versions
   */
  async update(packageInput?: string, options?: DispatcherOptions): Promise<ExecutionResult[]> {
    const cwd = options?.cwd ?? process.cwd();
    const isSandboxed = options?.sandbox || options?.agent || false;

    if (packageInput) {
      const pkg = parsePackageSpec(packageInput);
      if (!pkg.ecosystem) {
        pkg.ecosystem = await this.resolveEcosystemForPackage(pkg.name, cwd, options?.agent);
      }

      const engine = this.getEngineForEcosystem(pkg.ecosystem, cwd);
      const { command, args } = engine.resolveUpdateArgs(pkg);
      const routedArgs = this.registryRouter.injectCliFlags(pkg.ecosystem, args, cwd);
      const routedEnv = this.registryRouter.injectEnvironmentVariables(pkg.ecosystem, cwd);
      const finalArgs = injectSandboxFlags(pkg.ecosystem, command, routedArgs, pkg.name, {
        enabled: isSandboxed,
        allowScripts: options?.allowScripts,
      });

      if (!options?.silent && !options?.agent) {
        logExecutionPlan("update", pkg, engine.name, command, finalArgs);
      }

      const result = await engine.execute(command, finalArgs, cwd, {
        silent: options?.silent || options?.agent,
        env: routedEnv,
      });

      if (result.exitCode === 0 && !options?.silent && !options?.agent) {
        logSuccess(`Updated ${pkg.name} (${pkg.ecosystem}) via ${engine.name}`, result.durationMs);
      }

      return [result];
    }

    // Update all dependencies
    if (options?.all) {
      const allContexts = detectContexts(cwd);
      if (allContexts.length === 0) {
        throw new Error(`No project manifests found in '${cwd}' or parent directories.`);
      }

      const results: ExecutionResult[] = [];
      for (const ctx of allContexts) {
        const engine = this.getEngineForEcosystem(ctx.ecosystem, ctx.directory);
        const { command, args } = engine.resolveUpdateArgs();
        const routedArgs = this.registryRouter.injectCliFlags(ctx.ecosystem, args, ctx.directory);
        const routedEnv = this.registryRouter.injectEnvironmentVariables(
          ctx.ecosystem,
          ctx.directory,
        );
        const finalArgs = injectSandboxFlags(ctx.ecosystem, command, routedArgs, undefined, {
          enabled: isSandboxed,
          allowScripts: options?.allowScripts,
        });
        const res = await engine.execute(command, finalArgs, ctx.directory, {
          silent: options?.silent || options?.agent,
          env: routedEnv,
        });
        results.push(res);
      }
      return results;
    }

    const { primary, conflicts } = resolvePrimaryContext(cwd);
    let targetEcosystem: Ecosystem;

    if (primary) {
      targetEcosystem = primary.ecosystem;
    } else if (conflicts.length > 0) {
      if (options?.agent) {
        targetEcosystem = conflicts[0].ecosystem;
      } else {
        targetEcosystem = await promptDisambiguation("dependencies", conflicts);
      }
    } else {
      throw new Error(`No project manifests found in '${cwd}' or parent directories.`);
    }

    const engine = this.getEngineForEcosystem(targetEcosystem, cwd);
    const { command, args } = engine.resolveUpdateArgs();
    const routedArgs = this.registryRouter.injectCliFlags(targetEcosystem, args, cwd);
    const routedEnv = this.registryRouter.injectEnvironmentVariables(targetEcosystem, cwd);
    const finalArgs = injectSandboxFlags(targetEcosystem, command, routedArgs, undefined, {
      enabled: isSandboxed,
      allowScripts: options?.allowScripts,
    });
    const result = await engine.execute(command, finalArgs, cwd, {
      silent: options?.silent || options?.agent,
      env: routedEnv,
    });

    if (result.exitCode === 0 && !options?.silent && !options?.agent) {
      logSuccess(`Updated ${targetEcosystem} dependencies via ${engine.name}`, result.durationMs);
    }

    return [result];
  }

  /**
   * Inspects which CLI tool powers an ecosystem
   */
  which(ecosystem: Ecosystem, cwd?: string): { engine: string; effectiveCli: string } {
    const engine = this.getEngineForEcosystem(ecosystem, cwd ?? process.cwd());
    return { engine: engine.name, effectiveCli: engine.getEffectiveCli() };
  }

  private async resolveEcosystemForPackage(
    packageName: string,
    cwd: string,
    agentMode = false,
  ): Promise<Ecosystem> {
    const { primary, conflicts } = resolvePrimaryContext(cwd);

    if (primary) {
      return primary.ecosystem;
    }

    if (conflicts.length > 0) {
      if (agentMode) {
        return conflicts[0].ecosystem;
      }
      return promptDisambiguation(packageName, conflicts);
    }

    throw new Error(
      `Could not determine ecosystem for '${packageName}'.\n` +
        `No manifest (package.json, deno.json, pyproject.toml, environment.yml, Cargo.toml, go.mod) was found in '${cwd}' or its parents.\n` +
        `Remediation: Pass an explicit ecosystem prefix, e.g. 'npm:${packageName}', 'jsr:@scope/pkg', 'pypi:${packageName}', or 'conda:${packageName}'.`,
    );
  }

  private getEngineForEcosystem(ecosystem: Ecosystem, cwd: string): BaseEngine {
    const contexts = detectContexts(cwd);
    const ctx = contexts.find((c) => c.ecosystem === ecosystem);

    return engineRegistry.createEngine(ecosystem, {
      cwd,
      ecosystem,
      manifest: ctx?.manifestFile,
      lockfile: ctx?.lockfile,
    });
  }
}
