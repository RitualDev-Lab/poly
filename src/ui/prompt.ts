import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import type { Ecosystem, ManifestContext } from "../types.js";

/**
 * Prompts the user to resolve an ambiguous package target when multiple manifests exist in CWD.
 */
export async function promptDisambiguation(
  packageName: string,
  conflicts: ManifestContext[],
): Promise<Ecosystem> {
  const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!isTty) {
    const options = conflicts.map((c) => `'${c.ecosystem}:${packageName}'`).join(" or ");
    throw new Error(
      `Ambiguous package '${packageName}'. Multiple manifests found (${conflicts
        .map((c) => c.manifestFile)
        .join(", ")}).\n` +
        `Remediation: In non-interactive environments, provide an explicit ecosystem prefix, e.g.: ${options}`,
    );
  }

  console.log(`\n🔍 Multiple project ecosystems detected for package '${packageName}':`);
  conflicts.forEach((c, idx) => {
    console.log(`  [${idx + 1}] ${c.ecosystem.toUpperCase()} (${c.manifestFile})`);
  });

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`Select ecosystem [1-${conflicts.length}] (default: 1): `);
    const chosenIdx = answer.trim() ? Number.parseInt(answer.trim(), 10) - 1 : 0;

    if (Number.isNaN(chosenIdx) || chosenIdx < 0 || chosenIdx >= conflicts.length) {
      console.log("Invalid selection. Defaulting to first ecosystem.");
      return conflicts[0].ecosystem;
    }

    return conflicts[chosenIdx].ecosystem;
  } finally {
    rl.close();
  }
}
