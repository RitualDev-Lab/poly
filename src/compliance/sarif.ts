import type { AuditReport } from "./types.js";

/**
 * Generates an OASIS standard SARIF v2.1.0 payload for GitHub Security and SonarQube.
 */
export function generateSarifReport(report: AuditReport): string {
  const rules = report.findings.map((f) => ({
    id: f.id,
    name: `Vulnerability in ${f.packageName}`,
    shortDescription: { text: f.summary },
    fullDescription: { text: f.details || f.summary },
    help: {
      text: `Package: ${f.packageName} (${f.ecosystem})\nInstalled: ${f.installedVersion}\nFixed in: ${
        f.fixedVersion ?? "No fix available"
      }\nReference: ${f.referenceUrl ?? "N/A"}`,
      markdown: `**Package**: \`${f.packageName}\` (\`${f.ecosystem}\`)\n\n**Installed Version**: \`${
        f.installedVersion
      }\`\n\n**Remediation**: Upgrade to version \`${
        f.fixedVersion ?? "latest"
      }\`.\n\n[View OSV Advisory](${f.referenceUrl ?? "#"})`,
    },
    defaultConfiguration: {
      level: f.severity === "CRITICAL" || f.severity === "HIGH" ? "error" : "warning",
    },
    properties: {
      severity: f.severity,
      cvssScore: f.cvssScore,
    },
  }));

  const results = report.findings.map((f) => {
    const level = f.severity === "CRITICAL" || f.severity === "HIGH" ? "error" : "warning";
    const remediation = f.fixedVersion ? ` Upgrade ${f.packageName} to ${f.fixedVersion}.` : "";

    return {
      ruleId: f.id,
      level,
      message: {
        text: `[${f.severity}] Vulnerability in ${f.packageName}@${f.installedVersion}: ${f.summary}.${remediation}`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: `${f.memberPath}/poly.lock`,
            },
            region: {
              startLine: 1,
              startColumn: 1,
            },
          },
        },
      ],
    };
  });

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "poly",
            version: "0.1.0",
            informationUri: "https://ritualdev.in/poly",
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
