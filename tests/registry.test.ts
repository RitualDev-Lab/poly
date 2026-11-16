import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RegistryRouter } from "../src/registry/router.js";
import { RegistryVerifier } from "../src/registry/verifier.js";

test("Registry Router & Environment Injection", async (t) => {
  await t.test("parses registry configuration from poly.toml", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-reg-toml-"));
    const tomlContent = `
[workspace]
members = ["services/*"]

[registries.npm]
url = "https://npm.corp.internal/artifactory"
ca_file = "/etc/ssl/corp.crt"

[registries.pypi]
url = "https://pypi.corp.internal/simple"
trusted_host = "pypi.corp.internal"

[registries.go]
url = "https://goproxy.corp.internal,direct"

[registries.cargo]
url = "sparse+https://cargo.corp.internal/index/"
`;
    fs.writeFileSync(path.join(tmpDir, "poly.toml"), tomlContent);

    const router = new RegistryRouter();
    const config = router.loadRegistryConfig(tmpDir);

    assert.equal(config.npm?.url, "https://npm.corp.internal/artifactory");
    assert.equal(config.npm?.caFile, "/etc/ssl/corp.crt");
    assert.equal(config.pypi?.url, "https://pypi.corp.internal/simple");
    assert.equal(config.pypi?.trustedHost, "pypi.corp.internal");
    assert.equal(config.go?.url, "https://goproxy.corp.internal,direct");
    assert.equal(config.cargo?.url, "sparse+https://cargo.corp.internal/index/");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("injects native CLI flags for private registries", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-reg-flags-"));
    const tomlContent = `
[registries.npm]
url = "https://npm.corp.internal/artifactory"

[registries.pypi]
url = "https://pypi.corp.internal/simple"
`;
    fs.writeFileSync(path.join(tmpDir, "poly.toml"), tomlContent);

    const router = new RegistryRouter();
    const npmArgs = router.injectCliFlags("npm", ["install", "express"], tmpDir);
    assert.deepEqual(npmArgs, [
      "install",
      "express",
      "--registry",
      "https://npm.corp.internal/artifactory",
    ]);

    const pypiArgs = router.injectCliFlags("pypi", ["add", "requests"], tmpDir);
    assert.deepEqual(pypiArgs, [
      "add",
      "requests",
      "--index-url",
      "https://pypi.corp.internal/simple",
    ]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("injects environment variables for air-gapped runners", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-reg-env-"));
    const tomlContent = `
[registries.npm]
url = "https://npm.corp.internal/artifactory"
ca_file = "/etc/ssl/corp.crt"

[registries.pypi]
url = "https://pypi.corp.internal/simple"
trusted_host = "pypi.corp.internal"

[registries.go]
url = "https://goproxy.corp.internal"

[registries.cargo]
url = "sparse+https://cargo.corp.internal/index/"
`;
    fs.writeFileSync(path.join(tmpDir, "poly.toml"), tomlContent);

    const router = new RegistryRouter();

    const npmEnv = router.injectEnvironmentVariables("npm", tmpDir, {});
    assert.equal(npmEnv.NPM_CONFIG_REGISTRY, "https://npm.corp.internal/artifactory");
    assert.equal(npmEnv.NPM_CONFIG_CAFILE, "/etc/ssl/corp.crt");

    const pypiEnv = router.injectEnvironmentVariables("pypi", tmpDir, {});
    assert.equal(pypiEnv.UV_INDEX_URL, "https://pypi.corp.internal/simple");
    assert.equal(pypiEnv.PIP_INDEX_URL, "https://pypi.corp.internal/simple");
    assert.equal(pypiEnv.PIP_TRUSTED_HOST, "pypi.corp.internal");

    const goEnv = router.injectEnvironmentVariables("go", tmpDir, {});
    assert.equal(goEnv.GOPROXY, "https://goproxy.corp.internal");

    const cargoEnv = router.injectEnvironmentVariables("cargo", tmpDir, {});
    assert.equal(
      cargoEnv.CARGO_REGISTRIES_CRATES_IO_INDEX,
      "sparse+https://cargo.corp.internal/index/",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("supports environment variable overrides over poly.toml", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-reg-overrides-"));
    fs.writeFileSync(
      path.join(tmpDir, "poly.toml"),
      '[registries.npm]\nurl = "https://npm.corp.internal"',
    );

    process.env.POLY_NPM_REGISTRY = "https://override.corp.internal";
    const router = new RegistryRouter();
    const config = router.loadRegistryConfig(tmpDir);

    assert.equal(config.npm?.url, "https://override.corp.internal");

    // biome-ignore lint/performance/noDelete: test cleanup requires unsetting environment variable
    delete process.env.POLY_NPM_REGISTRY;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

test("Registry Verifier", async (t) => {
  await t.test("verifies empty registries when none configured", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-reg-empty-"));
    const verifier = new RegistryVerifier();
    const results = await verifier.verifyAll(tmpDir);
    assert.equal(results.length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
