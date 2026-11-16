import path from "node:path";
import {
  AttestationEngine,
  CrossStackAuditor,
  PolicyEvaluator,
  SecurityAutoHealer,
  type VulnerabilitySeverity,
} from "../compliance/index.js";
import { detectContexts } from "../detector/index.js";
import { PolyDispatcher } from "../dispatcher/index.js";
import { DockerGenerator } from "../docker/index.js";
import { PolyDoctor } from "../doctor/index.js";
import { parsePackageSpec } from "../purl/index.js";
import type { Ecosystem } from "../types.js";
import {
  WorkspaceDispatcher,
  resolveWorkspaceMembers,
  verifyCompositeLockfile,
  writeCompositeLockfile,
} from "../workspace/index.js";
import type { McpToolCallResult } from "./types.js";

export async function handleToolCall(
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolCallResult> {
  const cwd = path.resolve(
    typeof args.workspaceDir === "string" ? args.workspaceDir : process.cwd(),
  );

  try {
    switch (name) {
      case "poly_detect_workspace": {
        const members = resolveWorkspaceMembers(cwd);
        const contexts = detectContexts(cwd);
        const dispatcher = new PolyDispatcher();
        const ecosystems: Ecosystem[] = ["npm", "pypi", "cargo", "go"];

        const engines = ecosystems.map((eco) => {
          try {
            return dispatcher.which(eco, cwd);
          } catch {
            return { engine: "unknown", effectiveCli: "none" };
          }
        });

        const data = {
          workspaceDir: cwd,
          membersCount: members.length,
          members: members.map((m) => ({
            relativeDir: m.relativeDir,
            ecosystem: m.context.ecosystem,
            manifestFile: m.context.manifestFile,
            lockfile: m.context.lockfile,
          })),
          detectedContexts: contexts.map((c) => ({
            ecosystem: c.ecosystem,
            manifestFile: c.manifestFile,
            lockfile: c.lockfile,
            directory: c.directory,
          })),
          activeEngines: engines,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "poly_resolve_package": {
        const pkgInput = String(args.package || "");
        if (!pkgInput) throw new Error("Missing 'package' argument.");

        const parsed = parsePackageSpec(pkgInput);
        const dispatcher = new PolyDispatcher();
        let engineInfo: { engine: string; effectiveCli: string } | undefined;

        if (parsed.ecosystem) {
          try {
            engineInfo = dispatcher.which(parsed.ecosystem, cwd);
          } catch {
            // Engine not installed
          }
        }

        const data = {
          input: pkgInput,
          resolvedSpec: parsed,
          engineInfo,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "poly_add_dependency": {
        const pkgInput = String(args.package || "");
        if (!pkgInput) throw new Error("Missing 'package' argument.");
        const isDev = Boolean(args.isDev);

        const dispatcher = new PolyDispatcher();
        const result = await dispatcher.add(pkgInput, { isDev, cwd, silent: true });
        writeCompositeLockfile(cwd);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: result.exitCode === 0 ? "success" : "failed",
                  package: pkgInput,
                  engine: result.engine,
                  command: `${result.command} ${result.args.join(" ")}`,
                  durationMs: result.durationMs,
                  exitCode: result.exitCode,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "poly_remove_dependency": {
        const pkgInput = String(args.package || "");
        if (!pkgInput) throw new Error("Missing 'package' argument.");

        const dispatcher = new PolyDispatcher();
        const result = await dispatcher.remove(pkgInput, { cwd, silent: true });
        writeCompositeLockfile(cwd);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: result.exitCode === 0 ? "success" : "failed",
                  package: pkgInput,
                  engine: result.engine,
                  durationMs: result.durationMs,
                  exitCode: result.exitCode,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "poly_sync_workspace": {
        const frozen = Boolean(args.frozen);
        const wsDispatcher = new WorkspaceDispatcher();
        const results = await wsDispatcher.syncWorkspace(cwd, { frozen, silent: true });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  syncedMembers: results.length,
                  allSucceeded: results.every((r) => r.exitCode === 0),
                  results: results.map((r) => ({
                    engine: r.engine,
                    exitCode: r.exitCode,
                    durationMs: r.durationMs,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "poly_audit_security": {
        const failOn = args.failOn as VulnerabilitySeverity | undefined;
        const auditor = new CrossStackAuditor();
        const report = await auditor.audit(cwd, { failOn });

        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        };
      }

      case "poly_verify_lock": {
        const drift = verifyCompositeLockfile(cwd);

        return {
          content: [{ type: "text", text: JSON.stringify(drift, null, 2) }],
        };
      }

      case "poly_fix_vulnerabilities": {
        const dryRun = Boolean(args.dryRun);
        const minSeverity = args.minSeverity as VulnerabilitySeverity | undefined;
        const healer = new SecurityAutoHealer();
        const report = await healer.fix(cwd, { dryRun, minSeverity });

        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        };
      }

      case "poly_update_dependency": {
        const pkgInput = args.package ? String(args.package) : undefined;
        const all = Boolean(args.all);
        const dispatcher = new PolyDispatcher();
        const results = await dispatcher.update(pkgInput, { all, cwd, silent: true });
        writeCompositeLockfile(cwd);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  updatedCount: results.length,
                  allSucceeded: results.every((r) => r.exitCode === 0),
                  results: results.map((r) => ({
                    engine: r.engine,
                    exitCode: r.exitCode,
                    durationMs: r.durationMs,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "poly_doctor": {
        const doctor = new PolyDoctor();
        const report = await doctor.diagnose(cwd);

        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        };
      }

      case "poly_generate_docker": {
        const generator = new DockerGenerator();
        const devcontainer = Boolean(args.devcontainer);
        const dryRun = Boolean(args.dryRun);
        const result = generator.generate({ workspaceDir: cwd, devcontainer, dryRun });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "poly_generate_attestation": {
        const engine = new AttestationEngine();
        const subjects = Array.isArray(args.subjects) ? (args.subjects as string[]) : undefined;
        const statement = engine.generateStatement({ workspaceDir: cwd, subjects });

        return {
          content: [{ type: "text", text: JSON.stringify(statement, null, 2) }],
        };
      }

      case "poly_verify_attestation": {
        const engine = new AttestationEngine();
        const envelope = JSON.parse(String(args.envelopeJson));
        const pubKey = String(args.publicKeyPem);
        const verification = engine.verifyEnvelope(envelope, pubKey, cwd);

        return {
          content: [{ type: "text", text: JSON.stringify(verification, null, 2) }],
        };
      }

      case "poly_evaluate_policy": {
        const evaluator = new PolicyEvaluator();
        const denied = Array.isArray(args.deniedLicenses)
          ? (args.deniedLicenses as string[])
          : undefined;
        const cveThreshold = args.failOnCveSeverity
          ? (String(args.failOnCveSeverity) as VulnerabilitySeverity)
          : undefined;
        const report = await evaluator.evaluate(cwd, {
          deniedLicenses: denied,
          failOnCveSeverity: cveThreshold,
          checkLockfileDrift: true,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        };
      }

      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool '${name}'` }],
        };
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: (err as Error).message }],
    };
  }
}
