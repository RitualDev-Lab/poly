import fs from "node:fs";
import path from "node:path";
import type { EngineContext, PackageSpec } from "../types.js";
import { type EngineAdapter, defineDeclarativeAdapter } from "./declarative.js";

function cleanVer(version?: string): string | undefined {
  return version?.replace(/^[~^>=<\s]+/, "").trim() || undefined;
}

function isStackProject(ctx?: EngineContext): boolean {
  if (ctx?.preferredCli === "stack") return true;
  if (ctx?.lockfile === "stack.yaml.lock") return true;
  if (ctx?.cwd && fs.existsSync(path.join(ctx.cwd, "stack.yaml"))) return true;
  return false;
}

/** Haskell — Hackage (Cabal & Stack) */
export const hackageAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "hackage",
  ecosystem: "hackage",
  aliases: ["haskell", "cabal", "stack"],
  purlTypes: ["hackage"],
  manifests: ["*.cabal", "package.yaml"],
  lockfiles: ["cabal.project.freeze", "stack.yaml.lock"],
  osvEcosystem: "Hackage",
  sbomPurlType: "hackage",
  supportedClis: ["cabal", "stack"],
  commands: {
    command: (ctx) => (isStackProject(ctx) ? "stack" : "cabal"),
    add: (pkg, ctx) => {
      const ver = cleanVer(pkg.version);
      if (isStackProject(ctx)) {
        return ["install", ver ? `${pkg.name}-${ver}` : pkg.name];
      }
      const args = ["install", pkg.name, "--lib"];
      if (ver) args.push(`--constraint=${pkg.name} ==${ver}`);
      return args;
    },
    remove: (_pkg, ctx) => (isStackProject(ctx) ? ["clean"] : ["clean"]),
    install: (ctx) =>
      isStackProject(ctx) ? ["build", "--only-dependencies"] : ["build", "--only-dependencies"],
    update: () => ["update"],
  },
  resolveScriptCommand: (script, ctx) => {
    const cli = isStackProject(ctx) ? "stack" : "cabal";
    return script === "test" ? [cli, ["test"]] : [cli, [script]];
  },
});

/** R — CRAN / Pak / renv */
export const cranAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "cran",
  ecosystem: "cran",
  aliases: ["r", "pak", "renv"],
  purlTypes: ["cran"],
  manifests: ["DESCRIPTION", "renv.lock"],
  lockfiles: ["renv.lock"],
  osvEcosystem: "CRAN",
  sbomPurlType: "cran",
  supportedClis: ["Rscript"],
  commands: {
    command: "Rscript",
    add: (pkg) => {
      const ver = cleanVer(pkg.version);
      const spec = ver ? `${pkg.name}@${ver}` : pkg.name;
      return ["-e", `pak::pkg_install('${spec}'); renv::snapshot(prompt = FALSE)`];
    },
    remove: (pkg) => ["-e", `remove.packages('${pkg.name}')`],
    install: () => [
      "-e",
      "if (file.exists('renv.lock')) renv::restore(prompt = FALSE) else pak::local_install_deps()",
    ],
    update: (pkg) => [
      "-e",
      pkg
        ? `pak::pkg_install('${pkg.name}', upgrade = TRUE); renv::snapshot(prompt = FALSE)`
        : "renv::update(prompt = FALSE); renv::snapshot(prompt = FALSE)",
    ],
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["Rscript", ["-e", "testthat::test_local()"]] : ["Rscript", [script]],
  injectRegistryEnv: (endpoint, env) => {
    env.RENV_CONFIG_REPOS_OVERRIDE = endpoint.url;
  },
});

/** Perl — CPAN / cpanm / PPM */
export const cpanAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "cpan",
  ecosystem: "cpan",
  aliases: ["perl", "cpanm", "ppm"],
  purlTypes: ["cpan"],
  manifests: ["cpanfile", "Makefile.PL"],
  lockfiles: ["cpanfile.snapshot"],
  osvEcosystem: undefined,
  sbomPurlType: "cpan",
  supportedClis: ["cpanm", "cpan", "ppm"],
  commands: {
    command: (ctx) => ctx?.preferredCli ?? "cpanm",
    add: (pkg, ctx) => {
      const cli = ctx?.preferredCli ?? "cpanm";
      if (cli === "ppm") return ["install", pkg.name];
      const ver = cleanVer(pkg.version);
      return [ver ? `${pkg.name}@${ver}` : pkg.name];
    },
    remove: (pkg, ctx) => (ctx?.preferredCli === "ppm" ? ["remove", pkg.name] : ["-U", pkg.name]),
    install: (ctx) =>
      ctx?.preferredCli === "cpan" ? [".", "--installdeps"] : ["--installdeps", "."],
    update: (pkg) => (pkg ? [pkg.name] : ["--installdeps", "."]),
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["prove", ["-r", "t"]] : ["perl", [script]],
});

/** Lua — LuaRocks */
export const luarocksAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "luarocks",
  ecosystem: "luarocks",
  aliases: ["lua"],
  purlTypes: ["luarocks"],
  manifests: ["*.rockspec"],
  lockfiles: [],
  osvEcosystem: undefined,
  sbomPurlType: "luarocks",
  supportedClis: ["luarocks"],
  commands: {
    command: "luarocks",
    add: (pkg) => {
      const ver = cleanVer(pkg.version);
      return ["install", pkg.name, ...(ver ? [ver] : [])];
    },
    remove: (pkg) => ["remove", pkg.name],
    install: () => ["install", "--only-deps"],
    update: (pkg) => (pkg ? ["install", pkg.name] : ["install", "--only-deps"]),
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["luarocks", ["test"]] : ["lua", [script]],
  injectRegistryEnv: (endpoint, env) => {
    env.LUAROCKS_SERVER = endpoint.url;
  },
});

export const LONGTAIL_ADAPTERS: readonly EngineAdapter[] = [
  hackageAdapter,
  cranAdapter,
  cpanAdapter,
  luarocksAdapter,
];
