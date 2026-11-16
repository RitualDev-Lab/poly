import type { PackageSpec } from "../types.js";
import { BaseEngine } from "./base.js";

export class PythonEngine extends BaseEngine {
  readonly name = "python";
  readonly ecosystem = "pypi";
  private activeCli: "uv" | "poetry" | "pip";

  constructor(preferredLockfile?: string) {
    super();
    this.activeCli = this.detectActiveCli(preferredLockfile);
  }

  private detectActiveCli(lockfile?: string): "uv" | "poetry" | "pip" {
    if (lockfile === "uv.lock" && this.isCommandAvailable("uv")) return "uv";
    if (lockfile === "poetry.lock" && this.isCommandAvailable("poetry")) return "poetry";

    // Fallback: prefer high-performance uv if available, else poetry, else pip
    if (this.isCommandAvailable("uv")) return "uv";
    if (this.isCommandAvailable("poetry")) return "poetry";
    return "pip";
  }

  getEffectiveCli(): string {
    return this.activeCli;
  }

  resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const pkgTarget = this.formatPackageTarget(pkg);
    const args: string[] = [];

    switch (this.activeCli) {
      case "uv":
        args.push("add", pkgTarget);
        if (pkg.isDev) args.push("--dev");
        break;
      case "poetry":
        args.push("add", pkgTarget);
        if (pkg.isDev) args.push("--group", "dev");
        break;
      case "pip":
        args.push("install", pkgTarget);
        break;
    }

    return { command: this.activeCli, args };
  }

  resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const args: string[] = [];

    switch (this.activeCli) {
      case "uv":
        args.push("remove", pkg.name);
        break;
      case "poetry":
        args.push("remove", pkg.name);
        break;
      case "pip":
        args.push("uninstall", "-y", pkg.name);
        break;
    }

    return { command: this.activeCli, args };
  }

  resolveInstallArgs(): { command: string; args: string[] } {
    switch (this.activeCli) {
      case "uv":
        return { command: "uv", args: ["sync"] };
      case "poetry":
        return { command: "poetry", args: ["install"] };
      case "pip":
        return { command: "pip", args: ["install", "-r", "requirements.txt"] };
    }
  }

  resolveUpdateArgs(pkg?: PackageSpec): { command: string; args: string[] } {
    switch (this.activeCli) {
      case "uv":
        return {
          command: "uv",
          args: pkg ? ["lock", "--upgrade-package", pkg.name] : ["lock", "--upgrade"],
        };
      case "poetry":
        return {
          command: "poetry",
          args: pkg ? ["update", pkg.name] : ["update"],
        };
      case "pip":
        return {
          command: "pip",
          args: pkg
            ? ["install", "--upgrade", this.formatPackageTarget(pkg)]
            : ["install", "--upgrade", "-r", "requirements.txt"],
        };
    }
  }

  private formatPackageTarget(pkg: PackageSpec): string {
    if (!pkg.version) return pkg.name;
    // Check if version already has an operator like >=, <=, ==
    if (/^[<>=~^]/.test(pkg.version)) {
      return `${pkg.name}${pkg.version}`;
    }
    return `${pkg.name}==${pkg.version}`;
  }
}
