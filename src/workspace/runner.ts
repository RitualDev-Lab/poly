import { spawn } from "node:child_process";
import path from "node:path";
import { loadWorkspaceConfig, resolveWorkspaceMembers } from "./config.js";

const COLORS = [
  "\x1b[36m", // Cyan
  "\x1b[35m", // Magenta
  "\x1b[33m", // Yellow
  "\x1b[32m", // Green
  "\x1b[34m", // Blue
];

export interface TaskRunResult {
  member: string;
  command: string;
  exitCode: number;
}

export class WorkspaceRunner {
  /**
   * Runs an orchestrated script or command across workspace members.
   */
  async runTask(
    workspaceDir: string,
    taskName: string,
    options?: { filter?: string; silent?: boolean },
  ): Promise<TaskRunResult[]> {
    const config = loadWorkspaceConfig(workspaceDir);
    const members = resolveWorkspaceMembers(workspaceDir);

    // 1. Check for configured task in poly.toml
    const taskDef = config?.tasks?.[taskName];
    if (taskDef && typeof taskDef === "object" && taskDef.parallel) {
      const promises: Promise<TaskRunResult>[] = [];
      taskDef.parallel.forEach((target, idx) => {
        // format: "apps/web:dev" or "apps/web"
        const [memberRel, subCmd] = target.split(":");
        const member = members.find((m) => m.relativeDir === memberRel);
        if (member) {
          if (options?.filter && !member.relativeDir.includes(options.filter)) {
            return;
          }
          const color = COLORS[idx % COLORS.length];
          promises.push(
            this.executeStreaming(
              member.absoluteDir,
              member.relativeDir,
              subCmd ?? taskName,
              member.context.ecosystem,
              color,
            ),
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
      throw new Error(`No workspace members matched filter '${options?.filter ?? ""}'.`);
    }

    const promises = matchingMembers.map((m, idx) => {
      const color = COLORS[idx % COLORS.length];
      return this.executeStreaming(
        m.absoluteDir,
        m.relativeDir,
        taskName,
        m.context.ecosystem,
        color,
      );
    });

    return Promise.all(promises);
  }

  private executeStreaming(
    cwd: string,
    label: string,
    scriptName: string,
    ecosystem: string,
    color: string,
  ): Promise<TaskRunResult> {
    const [cmd, args] = this.resolveScriptCommand(ecosystem, scriptName);

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const prefix = `${color}[${label}]\x1b[0m `;

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
    });
  }

  private resolveScriptCommand(ecosystem: string, script: string): [string, string[]] {
    switch (ecosystem) {
      case "npm":
        return ["npm", ["run", script]];
      case "pypi":
        return ["python", ["-m", script]];
      case "cargo":
        return ["cargo", [script]];
      case "go":
        return ["go", ["run", `.${path.sep}...`]];
      default:
        return [script, []];
    }
  }
}
