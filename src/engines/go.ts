import type { PackageSpec } from "../types.js";
import { BaseEngine } from "./base.js";

export class GoEngine extends BaseEngine {
  readonly name = "go";
  readonly ecosystem = "go";

  resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const target = pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;
    return { command: "go", args: ["get", target] };
  }

  resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] } {
    // In Go, remove is done by dropping references and running tidy
    return { command: "go", args: ["mod", "tidy"] };
  }

  resolveInstallArgs(): { command: string; args: string[] } {
    return { command: "go", args: ["mod", "download"] };
  }

  resolveUpdateArgs(pkg?: PackageSpec): { command: string; args: string[] } {
    const target = pkg?.name ? pkg.name : "./...";
    return { command: "go", args: ["get", "-u", target] };
  }
}
