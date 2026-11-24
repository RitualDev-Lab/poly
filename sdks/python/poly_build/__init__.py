"""
poly-build: The Universal Polyglot CLI Package & Dependency Orchestrator for Node.js, Python, Rust, and Go.
"""

from .cli import get_binary_path, main

__version__ = "0.6.2"
__all__ = ["get_binary_path", "main", "__version__"]
