import { detectContexts, resolvePrimaryContext } from "../detector/tree-walker.js";
import {
  type BaseEngine,
  GoEngine,
  NodeEngine,
  PythonEngine,
  RustEngine,
} from "../engines/index.js";
import { parsePackageSpec } from "../purl/parser.js";
import { RegistryRouter } from "../registry/index.js";
import type { Ecosystem, ExecutionResult, PackageSpec } from "../types.js";
import { promptDisambiguation } from "../ui/prompt.js";
import { logExecutionPlan, logSuccess } from "../ui/reporter.js";

export class PolyDispatcher {
  private registryRouter = new RegistryRouter();

  /**
   * Resolves ecosystem and adds a package using the native manager
   */
  async add(
    packageInput: string,
    options?: { isDev?: boolean; cwd?: string; silent?: boolean },
  ): Promise<ExecutionResult> {
    const cwd = options?.cwd ?? process.cwd();
    const pkg = parsePackageSpec(packageInput, { isDev: options?.isDev });

    // 1. Resolve ecosystem if not explicitly prefixed
    if (!pkg.ecosystem) {
      pkg.ecosystem = await this.resolveEcosystemForPackage(pkg.name, cwd);
    }

    // 2. Select native engine
    const engine = this.getEngineForEcosystem(pkg.ecosystem, cwd);
    const { command, args } = engine.resolveAddArgs(pkg);
    const routedArgs = this.registryRouter.injectCliFlags(pkg.ecosystem, args, cwd);
    const routedEnv = this.registryRouter.injectEnvironmentVariables(pkg.ecosystem, cwd);

    if (!options?.silent) {
      logExecutionPlan("add", pkg, engine.name, command, routedArgs);
    }

    // 3. Execute native command
    const result = await engine.execute(command, routedArgs, cwd, {
      silent: options?.silent,
      env: routedEnv,
    });
    if (result.exitCode === 0 && !options?.silent) {
      logSuccess(`Added ${pkg.name} (${pkg.ecosystem}) via ${engine.name}`, result.durationMs);
    }

    return result;
  }

  /**
   * Resolves ecosystem and removes a package using the native manager
   */
  async remove(
    packageInput: string,
    options?: { cwd?: string; silent?: boolean },
  ): Promise<ExecutionResult> {
    const cwd = options?.cwd ?? process.cwd();
    const pkg = parsePackageSpec(packageInput);

    if (!pkg.ecosystem) {
      pkg.ecosystem = await this.resolveEcosystemForPackage(pkg.name, cwd);
    }

    const engine = this.getEngineForEcosystem(pkg.ecosystem, cwd);
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
  async install(options?: {
    all?: boolean;
    cwd?: string;
    silent?: boolean;
  }): Promise<ExecutionResult[]> {
    const cwd = options?.cwd ?? process.cwd();

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
        const res = await engine.execute(command, routedArgs, ctx.directory, {
          silent: options?.silent,
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
      targetEcosystem = await promptDisambiguation("dependencies", conflicts);
    } else {
      throw new Error(`No project manifests found in '${cwd}' or parent directories.`);
    }

    const engine = this.getEngineForEcosystem(targetEcosystem, cwd);
    const { command, args } = engine.resolveInstallArgs();
    const routedArgs = this.registryRouter.injectCliFlags(targetEcosystem, args, cwd);
    const routedEnv = this.registryRouter.injectEnvironmentVariables(targetEcosystem, cwd);
    const result = await engine.execute(command, routedArgs, cwd, {
      silent: options?.silent,
      env: routedEnv,
    });

    if (result.exitCode === 0 && !options?.silent) {
      logSuccess(`Installed ${targetEcosystem} dependencies via ${engine.name}`, result.durationMs);
    }

    return [result];
  }

  /**
   * Updates dependencies to their latest compatible versions
   */
  async update(
    packageInput?: string,
    options?: { all?: boolean; cwd?: string; silent?: boolean },
  ): Promise<ExecutionResult[]> {
    const cwd = options?.cwd ?? process.cwd();

    if (packageInput) {
      const pkg = parsePackageSpec(packageInput);
      if (!pkg.ecosystem) {
        pkg.ecosystem = await this.resolveEcosystemForPackage(pkg.name, cwd);
      }

      const engine = this.getEngineForEcosystem(pkg.ecosystem, cwd);
      const { command, args } = engine.resolveUpdateArgs(pkg);
      const routedArgs = this.registryRouter.injectCliFlags(pkg.ecosystem, args, cwd);
      const routedEnv = this.registryRouter.injectEnvironmentVariables(pkg.ecosystem, cwd);

      if (!options?.silent) {
        logExecutionPlan("update", pkg, engine.name, command, routedArgs);
      }

      const result = await engine.execute(command, routedArgs, cwd, {
        silent: options?.silent,
        env: routedEnv,
      });

      if (result.exitCode === 0 && !options?.silent) {
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
        const res = await engine.execute(command, routedArgs, ctx.directory, {
          silent: options?.silent,
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
      targetEcosystem = await promptDisambiguation("dependencies", conflicts);
    } else {
      throw new Error(`No project manifests found in '${cwd}' or parent directories.`);
    }

    const engine = this.getEngineForEcosystem(targetEcosystem, cwd);
    const { command, args } = engine.resolveUpdateArgs();
    const routedArgs = this.registryRouter.injectCliFlags(targetEcosystem, args, cwd);
    const routedEnv = this.registryRouter.injectEnvironmentVariables(targetEcosystem, cwd);
    const result = await engine.execute(command, routedArgs, cwd, {
      silent: options?.silent,
      env: routedEnv,
    });

    if (result.exitCode === 0 && !options?.silent) {
      logSuccess(`Updated ${targetEcosystem} dependencies via ${engine.name}`, result.durationMs);
    }

    return [result];
  }

  /**
   * Inspects which CLI tool powers an ecosystem
   */
  which(ecosystem: Ecosystem, cwd?: string): { engine: string; effectiveCli: string } {
    const engine = this.getEngineForEcosystem(ecosystem, cwd ?? process.cwd());
    let effectiveCli = engine.name;
    if (engine instanceof NodeEngine) {
      effectiveCli = engine.getEffectiveCli();
    } else if (engine instanceof PythonEngine) {
      effectiveCli = engine.getEffectiveCli();
    }
    return { engine: engine.name, effectiveCli };
  }

  private async resolveEcosystemForPackage(packageName: string, cwd: string): Promise<Ecosystem> {
    const { primary, conflicts } = resolvePrimaryContext(cwd);

    if (primary) {
      return primary.ecosystem;
    }

    if (conflicts.length > 0) {
      return promptDisambiguation(packageName, conflicts);
    }

    throw new Error(
      `Could not determine ecosystem for '${packageName}'.\n` +
        `No manifest (package.json, pyproject.toml, Cargo.toml, go.mod) was found in '${cwd}' or its parents.\n` +
        `Remediation: Pass an explicit ecosystem prefix, e.g. 'npm:${packageName}' or 'pypi:${packageName}'.`,
    );
  }

  private getEngineForEcosystem(ecosystem: Ecosystem, cwd: string): BaseEngine {
    const contexts = detectContexts(cwd);
    const ctx = contexts.find((c) => c.ecosystem === ecosystem);

    switch (ecosystem) {
      case "npm":
        return new NodeEngine(ctx?.lockfile);
      case "pypi":
        return new PythonEngine(ctx?.lockfile);
      case "cargo":
        return new RustEngine();
      case "go":
        return new GoEngine();
    }
  }
}
