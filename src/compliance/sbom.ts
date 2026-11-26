import crypto from "node:crypto";
import fs from "node:fs";
import { engineRegistry } from "../engines/registry.js";
import { readCompositeLockfile } from "../workspace/lockfile.js";
import { LicenseAuditor } from "./licenses.js";
import type { SbomOptions } from "./types.js";

export class SbomGenerator {
  private licenseAuditor = new LicenseAuditor();

  /**
   * Generates a compliant CycloneDX or SPDX Software Bill of Materials.
   */
  generate(workspaceDir: string, options: SbomOptions): string {
    const lock = readCompositeLockfile(workspaceDir);
    const licenseReport = this.licenseAuditor.scan(workspaceDir);

    const docName = options.workspaceName ?? lock?.meta.generatedBy ?? "poly-workspace";
    const docVer = options.workspaceVersion ?? "0.1.0";

    let resultJson: string;
    if (options.format === "spdx") {
      resultJson = this.generateSpdx(docName, docVer, licenseReport.packages);
    } else {
      resultJson = this.generateCycloneDx(docName, docVer, licenseReport.packages);
    }

    if (options.output) {
      fs.writeFileSync(options.output, resultJson, "utf-8");
    }

    return resultJson;
  }

  private generateCycloneDx(
    name: string,
    version: string,
    packages: Array<{ packageName: string; ecosystem: string; version: string; license: string }>,
  ): string {
    const serialUuid = crypto.randomUUID();

    const components = packages.map((pkg) => {
      const purlEcosystem = engineRegistry.getSbomPurlType(pkg.ecosystem);
      return {
        type: "library",
        name: pkg.packageName,
        version: pkg.version.replace(/^[~^>=<]/, ""),
        purl: `pkg:${purlEcosystem}/${pkg.packageName}@${pkg.version.replace(/^[~^>=<]/, "")}`,
        licenses: [
          {
            license: {
              id: pkg.license,
            },
          },
        ],
      };
    });

    const bom = {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      serialNumber: `urn:uuid:${serialUuid}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [
          {
            vendor: "RitualDev Lab",
            name: "poly",
            version: "0.1.0",
          },
        ],
        component: {
          type: "application",
          name,
          version,
        },
      },
      components,
    };

    return JSON.stringify(bom, null, 2);
  }

  private generateSpdx(
    name: string,
    version: string,
    packages: Array<{ packageName: string; ecosystem: string; version: string; license: string }>,
  ): string {
    const spdxPackages = packages.map((pkg, idx) => {
      const safeId = pkg.packageName.replace(/[^a-zA-Z0-9]/g, "-");
      const purlEcosystem = engineRegistry.getSbomPurlType(pkg.ecosystem);
      return {
        name: pkg.packageName,
        SPDXID: `SPDXRef-Package-${safeId}-${idx}`,
        versionInfo: pkg.version.replace(/^[~^>=<]/, ""),
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: pkg.license,
        licenseDeclared: pkg.license,
        copyrightText: "NOASSERTION",
        externalRefs: [
          {
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: `pkg:${purlEcosystem}/${pkg.packageName}@${pkg.version.replace(/^[~^>=<]/, "")}`,
          },
        ],
      };
    });

    const doc = {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name,
      documentNamespace: `https://ritualdev.in/spdx/${name}-${version}-${Date.now()}`,
      creationInfo: {
        created: new Date().toISOString(),
        creators: ["Tool: poly-0.1.0", "Organization: RitualDev Lab"],
      },
      packages: [
        {
          name,
          SPDXID: "SPDXRef-RootPackage",
          versionInfo: version,
          downloadLocation: "NOASSERTION",
          filesAnalyzed: false,
          licenseConcluded: "MIT",
        },
        ...spdxPackages,
      ],
    };

    return JSON.stringify(doc, null, 2);
  }
}
