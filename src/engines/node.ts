import type { EngineContext, PackageSpec } from "../types.js";
import { BaseEngine } from "./base.js";

export type NodeCli = "pnpm" | "bun" | "yarn" | "npm" | "deno";

const NODE_CLIS = new Set<string>(["pnpm", "bun", "yarn", "npm", "deno"]);

function normalizeContext(preferred?: string | EngineContext): EngineContext {
  if (!preferred) return {};
  if (typeof preferred === "string") return { lockfile: preferred };
  return preferred;
}

export class NodeEngine extends BaseEngine {
  readonly name = "node";
  readonly ecosystem: string;
  private readonly activeCli: NodeCli;

  constructor(preferred?: string | EngineContext) {
    super();
    const ctx = normalizeContext(preferred);
    this.ecosystem = ctx.ecosystem ?? "npm";
    this.activeCli = this.detectActiveCli(ctx);
  }

  private detectActiveCli(ctx: EngineContext): NodeCli {
    if (ctx.preferredCli && NODE_CLIS.has(ctx.preferredCli)) {
      return ctx.preferredCli as NodeCli;
    }

    const { lockfile, manifest, ecosystem } = ctx;
    if (lockfile === "deno.lock" || manifest === "deno.json" || manifest === "deno.jsonc") {
      return "deno";
    }

    if (lockfile === "pnpm-lock.yaml" && this.isCommandAvailable("pnpm")) return "pnpm";
    if ((lockfile === "bun.lockb" || lockfile === "bun.lock") && this.isCommandAvailable("bun")) {
      return "bun";
    }
    if (lockfile === "yarn.lock" && this.isCommandAvailable("yarn")) return "yarn";
    if (lockfile === "package-lock.json" && this.isCommandAvailable("npm")) return "npm";

    if (ecosystem === "jsr") {
      if (this.isCommandAvailable("deno") || !manifest) return "deno";
    }

    if (this.isCommandAvailable("pnpm")) return "pnpm";
    if (this.isCommandAvailable("bun")) return "bun";
    if (this.isCommandAvailable("yarn")) return "yarn";
    return "npm";
  }

  override getEffectiveCli(): string {
    return this.activeCli;
  }

  resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const baseTarget = this.formatBaseTarget(pkg);

    if (this.activeCli === "deno") {
      const scheme = pkg.ecosystem === "jsr" ? "jsr:" : "npm:";
      return { command: "deno", args: ["add", `${scheme}${baseTarget}`] };
    }

    // JSR inside an existing Node.js (package.json) workspace via npx/dlx/bunx jsr add
    if (pkg.ecosystem === "jsr") {
      switch (this.activeCli) {
        case "pnpm":
          return { command: "pnpm", args: ["dlx", "jsr", "add", baseTarget] };
        case "bun":
          return { command: "bun", args: ["x", "jsr", "add", baseTarget] };
        case "yarn":
          return { command: "yarn", args: ["dlx", "jsr", "add", baseTarget] };
        case "npm":
          return { command: "npm", args: ["exec", "--yes", "--", "jsr", "add", baseTarget] };
      }
    }

    const args: string[] = [];
    switch (this.activeCli) {
      case "pnpm":
      case "bun":
      case "yarn":
        args.push("add", baseTarget);
        if (pkg.isDev) args.push("-D");
        break;
      case "npm":
        args.push("install", baseTarget);
        if (pkg.isDev) args.push("--save-dev");
        break;
    }

    return { command: this.activeCli, args };
  }

  resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const pkgName = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;

    switch (this.activeCli) {
      case "deno":
        return { command: "deno", args: ["remove", pkgName] };
      case "pnpm":
      case "bun":
      case "yarn":
        return { command: this.activeCli, args: ["remove", pkgName] };
      case "npm":
        return { command: "npm", args: ["uninstall", pkgName] };
    }
  }

  resolveInstallArgs(): { command: string; args: string[] } {
    return { command: this.activeCli, args: ["install"] };
  }

  resolveUpdateArgs(pkg?: PackageSpec): { command: string; args: string[] } {
    const baseTarget = pkg ? this.formatBaseTarget(pkg) : undefined;

    switch (this.activeCli) {
      case "deno": {
        const args = ["outdated", "--update"];
        if (baseTarget) args.push(baseTarget);
        return { command: "deno", args };
      }
      case "yarn": {
        const args = ["upgrade"];
        if (baseTarget) args.push(baseTarget);
        return { command: "yarn", args };
      }
      case "pnpm":
      case "bun":
      case "npm": {
        const args = ["update"];
        if (baseTarget) args.push(baseTarget);
        return { command: this.activeCli, args };
      }
    }
  }

  private formatBaseTarget(pkg: PackageSpec): string {
    const base = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;
    return pkg.version ? `${base}@${pkg.version}` : base;
  }
}
