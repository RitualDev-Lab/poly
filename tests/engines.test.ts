import assert from "node:assert/strict";
import test from "node:test";
import { GoEngine } from "../src/engines/go.js";
import { NodeEngine } from "../src/engines/node.js";
import { PythonEngine } from "../src/engines/python.js";
import { RustEngine } from "../src/engines/rust.js";
import type { PackageSpec } from "../src/types.js";

test("Node Engine - Resolves add/remove/install argument syntax", () => {
  const engine = new NodeEngine("pnpm-lock.yaml");
  const cli = engine.getEffectiveCli();

  const pkg: PackageSpec = {
    raw: "zod@^3.22.4",
    name: "zod",
    version: "^3.22.4",
    isDev: true,
  };

  const addArgs = engine.resolveAddArgs(pkg);
  assert.equal(addArgs.command, cli);
  assert.ok(addArgs.args.includes("zod@^3.22.4"));
  assert.ok(addArgs.args.includes("-D") || addArgs.args.includes("--save-dev"));

  const rmArgs = engine.resolveRemoveArgs(pkg);
  assert.equal(rmArgs.command, cli);
  assert.ok(rmArgs.args.includes("zod"));

  const installArgs = engine.resolveInstallArgs();
  assert.equal(installArgs.command, cli);
  assert.ok(installArgs.args.includes("install"));
});

test("Python Engine - Resolves uv or pip add/remove arguments", () => {
  const engine = new PythonEngine("uv.lock");
  const cli = engine.getEffectiveCli();

  const pkg: PackageSpec = {
    raw: "fastapi@>=0.110.0",
    name: "fastapi",
    version: ">=0.110.0",
    isDev: false,
  };

  const addArgs = engine.resolveAddArgs(pkg);
  assert.equal(addArgs.command, cli);
  assert.ok(addArgs.args.some((a) => a.includes("fastapi>=0.110.0")));

  const rmArgs = engine.resolveRemoveArgs(pkg);
  assert.equal(rmArgs.command, cli);
  assert.ok(rmArgs.args.includes("fastapi"));
});

test("Rust Engine - Resolves cargo add/remove with features", () => {
  const engine = new RustEngine();
  const pkg: PackageSpec = {
    raw: "tokio",
    name: "tokio",
    version: "1.38.0",
    features: ["full"],
    isDev: false,
  };

  const addArgs = engine.resolveAddArgs(pkg);
  assert.equal(addArgs.command, "cargo");
  assert.deepEqual(addArgs.args, ["add", "tokio@1.38.0", "--features", "full"]);

  const rmArgs = engine.resolveRemoveArgs(pkg);
  assert.deepEqual(rmArgs.args, ["remove", "tokio"]);

  const installArgs = engine.resolveInstallArgs();
  assert.deepEqual(installArgs.args, ["fetch"]);
});

test("Go Engine - Resolves go get and go mod tidy", () => {
  const engine = new GoEngine();
  const pkg: PackageSpec = {
    raw: "github.com/gin-gonic/gin",
    name: "github.com/gin-gonic/gin",
    version: "v1.9.1",
  };

  const addArgs = engine.resolveAddArgs(pkg);
  assert.equal(addArgs.command, "go");
  assert.deepEqual(addArgs.args, ["get", "github.com/gin-gonic/gin@v1.9.1"]);

  const rmArgs = engine.resolveRemoveArgs(pkg);
  assert.deepEqual(rmArgs.args, ["mod", "tidy"]);
});

test("Node Engine - Resolves Deno & JSR add/remove/install/update syntax", () => {
  const denoEngine = new NodeEngine({
    manifest: "deno.json",
    lockfile: "deno.lock",
    ecosystem: "jsr",
    preferredCli: "deno",
  });
  assert.equal(denoEngine.getEffectiveCli(), "deno");

  const jsrPkg: PackageSpec = {
    raw: "jsr:@std/path@^1.0.0",
    ecosystem: "jsr",
    namespace: "@std",
    name: "path",
    version: "^1.0.0",
  };
  assert.deepEqual(denoEngine.resolveAddArgs(jsrPkg), {
    command: "deno",
    args: ["add", "jsr:@std/path@^1.0.0"],
  });
  assert.deepEqual(denoEngine.resolveRemoveArgs(jsrPkg), {
    command: "deno",
    args: ["remove", "@std/path"],
  });
  assert.deepEqual(denoEngine.resolveInstallArgs(), {
    command: "deno",
    args: ["install"],
  });
  assert.deepEqual(denoEngine.resolveUpdateArgs(jsrPkg), {
    command: "deno",
    args: ["outdated", "--update", "@std/path@^1.0.0"],
  });

  const npmPkgInDeno: PackageSpec = {
    raw: "npm:zod@^3.22.4",
    ecosystem: "npm",
    name: "zod",
    version: "^3.22.4",
  };
  assert.deepEqual(denoEngine.resolveAddArgs(npmPkgInDeno), {
    command: "deno",
    args: ["add", "npm:zod@^3.22.4"],
  });

  const pnpmWithJsr = new NodeEngine({ lockfile: "pnpm-lock.yaml", preferredCli: "pnpm" });
  assert.deepEqual(pnpmWithJsr.resolveAddArgs(jsrPkg), {
    command: "pnpm",
    args: ["dlx", "jsr", "add", "@std/path@^1.0.0"],
  });
});

test("Python Engine - Resolves Pipenv & Conda add/remove/install/update syntax", () => {
  const pipenvEngine = new PythonEngine({ manifest: "Pipfile", lockfile: "Pipfile.lock" });
  assert.equal(pipenvEngine.getEffectiveCli(), "pipenv");

  const reqPkg: PackageSpec = {
    raw: "pypi:requests@>=2.31.0",
    ecosystem: "pypi",
    name: "requests",
    version: ">=2.31.0",
    isDev: true,
  };
  assert.deepEqual(pipenvEngine.resolveAddArgs(reqPkg), {
    command: "pipenv",
    args: ["install", "requests>=2.31.0", "--dev"],
  });
  assert.deepEqual(pipenvEngine.resolveRemoveArgs(reqPkg), {
    command: "pipenv",
    args: ["uninstall", "requests"],
  });
  assert.deepEqual(pipenvEngine.resolveInstallArgs(), {
    command: "pipenv",
    args: ["sync"],
  });

  const condaEngine = new PythonEngine({
    ecosystem: "conda",
    manifest: "environment.yml",
    preferredCli: "conda",
  });
  assert.equal(condaEngine.getEffectiveCli(), "conda");

  const condaPkg: PackageSpec = {
    raw: "conda:numpy@1.26.4",
    ecosystem: "conda",
    name: "numpy",
    version: "1.26.4",
  };
  assert.deepEqual(condaEngine.resolveAddArgs(condaPkg), {
    command: "conda",
    args: ["install", "-y", "numpy=1.26.4"],
  });
  assert.deepEqual(condaEngine.resolveRemoveArgs(condaPkg), {
    command: "conda",
    args: ["remove", "-y", "numpy"],
  });
  assert.deepEqual(condaEngine.resolveInstallArgs(), {
    command: "conda",
    args: ["env", "update", "-f", "environment.yml", "--prune"],
  });
  assert.deepEqual(condaEngine.resolveUpdateArgs(), {
    command: "conda",
    args: ["update", "-y", "--all"],
  });
});
