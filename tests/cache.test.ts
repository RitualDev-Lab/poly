import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalDiskAdapter } from "../src/cache/adapter.js";
import { computeCacheKey } from "../src/cache/key.js";
import { PolyCacheManager } from "../src/cache/manager.js";

test("Cache Key Generation", async (t) => {
  await t.test("computes deterministic cache key including platform and arch", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-cache-key-"));
    const key1 = computeCacheKey(tmpDir);
    const key2 = computeCacheKey(tmpDir);

    assert.equal(key1, key2);
    assert.match(key1, new RegExp(`^poly-cache-v1-${process.platform}-${process.arch}-`));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("changes cache key when poly.lock content changes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-cache-key-diff-"));
    const polyLockPath = path.join(tmpDir, "poly.lock");

    fs.writeFileSync(polyLockPath, "version = 1\n");
    const key1 = computeCacheKey(tmpDir);

    fs.writeFileSync(polyLockPath, "version = 2\n");
    const key2 = computeCacheKey(tmpDir);

    assert.notEqual(key1, key2);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

test("LocalDiskAdapter & CacheManager Save / Restore", async (t) => {
  await t.test("saves and restores directories with full file integrity", async () => {
    const cacheStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-adapter-cache-"));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-adapter-ws-"));

    const adapter = new LocalDiskAdapter(cacheStorageDir);
    const manager = new PolyCacheManager(adapter);

    // Create mock node_modules and .venv
    const nodeModules = path.join(workspaceDir, "node_modules", "mypkg");
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, "index.js"), "console.log('test');");

    const venv = path.join(workspaceDir, ".venv", "lib");
    fs.mkdirSync(venv, { recursive: true });
    fs.writeFileSync(path.join(venv, "py.typed"), "");

    // Save to cache
    const testKey = "test-cache-key-v1";
    const saveResult = await manager.save(workspaceDir, { key: testKey });
    assert.equal(saveResult.hit, true);
    assert.equal(saveResult.key, testKey);
    assert.ok(saveResult.sizeBytes && saveResult.sizeBytes > 0);

    // Check adapter key existence
    const exists = await adapter.hasKey(testKey);
    assert.equal(exists, true);

    // Wipe local workspace node_modules and .venv
    fs.rmSync(path.join(workspaceDir, "node_modules"), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceDir, ".venv"), { recursive: true, force: true });
    assert.equal(fs.existsSync(nodeModules), false);

    // Restore from cache
    const restoreResult = await manager.restore(workspaceDir, { key: testKey });
    assert.equal(restoreResult.hit, true);
    assert.equal(fs.existsSync(path.join(nodeModules, "index.js")), true);
    assert.equal(
      fs.readFileSync(path.join(nodeModules, "index.js"), "utf-8"),
      "console.log('test');",
    );
    assert.equal(fs.existsSync(path.join(venv, "py.typed")), true);

    // Test clean
    const cleanResult = await manager.clean();
    assert.equal(cleanResult.removedKeys, 1);
    assert.ok(cleanResult.freedBytes > 0);
    assert.equal(await adapter.hasKey(testKey), false);

    // Cleanup
    fs.rmSync(cacheStorageDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  await t.test("returns cache miss when key does not exist", async () => {
    const cacheStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-cache-miss-"));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-ws-miss-"));

    const adapter = new LocalDiskAdapter(cacheStorageDir);
    const manager = new PolyCacheManager(adapter);

    const result = await manager.restore(workspaceDir, { key: "non-existent-key" });
    assert.equal(result.hit, false);

    fs.rmSync(cacheStorageDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });
});
