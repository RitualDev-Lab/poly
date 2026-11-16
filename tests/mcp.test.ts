import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateCursorRule, generateMcpConfig, setupIdeIntegration } from "../src/mcp/config.js";
import { handleToolCall } from "../src/mcp/handlers.js";
import { POLY_MCP_RESOURCES, handleResourceRead } from "../src/mcp/resources.js";
import { PolyMcpServer } from "../src/mcp/server.js";
import type { POLY_MCP_TOOLS } from "../src/mcp/tools.js";

test("MCP Protocol - Server Lifecycle & Methods", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-mcp-test-"));
  const server = new PolyMcpServer(tmpDir);

  await t.test("handles initialize request with MCP capabilities", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    assert.equal(res?.id, 1);
    assert.equal(res?.error, undefined);
    const result = res?.result as {
      serverInfo: { name: string; version: string };
      capabilities: { tools: Record<string, unknown>; resources: Record<string, unknown> };
    };
    assert.equal(result.serverInfo.name, "poly-mcp");
    assert.ok(result.capabilities.tools);
    assert.ok(result.capabilities.resources);
  });

  await t.test("handles ping request", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: "test-ping",
      method: "ping",
    });

    assert.equal(res?.id, "test-ping");
    assert.deepEqual(res?.result, {});
  });

  await t.test("ignores notifications without returning a response", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    assert.equal(res, null);
  });

  await t.test("lists all registered MCP tools", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    assert.equal(res?.id, 2);
    const result = res?.result as { tools: typeof POLY_MCP_TOOLS };
    assert.ok(result.tools.length >= 7);
    const toolNames = result.tools.map((t) => t.name);
    assert.ok(toolNames.includes("poly_detect_workspace"));
    assert.ok(toolNames.includes("poly_resolve_package"));
    assert.ok(toolNames.includes("poly_add_dependency"));
    assert.ok(toolNames.includes("poly_remove_dependency"));
    assert.ok(toolNames.includes("poly_sync_workspace"));
    assert.ok(toolNames.includes("poly_audit_security"));
    assert.ok(toolNames.includes("poly_verify_lock"));
    assert.ok(toolNames.includes("poly_fix_vulnerabilities"));
    assert.ok(toolNames.includes("poly_update_dependency"));
  });

  await t.test("returns -32601 error for unknown methods", async () => {
    const res = await server.handleRequest({
      jsonrpc: "2.0",
      id: 99,
      method: "nonExistentMethod",
    });

    assert.equal(res?.id, 99);
    assert.equal(res?.error?.code, -32601);
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("MCP Tool Handlers - Execution & Inspection", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-mcp-tools-"));

  // Create mock polyglot workspace
  fs.writeFileSync(path.join(tmpDir, "poly.toml"), `[workspace]\nmembers = ["apps/*"]\n`);
  const appDir = path.join(tmpDir, "apps", "web");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: "web", version: "1.0.0" }),
  );

  await t.test("poly_detect_workspace discovers members and manifests", async () => {
    const res = await handleToolCall("poly_detect_workspace", { workspaceDir: tmpDir });
    assert.equal(res.isError, undefined);
    assert.equal(res.content.length, 1);

    const data = JSON.parse(res.content[0].text);
    assert.equal(data.membersCount, 1);
    assert.equal(data.members[0].ecosystem, "npm");
    assert.equal(data.members[0].manifestFile, "package.json");
  });

  await t.test("poly_resolve_package resolves shorthand and RFC PURLs", async () => {
    const res = await handleToolCall("poly_resolve_package", {
      package: "npm:zod@3.22.4",
      workspaceDir: tmpDir,
    });
    assert.equal(res.isError, undefined);
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.resolvedSpec.name, "zod");
    assert.equal(data.resolvedSpec.ecosystem, "npm");
    assert.equal(data.resolvedSpec.version, "3.22.4");
  });

  await t.test("poly_verify_lock checks cryptographic lockfile state", async () => {
    const res = await handleToolCall("poly_verify_lock", { workspaceDir: tmpDir });
    assert.equal(res.isError, undefined);
    const data = JSON.parse(res.content[0].text);
    assert.ok(typeof data.isDrifted === "boolean");
  });

  await t.test("returns error for unknown tool call", async () => {
    const res = await handleToolCall("unknown_tool", {});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Unknown tool/);
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("MCP Resources - Workspace Introspection", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-mcp-resources-"));
  fs.writeFileSync(path.join(tmpDir, "poly.toml"), "[workspace]\nmembers = []\n");

  await t.test("lists workspace configuration and lockfile resources", () => {
    assert.equal(POLY_MCP_RESOURCES.length, 2);
    assert.equal(POLY_MCP_RESOURCES[0].uri, "poly://workspace/config");
    assert.equal(POLY_MCP_RESOURCES[1].uri, "poly://workspace/lock");
  });

  await t.test("reads poly.toml via resource URI", () => {
    const content = handleResourceRead("poly://workspace/config", tmpDir);
    assert.equal(content.uri, "poly://workspace/config");
    assert.match(content.text ?? "", /\[workspace\]/);
  });

  await t.test("throws error when resource URI is unknown or file missing", () => {
    assert.throws(() => handleResourceRead("poly://unknown", tmpDir), /Unknown resource URI/);
    assert.throws(
      () => handleResourceRead("poly://workspace/lock", tmpDir),
      /Composite lockfile 'poly.lock' not found/,
    );
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("IDE Extensions & AI Agent Configuration Generator", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-ide-test-"));

  await t.test("generates standard MCP client config snippet", () => {
    const config = generateMcpConfig();
    assert.equal(config.mcpServers.poly.command, "poly");
    assert.deepEqual(config.mcpServers.poly.args, ["mcp"]);
  });

  await t.test("generates Cursor rule with polyglot guidelines", () => {
    const rule = generateCursorRule();
    assert.match(rule, /Universal Polyglot Package Management Rules/);
    assert.match(rule, /poly add npm:<package>/);
    assert.match(rule, /poly add pypi:<package>/);
  });

  await t.test("sets up Cursor and Claude configuration files in project", () => {
    const res = setupIdeIntegration(tmpDir, "all");
    assert.equal(res.createdFiles.length, 3);

    const cursorMcpPath = path.join(tmpDir, ".cursor", "mcp.json");
    const cursorRulePath = path.join(tmpDir, ".cursor", "rules", "poly.mdc");
    const claudePath = path.join(tmpDir, "claude_mcp_config.json");

    assert.ok(fs.existsSync(cursorMcpPath));
    assert.ok(fs.existsSync(cursorRulePath));
    assert.ok(fs.existsSync(claudePath));

    const mcpJson = JSON.parse(fs.readFileSync(cursorMcpPath, "utf-8"));
    assert.equal(mcpJson.mcpServers.poly.command, "poly");
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
