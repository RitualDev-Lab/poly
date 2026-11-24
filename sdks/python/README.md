# poly-build

[![PyPI version](https://img.shields.io/pypi/v/poly-build.svg)](https://pypi.org/project/poly-build/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

The Universal Polyglot CLI Package & Dependency Orchestrator for Node.js, Python, Rust, and Go.

## 🚀 Installation

```bash
pip install poly-build
```

Or run directly without installing using `pipx` or `uv`:

```bash
# Using uv (fastest)
uvx poly-build --help

# Using pipx
pipx run poly-build --help
```

Both `poly` and `poly-build` commands are registered in your PATH upon installation.

## 💡 Quick Start

```bash
# Initialize a new polyglot monorepo project
poly init

# Scan workspace and generate lockfile
poly scan

# Install dependencies across all ecosystems (npm, PyPI, Cargo, Go)
poly install

# Audit all dependencies for known CVEs
poly audit
```

## 🌐 Official Links

- **Documentation:** [https://poly.ritualdev.in/docs](https://poly.ritualdev.in/docs)
- **Homepage:** [https://poly.ritualdev.in](https://poly.ritualdev.in)
- **GitHub Repository:** [https://github.com/RitualDev-Lab/poly](https://github.com/RitualDev-Lab/poly)
- **Issues:** [https://github.com/RitualDev-Lab/poly/issues](https://github.com/RitualDev-Lab/poly/issues)
