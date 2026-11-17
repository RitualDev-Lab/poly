import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteCloudAdapter } from "../src/cache/remote.js";
import {
  PolyCloudClient,
  deleteUserConfig,
  formatBytes,
  formatDuration,
  getCurrentGitBranch,
  handleCachePurge,
  handleCacheStatus,
  handleLogin,
  handleLogout,
  handleWhoami,
  loadUserConfig,
  renderProgressBar,
  resolveCloudConfig,
  saveUserConfig,
} from "../src/cloud/index.js";

test("Poly Cloud Config & Credentials Storage", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-cloud-cfg-"));
  const customConfigPath = path.join(tmpDir, "config.json");

  await t.test("saves, loads, and deletes user cloud config", () => {
    assert.equal(loadUserConfig(customConfigPath), null);

    saveUserConfig(
      {
        apiUrl: "https://cache.ritualdev.in/",
        token: "poly_tok_secret_123",
        workspace: "mobile-team",
        user: { name: "ci-bot", role: "write" },
      },
      customConfigPath,
    );

    const loaded = loadUserConfig(customConfigPath);
    assert.ok(loaded);
    assert.equal(loaded?.apiUrl, "https://cache.ritualdev.in");
    assert.equal(loaded?.token, "poly_tok_secret_123");
    assert.equal(loaded?.workspace, "mobile-team");
    assert.equal(loaded?.user?.role, "write");
    assert.ok(loaded?.updatedAt);

    const deleted = deleteUserConfig(customConfigPath);
    assert.equal(deleted, true);
    assert.equal(loadUserConfig(customConfigPath), null);
  });

  await t.test("resolveCloudConfig follows precedence: CLI > ENV > File", () => {
    saveUserConfig(
      {
        apiUrl: "http://file-server:8080",
        token: "file-token",
        workspace: "file-ws",
      },
      customConfigPath,
    );

    // 1. From file when no env or cli
    const fromFile = resolveCloudConfig(undefined, customConfigPath);
    assert.equal(fromFile?.apiUrl, "http://file-server:8080");
    assert.equal(fromFile?.token, "file-token");
    assert.equal(fromFile?.workspace, "file-ws");

    // 2. Environment variables override file
    process.env.POLY_CACHE_URL = "http://env-server:8080";
    process.env.POLY_CACHE_TOKEN = "env-token";
    process.env.POLY_CACHE_WORKSPACE = "env-ws";

    const fromEnv = resolveCloudConfig(undefined, customConfigPath);
    assert.equal(fromEnv?.apiUrl, "http://env-server:8080");
    assert.equal(fromEnv?.token, "env-token");
    assert.equal(fromEnv?.workspace, "env-ws");

    // 3. Explicit CLI options override environment
    const fromCli = resolveCloudConfig(
      {
        apiUrl: "http://cli-server:9000",
        token: "cli-token",
        workspace: "cli-ws",
      },
      customConfigPath,
    );
    assert.equal(fromCli?.apiUrl, "http://cli-server:9000");
    assert.equal(fromCli?.token, "cli-token");
    assert.equal(fromCli?.workspace, "cli-ws");

    // Cleanup env
    // biome-ignore lint/performance/noDelete: process.env requires delete in Node.js
    delete process.env.POLY_CACHE_URL;
    // biome-ignore lint/performance/noDelete: process.env requires delete in Node.js
    delete process.env.POLY_CACHE_TOKEN;
    // biome-ignore lint/performance/noDelete: process.env requires delete in Node.js
    delete process.env.POLY_CACHE_WORKSPACE;
    deleteUserConfig(customConfigPath);
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Git Branch Detection & CLI Formatters", async (t) => {
  await t.test("getCurrentGitBranch resolves branch with env precedence", () => {
    process.env.POLY_CACHE_BRANCH = "feat/custom-cache-branch";
    assert.equal(getCurrentGitBranch(), "feat/custom-cache-branch");
    // biome-ignore lint/performance/noDelete: process.env requires delete in Node.js
    delete process.env.POLY_CACHE_BRANCH;

    process.env.GITHUB_REF_NAME = "main-ci";
    assert.equal(getCurrentGitBranch(), "main-ci");
    // biome-ignore lint/performance/noDelete: process.env requires delete in Node.js
    delete process.env.GITHUB_REF_NAME;

    const branch = getCurrentGitBranch();
    assert.ok(typeof branch === "string" && branch.length > 0);
  });

  await t.test("formatBytes, formatDuration, renderProgressBar", () => {
    assert.equal(formatBytes(500), "500 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(5242880), "5.00 MB");

    assert.equal(formatDuration(45), "45s");
    assert.equal(formatDuration(125), "2m 5s");
    assert.equal(formatDuration(3665), "1h 1m 5s");

    assert.equal(renderProgressBar(50, 10), "[█████░░░░░]");
    assert.equal(renderProgressBar(100, 10), "[██████████]");
    assert.equal(renderProgressBar(0, 10), "[░░░░░░░░░░]");
  });
});

test("PolyCloudClient & CLI Commands with Simulated Poly Cloud Server", async (t) => {
  let serverPort = 0;
  const uploadedArtifacts = new Map<string, Buffer>();

  // Spin up an in-process mock poly-cloud-api server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${serverPort}`);

    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          version: "0.1.0",
          storageBackend: "s3",
          uptimeSeconds: 120,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname.includes("/stats")) {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer valid_token")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          stats: {
            workspaceSlug: "test-workspace",
            totalArtifacts: 12,
            totalSizeBytes: 104857600, // 100MB
            quotaBytes: 107374182400, // 100GB
            quotaUsedPercent: 0.1,
            hitRatePercent: 88.5,
            totalHits: 885,
            totalMisses: 115,
            totalDurationSavedSeconds: 14200,
            estimatedSavingsUsd: 31.55,
            deduplicationSavingsBytes: 20971520, // 20MB
            deduplicationRatio: 1.25,
          },
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname.endsWith("/purge")) {
      let bodyStr = "";
      req.on("data", (chunk) => {
        bodyStr += chunk;
      });
      req.on("end", () => {
        const parsed = bodyStr ? JSON.parse(bodyStr) : {};
        uploadedArtifacts.clear();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "purged",
            workspace: "test-workspace",
            branch: parsed.branch || "all",
            deletedCount: 4,
            freedBytes: 41943040,
            deletedHashes: ["h1", "h2", "h3", "h4"],
          }),
        );
      });
      return;
    }

    if (url.pathname.startsWith("/v8/artifacts/")) {
      const hash = url.pathname.replace("/v8/artifacts/", "");
      if (req.method === "HEAD") {
        if (uploadedArtifacts.has(hash)) {
          res.writeHead(200);
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
        return;
      }
      if (req.method === "GET") {
        const data = uploadedArtifacts.get(hash);
        if (data) {
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(data);
        } else {
          res.writeHead(404);
          res.end();
        }
        return;
      }
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          uploadedArtifacts.set(hash, Buffer.concat(chunks));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "stored", hash }));
        });
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as import("node:net").AddressInfo;
      serverPort = addr.port;
      resolve();
    });
  });

  const apiUrl = `http://127.0.0.1:${serverPort}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-cmd-test-"));
  const configPath = path.join(tmpDir, "config.json");

  await t.test("handleLogin validates and saves configuration", async () => {
    // Bad token fails
    const badLogin = await handleLogin({
      url: apiUrl,
      token: "invalid_token",
      workspace: "test-workspace",
      customConfigPath: configPath,
      interactive: false,
    });
    assert.equal(badLogin, false);
    assert.equal(loadUserConfig(configPath), null);

    // Valid token succeeds
    const goodLogin = await handleLogin({
      url: apiUrl,
      token: "valid_token_abc123",
      workspace: "test-workspace",
      customConfigPath: configPath,
      interactive: false,
    });
    assert.equal(goodLogin, true);

    const saved = loadUserConfig(configPath);
    assert.ok(saved);
    assert.equal(saved?.apiUrl, apiUrl);
    assert.equal(saved?.workspace, "test-workspace");
  });

  await t.test("handleWhoami reports active session", () => {
    const session = handleWhoami({ customConfigPath: configPath, json: true });
    assert.ok(session);
    assert.equal(session?.apiUrl, apiUrl);
    assert.equal(session?.workspace, "test-workspace");
  });

  await t.test("handleCacheStatus queries live cluster latency and stats", async () => {
    const report = await handleCacheStatus({
      customConfigPath: configPath,
      json: true,
    });

    assert.ok(report);
    assert.equal(report?.healthy, true);
    assert.ok(typeof report?.latencyMs === "number");
    assert.equal(report?.stats?.hitRatePercent, 88.5);
    assert.equal(report?.stats?.estimatedSavingsUsd, 31.55);
    assert.equal(report?.stats?.deduplicationRatio, 1.25);
  });

  await t.test("RemoteCloudAdapter saves and restores artifacts over HTTP", async () => {
    const adapter = new RemoteCloudAdapter({
      apiUrl,
      token: "valid_token_abc123",
      workspace: "test-workspace",
    });

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-remote-ws-"));
    const nodeModules = path.join(workspaceDir, "node_modules", "fast-json");
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, "index.js"), "module.exports = {};");

    const key = "remote-cache-key-1";

    // Save
    const saveRes = await adapter.save(key, [path.join(workspaceDir, "node_modules")], {
      tag: "feature/test-branch",
    });
    assert.equal(saveRes.hit, true);
    assert.equal(saveRes.storageBackend, "remote");
    assert.ok(saveRes.sizeBytes && saveRes.sizeBytes > 0);

    // Verify key existence
    assert.equal(await adapter.hasKey(key), true);

    // Wipe local directory
    fs.rmSync(path.join(workspaceDir, "node_modules"), { recursive: true, force: true });
    assert.equal(fs.existsSync(nodeModules), false);

    // Restore
    const restoreRes = await adapter.restore(key, workspaceDir);
    assert.equal(restoreRes.hit, true);
    assert.equal(fs.existsSync(path.join(nodeModules, "index.js")), true);
    assert.equal(
      fs.readFileSync(path.join(nodeModules, "index.js"), "utf8"),
      "module.exports = {};",
    );

    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  await t.test("handleCachePurge invalidates remote cache for current branch", async () => {
    const ok = await handleCachePurge({
      branch: "feature/test-branch",
      customConfigPath: configPath,
    });
    assert.equal(ok, true);
  });

  await t.test("handleLogout clears configuration", () => {
    const loggedOut = handleLogout({ customConfigPath: configPath });
    assert.equal(loggedOut, true);
    assert.equal(loadUserConfig(configPath), null);
  });

  // Teardown mock server & files
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
