import { BACKEND_MOBILE_ADAPTERS } from "./backend-mobile.js";
import { CORE_ADAPTERS } from "./core.js";
import { CPP_JULIA_ADAPTERS } from "./cpp-julia.js";
import { LONGTAIL_ADAPTERS } from "./longtail.js";
import { engineRegistry } from "./registry.js";
import { TIER2_MANIFEST_ADAPTERS } from "./tier2-manifest.js";

// Side-effect registration when importing the full barrel (`engines/index.js`) so synchronous callers work seamlessly.
for (const adapter of [
  ...CORE_ADAPTERS,
  ...BACKEND_MOBILE_ADAPTERS,
  ...CPP_JULIA_ADAPTERS,
  ...TIER2_MANIFEST_ADAPTERS,
  ...LONGTAIL_ADAPTERS,
]) {
  engineRegistry.register(adapter);
}

export {
  CORE_ADAPTERS,
  cargoAdapter,
  condaAdapter,
  goAdapter,
  jsrAdapter,
  npmAdapter,
  pypiAdapter,
} from "./core.js";

export { BaseEngine } from "./base.js";
export {
  BACKEND_MOBILE_ADAPTERS,
  composerAdapter,
  gemAdapter,
  nugetAdapter,
  pubAdapter,
} from "./backend-mobile.js";
export {
  CPP_JULIA_ADAPTERS,
  conanAdapter,
  juliaAdapter,
  mesonAdapter,
  vcpkgAdapter,
} from "./cpp-julia.js";
export {
  createCustomEngineAdapter,
  expandCommandTemplate,
  parseCustomEnginesFromToml,
  registerCustomEnginesFromConfig,
  syncCustomEnginesInDir,
} from "./custom.js";
export {
  DeclarativeEngine,
  defineDeclarativeAdapter,
  type DeclarativeCommandSpec,
  type EngineAdapter,
} from "./declarative.js";
export { GoEngine } from "./go.js";
export {
  LONGTAIL_ADAPTERS,
  cpanAdapter,
  cranAdapter,
  hackageAdapter,
  luarocksAdapter,
} from "./longtail.js";
export { NodeEngine, type NodeCli } from "./node.js";
export { PythonEngine, type PythonCli } from "./python.js";
export {
  EngineRegistry,
  engineRegistry,
  resolveEcosystemLockContext,
} from "./registry.js";
export { RustEngine } from "./rust.js";
export {
  TIER2_MANIFEST_ADAPTERS,
  carthageAdapter,
  cocoapodsAdapter,
  gradleAdapter,
  hexAdapter,
  mavenAdapter,
  rebar3Adapter,
  sbtAdapter,
  swiftAdapter,
} from "./tier2-manifest.js";
