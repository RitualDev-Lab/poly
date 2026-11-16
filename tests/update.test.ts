import assert from "node:assert/strict";
import test from "node:test";
import { GoEngine, NodeEngine, PythonEngine, RustEngine } from "../src/engines/index.js";
import { parsePackageSpec } from "../src/purl/parser.js";

test("Engine Update Syntax Resolution", async (t) => {
  await t.test("NodeEngine resolves update arguments correctly", () => {
    const engine = new NodeEngine();
    const pkg = parsePackageSpec("npm:zod@3.22.0");

    const singleUpdate = engine.resolveUpdateArgs(pkg);
    assert.ok(singleUpdate.args.includes("update") || singleUpdate.args.includes("upgrade"));
    assert.ok(singleUpdate.args.some((a) => a.includes("zod")));

    const allUpdate = engine.resolveUpdateArgs();
    assert.ok(allUpdate.args.includes("update") || allUpdate.args.includes("upgrade"));
  });

  await t.test("PythonEngine resolves update arguments correctly", () => {
    const engine = new PythonEngine();
    const pkg = parsePackageSpec("pypi:fastapi");

    const singleUpdate = engine.resolveUpdateArgs(pkg);
    assert.ok(
      singleUpdate.args.includes("--upgrade-package") ||
        singleUpdate.args.includes("--upgrade") ||
        singleUpdate.args.includes("update"),
    );

    const allUpdate = engine.resolveUpdateArgs();
    assert.ok(allUpdate.args.includes("--upgrade") || allUpdate.args.includes("update"));
  });

  await t.test("RustEngine resolves cargo update arguments correctly", () => {
    const engine = new RustEngine();
    const pkg = parsePackageSpec("cargo:tokio");

    const singleUpdate = engine.resolveUpdateArgs(pkg);
    assert.deepEqual(singleUpdate, { command: "cargo", args: ["update", "-p", "tokio"] });

    const allUpdate = engine.resolveUpdateArgs();
    assert.deepEqual(allUpdate, { command: "cargo", args: ["update"] });
  });

  await t.test("GoEngine resolves go get -u update arguments correctly", () => {
    const engine = new GoEngine();
    const pkg = parsePackageSpec("go:github.com/gin-gonic/gin");

    const singleUpdate = engine.resolveUpdateArgs(pkg);
    assert.deepEqual(singleUpdate, {
      command: "go",
      args: ["get", "-u", "github.com/gin-gonic/gin"],
    });

    const allUpdate = engine.resolveUpdateArgs();
    assert.deepEqual(allUpdate, { command: "go", args: ["get", "-u", "./..."] });
  });
});
