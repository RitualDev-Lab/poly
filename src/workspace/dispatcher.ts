import { GoEngine, NodeEngine, PythonEngine, RustEngine } from "../engines/index.js";
import type { Ecosystem, ExecutionResult } from "../types.js";
import { loadWorkspaceConfig, resolveWorkspaceMembers } from "./config.js";
import { verifyCompositeLockfile, writeCompositeLockfile } from "./lockfile.js";

export class WorkspaceDispatcher {
  /**
   * Synchronizes all workspace members concurrently with optional frozen enforcement.
   */
  async syncWorkspace(
    workspaceDir: string,
    options?: { frozen?: boolean; silent?: boolean },
  ): Promise<ExecutionResult[]> {
    // 1. Enforce frozen CI/CD mode
    if (options?.frozen) {
      const drift = verifyCompositeLockfile(workspaceDir);
      if (drift.isDrifted) {
        const details = drift.issues
          .map((i) => `  - [${i.memberPath}] ${i.file}: ${i.reason}`)
          .join("\n");
        throw new Error(
          `[FROZEN DRIFT ERROR] Workspace dependency drift detected!\n${details}\n\nRemediation: Run 'poly sync' locally to regenerate poly.lock and commit changes.`,
        );
      }
    }

    // 2. Discover members
    const members = resolveWorkspaceMembers(workspaceDir);
    if (members.length === 0) {
      throw new Error(`No polyglot workspace members found in '${workspaceDir}'.`);
    }

    const config = loadWorkspaceConfig(workspaceDir);
    const concurrency = config?.engines?.concurrency ?? 4;

    // 3. Parallel bounded execution pool
    const results: ExecutionResult[] = [];
    const queue = [...members];
    const activeWorkers = new Set<Promise<void>>();

    while (queue.length > 0 || activeWorkers.size > 0) {
      while (queue.length > 0 && activeWorkers.size < concurrency) {
        const member = queue.shift();
        if (!member) break;
        const workerPromise = (async () => {
          const engine = this.getEngine(member.context.ecosystem, member.context.lockfile);
          const { command, args } = engine.resolveInstallArgs();

          const res = await engine.execute(command, args, member.absoluteDir, {
            silent: options?.silent,
          });
          results.push(res);
        })();

        activeWorkers.add(workerPromise);
        workerPromise.finally(() => {
          activeWorkers.delete(workerPromise);
        });
      }

      if (activeWorkers.size > 0) {
        await Promise.race(activeWorkers);
      }
    }

    // 4. Update poly.lock if not frozen
    if (!options?.frozen) {
      writeCompositeLockfile(workspaceDir);
    }

    return results;
  }

  private getEngine(ecosystem: Ecosystem, lockfile?: string) {
    switch (ecosystem) {
      case "npm":
        return new NodeEngine(lockfile);
      case "pypi":
        return new PythonEngine(lockfile);
      case "cargo":
        return new RustEngine();
      case "go":
        return new GoEngine();
    }
  }
}
