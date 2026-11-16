import type { ExecutionResult, PackageSpec } from "../types.js";

export function logHeader(title: string): void {
  console.log(`\x1b[1m\x1b[36m⚡ [poly]\x1b[0m \x1b[1m${title}\x1b[0m`);
}

export function logSuccess(message: string, durationMs?: number): void {
  const duration = durationMs !== undefined ? ` \x1b[90m(${durationMs}ms)\x1b[0m` : "";
  console.log(`\x1b[32m✔\x1b[0m ${message}${duration}`);
}

export function logError(message: string): void {
  console.error(`\x1b[31m✖\x1b[0m \x1b[1m${message}\x1b[0m`);
}

export function logExecutionPlan(
  action: "add" | "remove" | "install" | "update",
  pkg?: PackageSpec,
  engine?: string,
  command?: string,
  args?: string[],
): void {
  if (pkg) {
    const ecoTag = pkg.ecosystem ? `\x1b[35m[${pkg.ecosystem}]\x1b[0m ` : "";
    const devTag = pkg.isDev ? " \x1b[90m(dev)\x1b[0m" : "";
    console.log(
      `\x1b[34m→\x1b[0m Routing ${ecoTag}\x1b[1m${pkg.name}\x1b[0m${devTag} via \x1b[33m${engine}\x1b[0m (${command} ${args?.join(" ")})`,
    );
  }
}
