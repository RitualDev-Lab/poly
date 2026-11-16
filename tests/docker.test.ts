import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerGenerator } from "../src/docker/generator.js";

test("DockerGenerator - Multi-Stage Containerization", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-docker-test-"));

  // Mock a polyglot workspace with Node web app and Python API service
  fs.writeFileSync(
    path.join(tmpDir, "poly.toml"),
    '[workspace]\nmembers = ["apps/*", "services/*"]\n',
  );

  const webDir = path.join(tmpDir, "apps", "web");
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(
    path.join(webDir, "package.json"),
    JSON.stringify({ name: "web", version: "1.0.0" }),
  );

  const apiDir = path.join(tmpDir, "services", "api");
  fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(
    path.join(apiDir, "pyproject.toml"),
    '[project]\nname = "api"\nversion = "0.1.0"\n',
  );

  const generator = new DockerGenerator();

  await t.test("generates multi-stage Dockerfile with builder stages and cache mounts", () => {
    const artifacts = generator.generate({ workspaceDir: tmpDir, dryRun: true });

    assert.ok(artifacts.dockerfile.includes("FROM node:22-bookworm-slim AS node-builder"));
    assert.ok(artifacts.dockerfile.includes("FROM python:3.12-slim AS python-builder"));
    assert.ok(artifacts.dockerfile.includes("FROM debian:bookworm-slim AS runner"));
    assert.ok(artifacts.dockerfile.includes("--mount=type=cache,target=/root/.cache/uv"));
    assert.ok(artifacts.dockerfile.includes("USER appuser"));
  });

  await t.test("generates docker-compose.yml with multi-service definitions", () => {
    const artifacts = generator.generate({ workspaceDir: tmpDir, dryRun: true });

    assert.ok(artifacts.dockerCompose.includes("web:"));
    assert.ok(artifacts.dockerCompose.includes("api:"));
    assert.ok(artifacts.dockerCompose.includes("volumes:"));
  });

  await t.test("generates devcontainer configuration when requested", () => {
    const artifacts = generator.generate({
      workspaceDir: tmpDir,
      devcontainer: true,
      dryRun: true,
    });

    assert.ok(artifacts.devcontainerJson);
    const parsed = JSON.parse(artifacts.devcontainerJson);
    assert.ok(parsed.features["ghcr.io/devcontainers/features/node:1"]);
    assert.ok(parsed.features["ghcr.io/devcontainers/features/python:1"]);
    assert.ok(parsed.postCreateCommand.includes("poly install"));
  });

  await t.test("writes files to disk when dryRun is false", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-docker-out-"));
    const artifacts = generator.generate({
      workspaceDir: tmpDir,
      outputDir: outDir,
      devcontainer: true,
      dryRun: false,
    });

    assert.equal(artifacts.createdFiles.length, 3);
    assert.ok(fs.existsSync(path.join(outDir, "Dockerfile")));
    assert.ok(fs.existsSync(path.join(outDir, "docker-compose.yml")));
    assert.ok(fs.existsSync(path.join(outDir, ".devcontainer", "devcontainer.json")));

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
