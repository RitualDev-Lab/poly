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
