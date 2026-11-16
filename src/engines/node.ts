import type { PackageSpec } from "../types.js";
import { BaseEngine } from "./base.js";

export class NodeEngine extends BaseEngine {
  readonly name = "node";
  readonly ecosystem = "npm";
  private activeCli: "pnpm" | "bun" | "yarn" | "npm";

  constructor(preferredLockfile?: string) {
    super();
    this.activeCli = this.detectActiveCli(preferredLockfile);
  }

  private detectActiveCli(lockfile?: string): "pnpm" | "bun" | "yarn" | "npm" {
    if (lockfile === "pnpm-lock.yaml" && this.isCommandAvailable("pnpm")) return "pnpm";
    if ((lockfile === "bun.lockb" || lockfile === "bun.lock") && this.isCommandAvailable("bun"))
      return "bun";
    if (lockfile === "yarn.lock" && this.isCommandAvailable("yarn")) return "yarn";
    if (lockfile === "package-lock.json" && this.isCommandAvailable("npm")) return "npm";

    // Fallback detection priority
    if (this.isCommandAvailable("pnpm")) return "pnpm";
    if (this.isCommandAvailable("bun")) return "bun";
    if (this.isCommandAvailable("yarn")) return "yarn";
    return "npm";
  }

  getEffectiveCli(): string {
    return this.activeCli;
  }

  resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const pkgTarget = this.formatPackageTarget(pkg);
    const args: string[] = [];

    switch (this.activeCli) {
      case "pnpm":
      case "bun":
      case "yarn":
        args.push("add", pkgTarget);
        if (pkg.isDev) args.push("-D");
        break;
      case "npm":
        args.push("install", pkgTarget);
        if (pkg.isDev) args.push("--save-dev");
        break;
    }

    return { command: this.activeCli, args };
  }

  resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const pkgName = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;
    const args: string[] = [];

    switch (this.activeCli) {
      case "pnpm":
      case "bun":
      case "yarn":
        args.push("remove", pkgName);
        break;
      case "npm":
        args.push("uninstall", pkgName);
        break;
    }

    return { command: this.activeCli, args };
  }

  resolveInstallArgs(): { command: string; args: string[] } {
    return { command: this.activeCli, args: ["install"] };
  }

  private formatPackageTarget(pkg: PackageSpec): string {
    const base = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;
    return pkg.version ? `${base}@${pkg.version}` : base;
  }
}
