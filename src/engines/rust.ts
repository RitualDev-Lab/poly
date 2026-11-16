import type { PackageSpec } from "../types.js";
import { BaseEngine } from "./base.js";

export class RustEngine extends BaseEngine {
  readonly name = "rust";
  readonly ecosystem = "cargo";

  resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const args = ["add"];
    const target = pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;
    args.push(target);

    if (pkg.isDev) {
      args.push("--dev");
    }

    if (pkg.features && pkg.features.length > 0) {
      args.push("--features", pkg.features.join(","));
    }

    return { command: "cargo", args };
  }

  resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] } {
    return { command: "cargo", args: ["remove", pkg.name] };
  }

  resolveInstallArgs(): { command: string; args: string[] } {
    return { command: "cargo", args: ["fetch"] };
  }
}
