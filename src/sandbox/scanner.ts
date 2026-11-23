import type { DetectedScript, LifecycleHook, SandboxScanResult } from "./types.js";

const DANGEROUS_PATTERNS: Array<{ regex: RegExp; reason: string; risk: "medium" | "critical" }> = [
  {
    regex: /\b(curl|wget|fetch|Invoke-WebRequest|Invoke-RestMethod)\b/i,
    reason: "Uncontrolled external network download in lifecycle script",
    risk: "critical",
  },
  {
    regex: /\b(bash\s+-c|sh\s+-c|cmd\.exe\s+\/c|powershell\s+-Command|eval\(|exec\()\b/i,
    reason: "Arbitrary shell invocation or code evaluation",
    risk: "critical",
  },
  {
    regex: /(\/dev\/tcp|\bnet\.Socket\b|\bsocket\.socket\b)/i,
    reason: "Direct raw network socket or reverse-shell primitive",
    risk: "critical",
  },
  {
    regex: /((\.ssh|\.aws|\.env|id_rsa|\/etc\/passwd|%APPDATA%))/i,
    reason: "Sensitive credential directory access attempt",
    risk: "critical",
  },
  {
    regex: /(Buffer\.from\(.*base64|atob\(|from_base64|\\x[0-9a-f]{2})/i,
    reason: "Obfuscated payload encoding detected",
    risk: "critical",
  },
  {
    regex: /\b(node-gyp|make|gcc|clang)\b/i,
    reason: "Native C/C++ compilation toolchain invocation",
    risk: "medium",
  },
];

/**
 * Inspects a script string for supply-chain risks.
 */
export function analyzeLifecycleScript(hook: LifecycleHook, scriptCommand: string): DetectedScript {
  const reasons: string[] = [];
  let highestRisk: "low" | "medium" | "critical" = "low";

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.regex.test(scriptCommand)) {
      reasons.push(pattern.reason);
      if (pattern.risk === "critical") {
        highestRisk = "critical";
      } else if (highestRisk === "low" && pattern.risk === "medium") {
        highestRisk = "medium";
      }
    }
  }

  if (reasons.length === 0) {
    reasons.push("Standard lifecycle script execution");
  }

  return {
    hook,
    command: scriptCommand,
    risk: highestRisk,
    reasons,
  };
}

/**
 * Pre-flight scanner inspecting an npm package's metadata for lifecycle scripts.
 */
export async function scanPackageLifecycleScripts(
  pkgName: string,
  version?: string,
  options?: { allowScripts?: string[] },
): Promise<SandboxScanResult> {
  const isAllowed = options?.allowScripts?.includes(pkgName) ?? false;

  try {
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(registryUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // Offline or non-existent, return safe fallback
      return {
        safe: true,
        package: pkgName,
        scripts: [],
        blocked: false,
        neutralized: true,
      };
    }

    const data = (await res.json()) as {
      "dist-tags"?: { latest?: string };
      versions?: Record<string, { scripts?: Record<string, string> }>;
    };

    const targetVersion = version || data["dist-tags"]?.latest;
    const versionData = targetVersion && data.versions ? data.versions[targetVersion] : undefined;
    const scriptsObj = versionData?.scripts || {};

    const hooks: LifecycleHook[] = [
      "preinstall",
      "install",
      "postinstall",
      "prepublish",
      "prepublishOnly",
    ];

    const detected: DetectedScript[] = [];
    for (const hook of hooks) {
      if (scriptsObj[hook]) {
        detected.push(analyzeLifecycleScript(hook, scriptsObj[hook]));
      }
    }

    const hasCritical = detected.some((d) => d.risk === "critical");
    const blocked = hasCritical && !isAllowed;

    return {
      safe: !hasCritical,
      package: pkgName,
      scripts: detected,
      blocked,
      neutralized: !blocked && detected.length > 0,
      details: hasCritical
        ? `Package '${pkgName}' contains critical lifecycle script (${detected.find((d) => d.risk === "critical")?.command})`
        : detected.length > 0
          ? `Package '${pkgName}' contains ${detected.length} lifecycle script(s)`
          : undefined,
      remediation: blocked
        ? `Neutralized by sandbox. Run with --allow-scripts=${pkgName} if this script is verified safe.`
        : undefined,
    };
  } catch {
    // If network fails or registry is unreachable, neutralize safely
    return {
      safe: true,
      package: pkgName,
      scripts: [],
      blocked: false,
      neutralized: true,
    };
  }
}
