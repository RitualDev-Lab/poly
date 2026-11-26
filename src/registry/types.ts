import type { Ecosystem } from "../types.js";

export interface RegistryEndpoint {
  url: string;
  caFile?: string;
  authTokenEnv?: string;
  trustedHost?: string;
}

export interface CorporateRegistryConfig {
  npm?: RegistryEndpoint;
  pypi?: RegistryEndpoint;
  cargo?: RegistryEndpoint;
  go?: RegistryEndpoint;
  [ecosystem: string]: RegistryEndpoint | undefined;
}

export interface RegistryHealthStatus {
  ecosystem: Ecosystem;
  url: string;
  isReachable: boolean;
  latencyMs: number;
  httpStatus?: number;
  error?: string;
}
