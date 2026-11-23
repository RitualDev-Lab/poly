# CLAUDE.md — Polyglot Repository Guidelines (poly)

This repository is managed by **Poly** (`poly`), the universal polyglot package manager and orchestrator for Node.js, Python, Rust, and Go.

## Critical Rules for Autonomous Coding Agents:
1. **Never guess or invoke native package managers directly**:
   - ❌ Do NOT run `npm install`, `pnpm add`, `yarn add`, `pip install`, `uv add`, or `cargo add` in subdirectories.
   - ✔ ALWAYS use `poly add`, `poly remove`, and `poly sync`.

2. **Package Management Commands**:
   - **Add Dependency**: `poly add <ecosystem>:<package>`
     - Node.js: `poly add npm:zod`
     - Python: `poly add pypi:fastapi`
     - Rust: `poly add cargo:tokio`
     - Go: `poly add go:github.com/gin-gonic/gin`
   - **Dev Dependency**: Add `-D` or `--dev` (e.g. `poly add npm:vitest -D`)
   - **Remove Dependency**: `poly remove <package>`
   - **Synchronize Monorepo**: `poly sync` or `poly install`

3. **Task & Test Orchestration**:
   - Run tests: `poly test` (orchestrates unit test suites across all stack members)
   - Run tasks: `poly run build`, `poly run dev`, `poly run <task>`

4. **Token-Efficient Inspection (--json Mode)**:
   - When inspecting workspace state, always use structured `--json` flags to minimize token usage:
     - `poly detect --json`: Inspect detected project ecosystems and manifests.
     - `poly list --json`: List all workspace members and direct dependencies.
     - `poly audit --json`: Concise OSV security vulnerability report.

5. **Security & Drift Verification**:
   - Scan vulnerabilities: `poly audit --fail-on high`
   - Check composite lockfile drift: `poly lock --verify`
   - Automated CVE remediation: `poly fix`
