import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  POLY_COMMANDS,
  POLY_FLAGS,
  generateCompletionScript,
  resolveDynamicCompletions,
} from "../src/completion/generator.js";

test("Shell Auto-Completion - Dynamic Resolution", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-completion-test-"));

  await t.test("resolves default tasks and package.json scripts", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: {
          start: "node index.js",
          codegen: "graphql-codegen",
        },
      }),
      "utf-8",
    );

    const tasks = resolveDynamicCompletions("run", tmpDir);
    assert.ok(tasks.includes("build"));
    assert.ok(tasks.includes("dev"));
    assert.ok(tasks.includes("test"));
    assert.ok(tasks.includes("start"));
    assert.ok(tasks.includes("codegen"));
  });

  await t.test("resolves known supported shells", () => {
    const shells = resolveDynamicCompletions("shells");
    assert.deepEqual(shells, ["bash", "zsh", "fish", "powershell"]);
  });

  await t.test("resolves ecosystems for which command", () => {
    const ecosystems = resolveDynamicCompletions("which");
    assert.deepEqual(ecosystems, [
      "npm",
      "jsr",
      "pypi",
      "conda",
      "cargo",
      "go",
      "nuget",
      "composer",
      "gem",
      "pub",
    ]);
  });

  await t.test("resolves all CLI command names", () => {
    const commands = resolveDynamicCompletions("commands");
    assert.ok(commands.includes("add"));
    assert.ok(commands.includes("outdated"));
    assert.ok(commands.includes("upgrade"));
    assert.ok(commands.includes("completion"));
    assert.ok(commands.includes("mcp"));
    assert.ok(commands.includes("doctor"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Shell Auto-Completion - Script Generation", async (t) => {
  await t.test("generates bash completion script", () => {
    const script = generateCompletionScript("bash");
    assert.ok(script.includes("_poly_completions"));
    assert.ok(script.includes("complete -F _poly_completions poly"));
  });

  await t.test("generates zsh completion script", () => {
    const script = generateCompletionScript("zsh");
    assert.ok(script.includes("#compdef poly"));
    assert.ok(script.includes("_poly"));
  });

  await t.test("generates fish completion script", () => {
    const script = generateCompletionScript("fish");
    assert.ok(script.includes("complete -c poly"));
  });

  await t.test("generates powershell completion script", () => {
    const script = generateCompletionScript("powershell");
    assert.ok(script.includes("Register-ArgumentCompleter -Native -CommandName poly"));
  });
});
