import type { EngineContext, PackageSpec } from "../types.js";
import { BaseEngine } from "./base.js";

export type PythonCli = "uv" | "poetry" | "pipenv" | "mamba" | "micromamba" | "conda" | "pip";

const PYTHON_CLIS = new Set<string>([
  "uv",
  "poetry",
  "pipenv",
  "mamba",
  "micromamba",
  "conda",
  "pip",
]);

function normalizeContext(preferred?: string | EngineContext): EngineContext {
  if (!preferred) return {};
  if (typeof preferred === "string") return { lockfile: preferred };
  return preferred;
}

export class PythonEngine extends BaseEngine {
  readonly name = "python";
  readonly ecosystem: string;
  private readonly ctx: EngineContext;
  private readonly activeCli: PythonCli;

  constructor(preferred?: string | EngineContext) {
    super();
    this.ctx = normalizeContext(preferred);
    this.ecosystem = this.ctx.ecosystem ?? "pypi";
    this.activeCli = this.detectActiveCli(this.ctx);
  }

  private isCondaManager(cli: PythonCli): cli is "conda" | "mamba" | "micromamba" {
    return cli === "conda" || cli === "mamba" || cli === "micromamba";
  }

  private detectActiveCli(ctx: EngineContext): PythonCli {
    if (ctx.preferredCli && PYTHON_CLIS.has(ctx.preferredCli)) {
      return ctx.preferredCli as PythonCli;
    }

    const { lockfile, manifest, ecosystem } = ctx;

    if (
      ecosystem === "conda" ||
      lockfile === "conda-lock.yml" ||
      manifest === "environment.yml" ||
      manifest === "environment.yaml"
    ) {
      if (this.isCommandAvailable("mamba")) return "mamba";
      if (this.isCommandAvailable("micromamba")) return "micromamba";
      return "conda";
    }

    if (lockfile === "Pipfile.lock" || manifest === "Pipfile") {
      return "pipenv";
    }

    if (lockfile === "uv.lock" && this.isCommandAvailable("uv")) return "uv";
    if (lockfile === "poetry.lock" && this.isCommandAvailable("poetry")) return "poetry";

    if (this.isCommandAvailable("uv")) return "uv";
    if (this.isCommandAvailable("poetry")) return "poetry";
    if (this.isCommandAvailable("pipenv")) return "pipenv";
    return "pip";
  }

  override getEffectiveCli(): string {
    return this.activeCli;
  }

  resolveAddArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const cli = this.activeCli;
    if (this.isCondaManager(cli)) {
      return {
        command: cli,
        args: ["install", "-y", this.formatPackageTarget(pkg, "=")],
      };
    }

    const pkgTarget = this.formatPackageTarget(pkg, "==");
    switch (cli) {
      case "uv": {
        const args = ["add", pkgTarget];
        if (pkg.isDev) args.push("--dev");
        return { command: "uv", args };
      }
      case "poetry": {
        const args = ["add", pkgTarget];
        if (pkg.isDev) args.push("--group", "dev");
        return { command: "poetry", args };
      }
      case "pipenv": {
        const args = ["install", pkgTarget];
        if (pkg.isDev) args.push("--dev");
        return { command: "pipenv", args };
      }
      case "pip":
        return { command: "pip", args: ["install", pkgTarget] };
    }
  }

  resolveRemoveArgs(pkg: PackageSpec): { command: string; args: string[] } {
    const cli = this.activeCli;
    if (this.isCondaManager(cli)) {
      return { command: cli, args: ["remove", "-y", pkg.name] };
    }

    switch (cli) {
      case "uv":
        return { command: "uv", args: ["remove", pkg.name] };
      case "poetry":
        return { command: "poetry", args: ["remove", pkg.name] };
      case "pipenv":
        return { command: "pipenv", args: ["uninstall", pkg.name] };
      case "pip":
        return { command: "pip", args: ["uninstall", "-y", pkg.name] };
    }
  }

  resolveInstallArgs(): { command: string; args: string[] } {
    const cli = this.activeCli;
    if (this.isCondaManager(cli)) {
      const envFile = this.ctx.manifest || "environment.yml";
      return { command: cli, args: ["env", "update", "-f", envFile, "--prune"] };
    }

    switch (cli) {
      case "uv":
        return { command: "uv", args: ["sync"] };
      case "poetry":
        return { command: "poetry", args: ["install"] };
      case "pipenv":
        return {
          command: "pipenv",
          args: [this.ctx.lockfile === "Pipfile.lock" ? "sync" : "install"],
        };
      case "pip":
        return { command: "pip", args: ["install", "-r", "requirements.txt"] };
    }
  }

  resolveUpdateArgs(pkg?: PackageSpec): { command: string; args: string[] } {
    const cli = this.activeCli;
    if (this.isCondaManager(cli)) {
      const args = ["update", "-y"];
      if (pkg) args.push(this.formatPackageTarget(pkg, "="));
      else args.push("--all");
      return { command: cli, args };
    }

    switch (cli) {
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
      case "pipenv":
        return {
          command: "pipenv",
          args: pkg ? ["update", pkg.name] : ["update"],
        };
      case "pip":
        return {
          command: "pip",
          args: pkg
            ? ["install", "--upgrade", this.formatPackageTarget(pkg, "==")]
            : ["install", "--upgrade", "-r", "requirements.txt"],
        };
    }
  }

  private formatPackageTarget(pkg: PackageSpec, eqOp: "==" | "="): string {
    if (!pkg.version) return pkg.name;
    if (/^[<>=~^!]/.test(pkg.version)) {
      return `${pkg.name}${pkg.version}`;
    }
    return `${pkg.name}${eqOp}${pkg.version}`;
  }
}
