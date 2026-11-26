import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { engineRegistry } from "../engines/registry.js";
import { type AffectedResult, resolveAffectedMembers } from "./affected.js";
import { type ResolvedMember, loadWorkspaceConfig, resolveWorkspaceMembers } from "./config.js";

export const DEV_COLORS = [
  "\x1b[1;36m", // Bright Cyan
  "\x1b[1;35m", // Bright Magenta
  "\x1b[1;33m", // Bright Yellow
  "\x1b[1;32m", // Bright Green
  "\x1b[1;34m", // Bright Blue
  "\x1b[1;38;5;208m", // Vibrant Orange
  "\x1b[1;38;5;213m", // Vibrant Pink
  "\x1b[1;38;5;153m", // Soft Sky Blue
];

export interface TaskRunResult {
  member: string;
  command: string;
  exitCode: number;
}

export interface ActiveDevProcess {
  label: string;
  command: string;
  pid?: number;
  child: ChildProcess;
}

export interface DevServiceTarget {
  label: string;
  cwd: string;
  command: string;
  args: string[];
  ecosystem: string;
}

export interface TaskRunOptions {
  filter?: string;
  silent?: boolean;
  affected?: boolean;
  base?: string;
  changedFiles?: string[];
}

export interface DevTargetOptions {
  filter?: string;
  affected?: boolean;
  base?: string;
  changedFiles?: string[];
}

export interface DevMatrixOptions extends DevTargetOptions {
  session?: DevMatrixSession;
  attachSignalHandler?: boolean;
}

/**
 * Gracefully terminates a process tree across Windows (taskkill) and POSIX (SIGTERM).
 */
export function terminateProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", pid.toString(), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Process already exited
        }
      }
      resolve();
    }
  });
}

/**
 * Finds a matching workspace member using flexible lookup (exact, basename, suffix, package name).
 */
export function findMatchingMember(
  members: ResolvedMember[],
  targetService: string,
): ResolvedMember | undefined {
  // 1. Exact relativeDir match (e.g. "apps/web")
  let match = members.find((m) => m.relativeDir === targetService);
  if (match) return match;

  // 2. Basename match (e.g. "web" matches "apps/web" or "packages/web")
  match = members.find((m) => path.basename(m.relativeDir) === targetService);
  if (match) return match;

  // 3. Suffix match (e.g. ends with "/web" or "\web")
  match = members.find(
    (m) =>
      m.relativeDir.endsWith(`/${targetService}`) || m.relativeDir.endsWith(`\\${targetService}`),
  );
  if (match) return match;

  // 4. Manifest package name match (e.g. package.json "name": "web")
  for (const m of members) {
    const manifestPath = path.join(m.absoluteDir, m.context.manifestFile);
    if (fs.existsSync(manifestPath)) {
      try {
        if (manifestPath.endsWith(".json")) {
          const json = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          if (json.name === targetService) return m;
        }
      } catch {
        // Ignore
      }
    }
  }

  return undefined;
}

/**
 * Manages active processes in a running dev matrix session and handles graceful shutdown.
 */
export class DevMatrixSession {
  private activeProcesses: ActiveDevProcess[] = [];
  private isTerminated = false;
  private signalRegistered = false;

  registerProcess(proc: ActiveDevProcess) {
    this.activeProcesses.push(proc);
  }

  getActiveProcesses(): ActiveDevProcess[] {
    return [...this.activeProcesses];
  }

  setupGracefulShutdown(onShutdownComplete?: () => void) {
    if (this.signalRegistered) return;
    this.signalRegistered = true;

    const handler = async () => {
      if (this.isTerminated) return;
      this.isTerminated = true;
      console.log(
        "\n\x1b[1;33m⚡ [poly] Shutting down dev matrix... Terminating all services gracefully.\x1b[0m",
      );

      await this.terminateAll();
      console.log("\x1b[32m✔ All services stopped cleanly.\x1b[0m\n");
      if (onShutdownComplete) {
        onShutdownComplete();
      } else {
        process.exit(0);
      }
    };

    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  }

  async terminateAll(): Promise<void> {
    const kills = this.activeProcesses.map(async (p) => {
      if (p.pid) {
        await terminateProcessTree(p.pid);
      }
    });
    await Promise.all(kills);
    this.activeProcesses = [];
  }
}

export class WorkspaceRunner {
  /**
   * Resolves service targets for cross-service parallel execution.
   */
  resolveDevTargets(workspaceDir: string, options?: DevTargetOptions): DevServiceTarget[] {
    const config = loadWorkspaceConfig(workspaceDir);
    let members = resolveWorkspaceMembers(workspaceDir);
    const targets: DevServiceTarget[] = [];

    if (options?.affected) {
      const affectedInfo = resolveAffectedMembers(workspaceDir, {
        baseRef: options.base,
        changedFiles: options.changedFiles,
        filter: options.filter,
      });
      members = affectedInfo.affectedMembers;
    }

    // 1. Check for configured dev task/script in poly.toml ([scripts.dev] or [tasks.dev])
    const devDef = config?.scripts?.dev || config?.tasks?.dev;

    if (devDef && typeof devDef === "object" && devDef.parallel) {
      for (const target of devDef.parallel) {
        const [targetService, targetScript] = target.split(":");
        const member = findMatchingMember(members, targetService);
        const scriptName = targetScript || "dev";

        if (member) {
          if (options?.filter && !member.relativeDir.includes(options.filter)) {
            continue;
          }
          const [cmd, args] = this.resolveScriptCommand(member.context.ecosystem, scriptName);
          targets.push({
            label: targetService,
            cwd: member.absoluteDir,
            command: cmd,
            args,
            ecosystem: member.context.ecosystem,
          });
        }
      }
      return targets;
    }

    // 2. Fallback: Auto-detect runnable dev services across all members
    const filter = options?.filter;
    const matchingMembers = filter
      ? members.filter((m) => m.relativeDir.includes(filter))
      : members;

    for (const m of matchingMembers) {
      const label = path.basename(m.relativeDir);
      const [cmd, args] = this.resolveScriptCommand(m.context.ecosystem, "dev");
      targets.push({
        label,
        cwd: m.absoluteDir,
        command: cmd,
        args,
        ecosystem: m.context.ecosystem,
      });
    }

    return targets;
  }

  /**
   * Runs the Cross-Service Dev Matrix in parallel with streaming colored prefixes and graceful SIGINT cleanup.
   */
  async runDevMatrix(workspaceDir: string, options?: DevMatrixOptions): Promise<TaskRunResult[]> {
    const targets = this.resolveDevTargets(workspaceDir, options);

    if (targets.length === 0) {
      if (options?.affected) {
        console.log(
          "\x1b[1;33m⚡ [poly]\x1b[0m Affected execution: 0 workspace members impacted by git changes.",
        );
        return [];
      }
      throw new Error("No runnable services found in workspace for dev matrix.");
    }

    const session = options?.session || new DevMatrixSession();
    if (options?.attachSignalHandler !== false) {
      session.setupGracefulShutdown();
    }

    // Render Matrix Banner
    const maxLabelLen = Math.max(...targets.map((t) => t.label.length), 6);
    console.log(
      "\n\x1b[1;36m╭────────────────────────────────────────────────────────────╮\x1b[0m",
    );
    console.log("\x1b[1;36m│  ⚡ Poly Cross-Service Dev Matrix                           │\x1b[0m");
    console.log("\x1b[1;36m├────────────────────────────────────────────────────────────┤\x1b[0m");
    targets.forEach((t, idx) => {
      const color = DEV_COLORS[idx % DEV_COLORS.length];
      const padded = t.label.padEnd(maxLabelLen);
      console.log(
        `\x1b[1;36m│\x1b[0m  ${color}▶ [${padded}]\x1b[0m \x1b[90m(${t.ecosystem})\x1b[0m $ ${t.command} ${t.args.join(" ")}`,
      );
    });
    console.log(
      "\x1b[1;36m╰────────────────────────────────────────────────────────────╯\x1b[0m\n",
    );

    const promises = targets.map((target, idx) => {
      const color = DEV_COLORS[idx % DEV_COLORS.length];
      return this.executeStreaming(
        target.cwd,
        target.label,
        target.command,
        target.args,
        color,
        maxLabelLen,
        session,
      );
    });

    return Promise.all(promises);
  }

  /**
   * Runs an orchestrated script or command across workspace members.
   */
  async runTask(
    workspaceDir: string,
    taskName: string,
    options?: TaskRunOptions,
  ): Promise<TaskRunResult[]> {
    const config = loadWorkspaceConfig(workspaceDir);
    let members = resolveWorkspaceMembers(workspaceDir);
    let affectedInfo: AffectedResult | undefined;

    if (options?.affected) {
      affectedInfo = resolveAffectedMembers(workspaceDir, {
        baseRef: options.base,
        changedFiles: options.changedFiles,
        filter: options.filter,
      });

      if (affectedInfo.affectedMembers.length === 0) {
        if (!options.silent) {
          console.log(
            "\x1b[1;33m⚡ [poly]\x1b[0m Affected execution: 0 workspace members impacted by git changes. Skipping tasks.",
          );
        }
        return [];
      }

      if (!options.silent) {
        const skippedCount = affectedInfo.allMembers.length - affectedInfo.affectedMembers.length;
        console.log(
          `\x1b[1;36m⚡ [poly]\x1b[0m Affected execution: Running '\x1b[1m${taskName}\x1b[0m' on \x1b[1;32m${affectedInfo.affectedMembers.length}\x1b[0m affected project(s) (${skippedCount} skipped):`,
        );
        for (const m of affectedInfo.affectedMembers) {
          const reasons = affectedInfo.affectedReasons.get(m.relativeDir) || [];
          console.log(
            `  \x1b[32m✔\x1b[0m \x1b[1m${m.relativeDir}\x1b[0m \x1b[90m(${reasons[0] || "Modified"})\x1b[0m`,
          );
        }
        console.log("");
      }

      members = affectedInfo.affectedMembers;
    }

    // 1. Check for configured task in poly.toml ([scripts] or [tasks])
    const taskDef = config?.scripts?.[taskName] || config?.tasks?.[taskName];
    if (taskDef && typeof taskDef === "object" && taskDef.parallel) {
      const promises: Promise<TaskRunResult>[] = [];
      const parallelTargets = taskDef.parallel;
      const maxLabelLen = Math.max(...parallelTargets.map((t) => t.split(":")[0].length), 6);

      parallelTargets.forEach((target, idx) => {
        const [targetService, subCmd] = target.split(":");
        const member = findMatchingMember(members, targetService);
        if (member) {
          if (options?.filter && !member.relativeDir.includes(options.filter)) {
            return;
          }
          const color = DEV_COLORS[idx % DEV_COLORS.length];
          const [cmd, args] = this.resolveScriptCommand(
            member.context.ecosystem,
            subCmd ?? taskName,
          );
          promises.push(
            this.executeStreaming(member.absoluteDir, targetService, cmd, args, color, maxLabelLen),
          );
        }
      });

      return Promise.all(promises);
    }

    // 2. Fallback: Run task on all matching workspace members
    const filter = options?.filter;
    const matchingMembers = filter
      ? members.filter((m) => m.relativeDir.includes(filter))
      : members;

    if (matchingMembers.length === 0) {
      if (options?.affected) return [];
      throw new Error(`No workspace members matched filter '${options?.filter ?? ""}'.`);
    }

    const maxLabelLen = Math.max(...matchingMembers.map((m) => m.relativeDir.length), 6);

    const promises = matchingMembers.map((m, idx) => {
      const color = DEV_COLORS[idx % DEV_COLORS.length];
      const [cmd, args] = this.resolveScriptCommand(m.context.ecosystem, taskName);
      return this.executeStreaming(m.absoluteDir, m.relativeDir, cmd, args, color, maxLabelLen);
    });

    return Promise.all(promises);
  }

  private executeStreaming(
    cwd: string,
    label: string,
    cmd: string,
    args: string[],
    color: string,
    maxLabelLen = 6,
    session?: DevMatrixSession,
  ): Promise<TaskRunResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (session) {
        session.registerProcess({
          label,
          command: `${cmd} ${args.join(" ")}`,
          pid: child.pid,
          child,
        });
      }

      const paddedLabel = label.padEnd(maxLabelLen);
      const prefix = `${color}[${paddedLabel}]\x1b[0m `;

      child.stdout.on("data", (chunk) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            console.log(`${prefix}${line}`);
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            console.error(`${prefix}\x1b[31m${line}\x1b[0m`);
          }
        }
      });

      child.on("close", (code) => {
        resolve({
          member: label,
          command: `${cmd} ${args.join(" ")}`,
          exitCode: code ?? 0,
        });
      });

      child.on("error", (err) => {
        console.error(`${prefix}\x1b[31mFailed to start process: ${err.message}\x1b[0m`);
        resolve({
          member: label,
          command: `${cmd} ${args.join(" ")}`,
          exitCode: 1,
        });
      });
    });
  }

  private resolveScriptCommand(ecosystem: string, script: string): [string, string[]] {
    const adapter = engineRegistry.getAdapter(ecosystem);
    if (adapter?.resolveScriptCommand) {
      return adapter.resolveScriptCommand(script);
    }
    return [script, []];
  }
}
