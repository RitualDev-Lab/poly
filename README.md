# poly ⚡

> **The Universal Polyglot CLI Package & Dependency Orchestrator**  
> One consistent syntax to add, remove, and synchronize dependencies across **Node.js, Python, Rust, and Go**.

[![CI](https://github.com/RitualDev-Lab/poly/actions/workflows/ci.yml/badge.svg)](https://github.com/RitualDev-Lab/poly/actions)
[![npm version](https://img.shields.io/npm/v/@ritualdev-lab/poly.svg?color=blue)](https://www.npmjs.com/package/@ritualdev-lab/poly)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Why `poly`?

Modern engineering teams rarely build in a single programming language. A typical stack often pairs a **Next.js frontend**, a **Python AI backend**, and **Rust/Go microservices or WebAssembly crates**.

Switching cognitive context between `pnpm add`, `uv add`, `cargo add`, and `go get` creates friction and trips up autonomous AI coding agents (Claude Code, Cursor, Windsurf).

`poly` acts as a zero-latency orchestrator that translates universal package requests into the fastest native package manager on your system.

```
                         ┌─────────────────────────────┐
                         │      poly CLI Runner        │
                         │   (Zero-Runtime Overhead)   │
                         └──────────────┬──────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
  ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
  │   Node.js (npm)      │   │     Python (PyPI)    │   │      Rust (Cargo)    │
  │  pnpm · bun · npm    │   │      uv · pip        │   │         cargo        │
  └──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

---

## Key Features

- **PURL Standard & Shorthand**: Use `npm:zod`, `pypi:fastapi`, `cargo:tokio`, or standard `pkg:npm/...` specifications.
- **Polyglot Workspaces (`poly.toml`)**: Orchestrate monorepos with parallel dependency synchronization across members.
- **Composite Cryptographic Lockfile (`poly.lock`)**: High-speed SHA-256 integrity verification tracking all underlying native lockfiles.
- **Zero-Drift CI/CD Mode (`--frozen`)**: Deterministically fails if any manifest or lockfile is modified out-of-band.
- **Cross-Stack Task Runner (`poly run <task>`)**: Concurrently run scripts across services with colorized prefix streaming.
- **Native Engine Delegation**: Zero custom solvers or lockfile corruption. `poly` delegates 100% of the resolution to verified native tools (`uv`, `pnpm`, `cargo`, `go`).
- **Interactive Disambiguation**: When multiple manifests exist in the same directory, `poly` presents an inline selection prompt.
- **AI Agent Friendly**: Eliminates shell syntax hallucination for autonomous coding agents.

---

## Quickstart

### Installation

```bash
# Global install via npm
npm install -g @ritualdev-lab/poly

# Or run instantly via npx
npx @ritualdev-lab/poly add pypi:fastapi
```

---

## CLI Usage

### Adding Dependencies

```bash
# Explicit ecosystem shorthand
poly add npm:zod
poly add pypi:fastapi
poly add cargo:tokio --features full
poly add go:github.com/gin-gonic/gin

# Adding development dependencies
poly add npm:vitest -D
poly add pypi:pytest -D

# Auto-detect ecosystem from current working directory
cd services/api
poly add requests    # Automatically routes to PyPI via uv or pip
```

### Removing Dependencies

```bash
poly remove npm:lodash
poly remove pypi:scikit-learn
```

### Installing / Synchronizing

```bash
# Sync dependencies for closest project
poly install

# Synchronize all polyglot projects across an entire monorepo
poly install --all
```

### Workspace Operations & Deterministic Lockfiles

```bash
# Synchronize all workspace members concurrently
poly sync

# Enforce zero-drift in CI/CD pipelines (fails if lockfile is out of sync)
poly install --frozen

# Verify composite lockfile cryptographic integrity without modifying disk
poly lock --verify

# Run cross-stack scripts across services with colorized prefix streaming
poly run dev
poly run test --filter apps/web
```

### Enterprise Compliance & Security Auditing

```bash
# Query OSV database for known vulnerabilities across all ecosystems
poly audit

# Enforce security gates in CI/CD (fails build if HIGH or CRITICAL CVEs exist)
poly audit --fail-on high

# Export standard SARIF v2.1.0 report for GitHub Advanced Security
poly audit --format sarif --output poly-security.sarif

# Audit license compliance & flag forbidden copyleft licenses (GPL/AGPL)
poly license --check

# Generate CycloneDX v1.5 or SPDX v2.3 Software Bill of Materials (SBOM)
poly sbom --format cyclonedx --output sbom.json
poly sbom --format spdx --output spdx.json
```

### Inspecting Active Engines

```bash
poly which npm     # e.g., pnpm (v9.15.4)
poly which pypi    # e.g., uv (v0.5.1)
poly which cargo   # e.g., cargo (v1.84.0)
```

---

## Roadmap

- [x] **Phase 1: Core Engine, PURL Routing & Native Delegation**
- [x] **Phase 2: Polyglot Workspaces & Composite `poly.lock`** (Cryptographic SHA-256 Hashing)
- [x] **Phase 3: Enterprise Cross-Stack CVE Auditing & SBOM** (`poly audit`, SPDX/CycloneDX)
- [ ] **Phase 4: Remote S3/R2 Distributed CI Cache** (`poly cache`)
- [ ] **Phase 5: Model Context Protocol (MCP) Server for AI Agents** (`poly mcp`)

---

## License

MIT © [RitualDev Lab](https://ritualdev.in)
