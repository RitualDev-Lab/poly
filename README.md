# poly ⚡

> **The Universal Polyglot CLI Package & Dependency Orchestrator**  
> One consistent syntax to add, remove, and synchronize dependencies across **Node.js, Python, Rust, and Go**.

[![CI](https://github.com/RitualDev-Lab/poly/actions/workflows/ci.yml/badge.svg)](https://github.com/RitualDev-Lab/poly/actions)
[![npm version](https://img.shields.io/npm/v/@ritualdev-lab/poly.svg?color=blue)](https://www.npmjs.com/package/@ritualdev-lab/poly)
[![Web Platform](https://img.shields.io/badge/Web%20Platform-poly.ritualdev.in-38bdf8.svg)](https://poly.ritualdev.in)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Official Web Platform & Interactive Simulator**: [https://poly.ritualdev.in](https://poly.ritualdev.in)  
**Official VS Code Extension**: [RitualDev-Lab/vscode-poly](https://github.com/RitualDev-Lab/vscode-poly)  
**Official GitHub Action**: [RitualDev-Lab/setup-poly](https://github.com/RitualDev-Lab/setup-poly)  
**Enterprise Web Repository**: [RitualDev-Lab/poly-web](https://github.com/RitualDev-Lab/poly-web)

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

## Installation

`poly` is available as a **zero-dependency standalone native binary** for Linux, macOS, and Windows (no Node.js or npm required), as well as via Homebrew, Scoop, and npm.

### Standalone 1-Line Installers (Recommended)

#### Linux & macOS
```bash
curl -fsSL https://poly.ritualdev.in/install.sh | sh
```

#### Windows (PowerShell)
```powershell
irm https://poly.ritualdev.in/install.ps1 | iex
```

---

### Package Managers

#### Homebrew (macOS & Linux)
```bash
brew install RitualDev-Lab/tap/poly
```

#### Scoop (Windows)
```powershell
scoop bucket add ritualdev https://github.com/RitualDev-Lab/scoop-bucket
scoop install poly
```

#### npm / npx
```bash
# Global install via npm
npm install -g @ritualdev-lab/poly

# Or run on-demand via npx
npx @ritualdev-lab/poly add pypi:fastapi
```

### GitHub Actions CI/CD Integration

Use the official [setup-poly](https://github.com/RitualDev-Lab/setup-poly) action in your workflow:

```yaml
- name: Set up Poly
  uses: RitualDev-Lab/setup-poly@v1
  with:
    version: 'latest'

- name: Sync dependencies & verify zero drift
  run: poly install --frozen

- name: Cross-stack CVE security gate
  run: poly audit --fail-on high
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

### Installing & Updating Dependencies

```bash
# Sync dependencies for closest project
poly install

# Synchronize all polyglot projects across an entire monorepo
poly install --all

# Upgrade specific package to latest compatible version
poly update npm:zod
poly update pypi:fastapi

# Upgrade all dependencies across all ecosystems
poly update
```

### Cross-Ecosystem Outdated & Upgrade Intelligence

Scan package registries concurrently across **Node.js (npm), Python (PyPI), Rust (crates.io), and Go proxy** in under 300ms, printing a unified, color-coded semver table (`MAJOR`, `MINOR`, `PATCH`):

```bash
# Scan outdated dependencies across all workspace members
poly outdated

# Machine-readable output for CI/CD gates or AI agents
poly outdated --json

# Filter scan to a specific workspace directory
poly outdated --filter services/ai

# Guided batch upgrade: patches manifests & synchronizes poly.lock
poly upgrade

# Upgrade specific packages across ecosystems
poly upgrade zod fastapi tokio
```

### Cross-Service Dev Matrix (`poly dev`)

Unify your heterogeneous development environment with a single command. `poly dev` concurrently launches frontend dev servers, Python AI backends, and Rust/Go services, streaming color-coded, uniformly aligned prefixes per service and guaranteeing graceful shutdown (killing process trees without leaving zombie ports on Ctrl+C):

```toml
# poly.toml
[workspace]
members = ["apps/*", "services/*"]

[scripts]
dev = { parallel = ["web:dev", "api:dev", "worker:dev"] }
test = { parallel = ["web:test", "api:test", "worker:test"] }
```

```bash
# Start all microservices in parallel with colored streaming prefixes
poly dev

# Filter to a specific service or slice
poly dev --filter web

# Run cross-stack test suite across all services
poly test
```

### Native Shell Auto-Completions (`poly completion`)

Fast, zero-dependency tab completion for all subcommands, flags, workspace member targets, and dynamic task completions from `poly.toml` and `package.json` (`poly run <TAB>`):

```bash
# Bash (add to ~/.bashrc)
eval "$(poly completion bash)"

# Zsh (add to ~/.zshrc)
eval "$(poly completion zsh)"

# Fish (add to ~/.config/fish/config.fish)
poly completion fish | source

# PowerShell (add to $PROFILE)
poly completion powershell | Out-String | Invoke-Expression
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

# Automatically remediate vulnerabilities and patch manifests
poly fix

# Dry-run remediation without modifying files on disk
poly fix --dry-run

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

### System Health & Toolchain Diagnostics

```bash
# Run complete diagnostic suite (Node, Python, Rust, Go, C compiler, registries, drift)
poly doctor

# Machine-readable diagnostic report for CI or agent pipelines
poly doctor --json
```

### Polyglot Docker & DevContainer Generator

```bash
# Generate production multi-stage Dockerfile and docker-compose.yml
poly docker

# Generate with VS Code / GitHub Codespaces DevContainer configuration
poly docker --devcontainer

# Preview generated container artifacts without writing to disk
poly docker --devcontainer --dry-run

# Output artifacts to custom target directory
poly docker --output-dir ./deploy/docker
```

### Enterprise Cryptographic Attestation & Policy Enforcement

```bash
# Generate Ed25519 cryptographic signing keypair (PEM format)
poly attest keygen

# Generate in-toto SLSA Provenance v1.0 statement
poly attest generate --output attestation.json

# Cryptographically sign provenance statement into DSSE envelope
poly attest sign --key poly-key.pem --output signed-envelope.json

# Verify DSSE envelope signature & enforce zero artifact drift on disk
poly attest verify --attestation signed-envelope.json --key poly-key.pub

# Evaluate enterprise license whitelists and CVE thresholds
poly policy --fail-on-violation
```

### Distributed CI Caching & Enterprise Registries

```bash
# Save dependency artifacts (node_modules, .venv, target) into local / CI cache
poly cache save

# Restore dependency artifacts using deterministic OS/Arch/poly.lock hash key
poly cache restore

# Purge local cache
poly cache clean

# Verify reachability and latency of corporate registries (Artifactory, Nexus, AWS CodeArtifact)
poly registry test
```

### Hosted Remote Cache Integration (`poly login`, `poly cache status`, `poly cache purge`)

Bridge directly into your hosted **[poly-cloud-api](https://github.com/RitualDev-Lab/poly-cloud-api)** server:

```bash
# Authenticate against your hosted Poly Cloud API server (stores in ~/.poly/config.json)
poly login --url https://cache.ritualdev.in --token poly_tok_abc123 --workspace default

# Display active authenticated session
poly whoami

# Inspect live cluster latency, hit rate (%), saved compute time, and dollar ROI
poly cache status
poly cache status --json

# Invalidate remote cache for the current git branch with one command
poly cache purge
poly cache purge --branch feature/login-flow
poly cache purge --all

# Log out and remove local stored credentials
poly logout
```

### 🤖 The Default Package Manager for Autonomous AI Agents

Autonomous coding agents (**Claude Code, Cursor, Windsurf, Devin, Codex**) struggle with dependency management—wasting 40% of their context windows reading verbose package manager progress bars, hallucinating commands in monorepos, and risking supply-chain attacks from unvetted lifecycle scripts.

`poly` is built from the ground up as the native package orchestrator for AI agents:

```bash
# Token-Efficient Output (--agent): Replaces 1,000 lines of npm/pip output with 3 lines of structured JSON
poly add --agent npm:zod
poly install --agent

# Built-in Supply-Chain Script Sandboxing: Neutralizes malicious postinstall lifecycle scripts
poly add --sandbox npm:shady-pkg
poly sandbox check npm:shady-pkg       # Pre-flight lifecycle script inspection before installation

# 1-Click Agent Command Shortcut: Turns on sandbox, non-interactive mode, and compact JSON
poly agent add npm:zod
poly agent install
poly agent audit

# 1-Click MCP Setup: Auto-detects Claude Desktop, Cursor, and Windsurf and injects Poly's MCP server
poly mcp install

# Auto-generate agent prompt directives (.cursorrules, .cursor/rules/poly.mdc, CLAUDE.md)
poly init --ide all

# Token-Efficient Inspection Mode: Saves ~80% context tokens for coding agents
poly detect --json     # Concise detected environments and primary ecosystem
poly list --json       # Compact workspace members & direct dependency map
poly audit --json      # Streamlined vulnerability report with zero preamble noise
poly outdated --json   # Concurrent cross-ecosystem outdated scan in <300ms

# Universal Test & Task Runner (prevents agents from guessing subfolder commands)
poly test              # Runs test suites across all stack members (Node, Python, Rust, Go)
poly run <task>        # Runs cross-stack tasks (e.g. 'poly run build', 'poly run dev')

# Start stdio Model Context Protocol (MCP) server directly
poly mcp

# Output raw MCP client configuration JSON snippet
poly mcp --config
```

### 🛡️ Live Supply-Chain & License Firewall

Stop malicious code and legal liability **before bytes touch the disk**:

* **24-Hour Quarantine Cooldown**: Automatically halts packages published `<24h` ago, preventing 95%+ of zero-day maintainer account takeovers on npm & PyPI.
* **Auto-Rollback to Mature Release**: In `rollback` mode (default), Poly transparently pins to the latest verified release published `>=24h` ago.
* **Pre-Execution License Gate**: Blocks copyleft licenses (GPL, AGPL, SSPL) before download, preventing developers and AI agents from contaminating closed-source codebases.

```bash
# Pre-flight check package age, quarantine status, and license compliance
poly firewall check npm:zod
poly firewall check pypi:fastapi --agent

# Bypass quarantine window explicitly for testing newly published releases
poly add npm:fast-logger --allow-untested
```

Configure firewall policy directly in `poly.toml`:

```toml
# poly.toml
[security]
quarantine_hours = 24       # Cooldown threshold (0 to disable)
quarantine_action = "rollback" # "rollback" (mature release) or "block"

[security.licenses]
policy = "denylist"
denied = ["GPL-2.0", "GPL-3.0", "AGPL-1.0", "AGPL-3.0", "SSPL-1.0"]
on_violation = "block"      # "block" or "warn"
```

### Inspecting Active Engines

```bash
poly which npm     # e.g., pnpm (v9.15.4)
poly which pypi    # e.g., uv (v0.5.1)
poly which cargo   # e.g., cargo (v1.84.0)
```

---

## License

MIT © [RitualDev Lab](https://ritualdev.in)

---

---

## 💖 Sponsor & Support

If you find this project valuable, consider supporting our open-source development:

[![Sponsor on Dodo Payments](https://img.shields.io/badge/Sponsor_via_Dodo-Payments-8b5cf6?style=for-the-badge&logo=shield&logoColor=white)](https://checkout.dodopayments.com/buy/pdt_0NpjONGugY5QkrFDUaPva)
[![Interactive Donation Portal](https://img.shields.io/badge/Donation_Portal-Cards%20%7C%20UPI%20%7C%20Apple%20Pay-ff5964?style=for-the-badge&logo=heart&logoColor=white)](https://ritualdev.in/donate)
[![GitHub Sponsors](https://img.shields.io/badge/GitHub_Sponsors-RitualDev--Lab-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/RitualDev-Lab)

- [**⚡ 1-Click Dodo Payments Checkout**](https://checkout.dodopayments.com/buy/pdt_0NpjONGugY5QkrFDUaPva)
- [**🎁 Interactive Donation Portal**](https://ritualdev.in/donate)
- [**❤️ GitHub Sponsors**](https://github.com/sponsors/RitualDev-Lab)

---

## 🛡️ Community & Governance
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Accessibility Statement](ACCESSIBILITY.md)
- [License](LICENSE)
