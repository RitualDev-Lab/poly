import type { PackageSpec } from "../types.js";
import { type EngineAdapter, defineDeclarativeAdapter } from "./declarative.js";

function formatConanTarget(pkg: PackageSpec): string {
  const fullName = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;
  if (!pkg.version) return fullName;
  const cleanVer = pkg.version.replace(/^[~^>=<]+/, "");
  return fullName.includes("/") ? fullName : `${fullName}/${cleanVer}`;
}

/** C / C++ — Conan (ConanCenter) */
export const conanAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "conan",
  ecosystem: "conan",
  aliases: ["cpp", "c++"],
  purlTypes: ["conan"],
  manifests: ["conanfile.txt", "conanfile.py"],
  lockfiles: ["conan.lock"],
  osvEcosystem: "ConanCenter",
  sbomPurlType: "conan",
  supportedClis: ["conan"],
  commands: {
    command: "conan",
    add: (pkg) => ["install", `--requires=${formatConanTarget(pkg)}`, "--build=missing"],
    remove: (pkg) => ["remove", `${pkg.name}/*`, "-c"],
    install: () => ["install", ".", "--build=missing"],
    update: (pkg) =>
      pkg
        ? ["install", `--requires=${formatConanTarget(pkg)}`, "--update", "--build=missing"]
        : ["install", ".", "--update", "--build=missing"],
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["ctest", ["--test-dir", "build"]] : ["conan", ["build", "."]],
  injectRegistryEnv: (endpoint, env) => {
    env.CONAN_HOME = endpoint.url;
  },
  injectRegistryFlags: (endpoint, args) => {
    if (args[0] === "install" && !args.includes("-r")) {
      args.push("-r", endpoint.url);
    }
  },
});

/** C / C++ — vcpkg (Manifest Mode) */
export const vcpkgAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "vcpkg",
  ecosystem: "vcpkg",
  aliases: [],
  purlTypes: ["vcpkg"],
  manifests: ["vcpkg.json", "vcpkg-configuration.json"],
  lockfiles: ["vcpkg-configuration.json"],
  osvEcosystem: undefined,
  sbomPurlType: "vcpkg",
  supportedClis: ["vcpkg"],
  commands: {
    command: "vcpkg",
    add: (pkg) => ["add", "port", pkg.name],
    remove: (pkg) => ["remove", pkg.name],
    install: () => ["install"],
    update: (pkg) => (pkg ? ["upgrade", pkg.name, "--no-dry-run"] : ["upgrade", "--no-dry-run"]),
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["ctest", ["--test-dir", "build"]] : ["cmake", ["--build", "build"]],
  injectRegistryEnv: (endpoint, env) => {
    env.VCPKG_BINARY_SOURCES = endpoint.url;
  },
});

/** C / C++ — Meson WrapDB */
export const mesonAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "meson",
  ecosystem: "meson",
  aliases: ["wrap", "wrapdb"],
  purlTypes: ["meson", "wrap"],
  manifests: ["meson.build"],
  lockfiles: [],
  osvEcosystem: undefined,
  sbomPurlType: "meson",
  supportedClis: ["meson"],
  commands: {
    command: "meson",
    add: (pkg) => ["wrap", "install", pkg.name],
    remove: () => ["subprojects", "purge", "--confirm"],
    install: () => ["subprojects", "download"],
    update: (pkg) => (pkg ? ["wrap", "update", pkg.name] : ["subprojects", "update"]),
  },
  resolveScriptCommand: (script) =>
    script === "test" ? ["meson", ["test", "-C", "build"]] : ["meson", ["compile", "-C", "build"]],
});

/** Julia — Pkg.jl (General Registry) */
export const juliaAdapter: EngineAdapter = defineDeclarativeAdapter({
  id: "julia",
  ecosystem: "julia",
  aliases: ["pkg.jl", "pkgjl"],
  purlTypes: ["julia"],
  manifests: ["Project.toml"],
  lockfiles: ["Manifest.toml"],
  osvEcosystem: undefined,
  sbomPurlType: "julia",
  supportedClis: ["julia"],
  commands: {
    command: "julia",
    add: (pkg) => {
      const cleanVer = pkg.version?.replace(/^[~^>=<]+/, "");
      const expr = cleanVer
        ? `using Pkg; Pkg.add(PackageSpec(name="${pkg.name}", version="${cleanVer}"))`
        : `using Pkg; Pkg.add("${pkg.name}")`;
      return ["--project=.", "-e", expr];
    },
    remove: (pkg) => ["--project=.", "-e", `using Pkg; Pkg.rm("${pkg.name}")`],
    install: () => ["--project=.", "-e", "using Pkg; Pkg.instantiate()"],
    update: (pkg) => [
      "--project=.",
      "-e",
      pkg ? `using Pkg; Pkg.update("${pkg.name}")` : "using Pkg; Pkg.update()",
    ],
  },
  resolveScriptCommand: (script) =>
    script === "test"
      ? ["julia", ["--project=.", "-e", "using Pkg; Pkg.test()"]]
      : ["julia", ["--project=.", "-e", script]],
  injectRegistryEnv: (endpoint, env) => {
    env.JULIA_PKG_SERVER = endpoint.url;
  },
});

export const CPP_JULIA_ADAPTERS: readonly EngineAdapter[] = [
  conanAdapter,
  vcpkgAdapter,
  mesonAdapter,
  juliaAdapter,
];
