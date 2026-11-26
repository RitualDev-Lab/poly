import type { PackageSpec } from "../../types.js";
import { cleanVersionSpec, escapeRegex } from "./file-helpers.js";

export interface SwiftTargetSpec {
  url: string;
  packageName: string;
  productName: string;
  version?: string;
}

/**
 * Normalizes Swift Package Manager URL/product specifiers from shorthands or PURLs.
 */
export function normalizeSwiftPackageSpec(pkg: PackageSpec): SwiftTargetSpec {
  const rawName = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;
  const version = cleanVersionSpec(pkg.version);

  let url = rawName;
  if (/^https?:\/\//i.test(rawName)) {
    url = rawName.endsWith(".git") ? rawName : `${rawName}.git`;
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(rawName)) {
    url = `https://${rawName.endsWith(".git") ? rawName : `${rawName}.git`}`;
  } else if (rawName.includes("/")) {
    url = `https://github.com/${rawName.endsWith(".git") ? rawName : `${rawName}.git`}`;
  }

  const repoTail =
    rawName
      .replace(/\.git$/i, "")
      .split("/")
      .pop() ?? rawName;
  return {
    url,
    packageName: repoTail,
    productName: repoTail,
    version,
  };
}

/**
 * Safely mutates Apple `Package.swift` (package-level `dependencies:` + `.target` link).
 */
export function mutatePackageSwift(
  content: string,
  action: "add" | "remove",
  pkg: PackageSpec,
): string {
  const spec = normalizeSwiftPackageSpec(pkg);
  const urlNoGit = spec.url.replace(/\.git$/i, "");
  const urlEsc = escapeRegex(urlNoGit);
  const pkgNameEsc = escapeRegex(spec.packageName);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";

  const pkgDepRegex = new RegExp(
    `^[ \\t]*\\.package\\(\\s*url:\\s*["']${urlEsc}(?:\\.git)?["'][^\\r\\n]*\\),?\\r?\\n?`,
    "m",
  );
  const productDepRegex = new RegExp(
    `^[ \\t]*\\.product\\([^\\r\\n]*package:\\s*["']${pkgNameEsc}["'][^\\r\\n]*\\),?\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(pkgDepRegex, "").replace(productDepRegex, "");
  }

  const ver = spec.version ?? "1.0.0";
  let next = content;

  const existingPkg = next.match(pkgDepRegex);
  if (existingPkg) {
    const updatedPkg = existingPkg[0].replace(
      /(\b(?:from|exact)\s*:\s*["'])([^"']+)(["'])/,
      `$1${ver}$3`,
    );
    next = next.replace(existingPkg[0], updatedPkg);
  } else {
    const pkgDecl = `.package(url: "${spec.url}", from: "${ver}"),`;
    const rootDepsMatch = next.match(/(^[ \t]*dependencies\s*:\s*\[)([\s\S]*?)(\r?\n[ \t]*\])/m);
    if (rootDepsMatch) {
      const inner = rootDepsMatch[2];
      const baseIndent = rootDepsMatch[1].match(/^[ \t]*/)?.[0] ?? "    ";
      const itemIndent = `${baseIndent}    `;
      if (inner.trim().length === 0) {
        next = next.replace(
          rootDepsMatch[0],
          `${rootDepsMatch[1]}${eol}${itemIndent}${pkgDecl}${rootDepsMatch[3]}`,
        );
      } else {
        const stripped = inner.replace(/\s+$/, "");
        const needsComma = !stripped.endsWith(",");
        next = next.replace(
          rootDepsMatch[0],
          `${rootDepsMatch[1]}${stripped}${needsComma ? "," : ""}${eol}${itemIndent}${pkgDecl}${rootDepsMatch[3]}`,
        );
      }
    } else {
      next = next.replace(
        /(^[ \t]*)(dependencies\s*:\s*)\[\s*\]/m,
        `$1$2[${eol}$1    ${pkgDecl}${eol}$1]`,
      );
    }
  }

  if (!productDepRegex.test(next)) {
    const targetBlockRegex =
      /((\.(?:executableTarget|target)\([\s\S]*?^[ \t]*dependencies\s*:\s*)\[)([\s\S]*?)(\r?\n([ \t]*)\])/m;
    const tMatch = next.match(targetBlockRegex);
    if (tMatch) {
      const inner = tMatch[3];
      const baseIndent = tMatch[5] ?? "            ";
      const itemIndent = `${baseIndent}    `;
      const prodLine = `.product(name: "${spec.productName}", package: "${spec.packageName}"),`;
      if (inner.trim().length === 0) {
        next = next.replace(tMatch[0], `${tMatch[2]}[${eol}${itemIndent}${prodLine}${tMatch[4]}`);
      } else {
        const stripped = inner.replace(/\s+$/, "");
        const needsComma = !stripped.endsWith(",");
        next = next.replace(
          tMatch[0],
          `${tMatch[2]}[${stripped}${needsComma ? "," : ""}${eol}${itemIndent}${prodLine}${tMatch[4]}`,
        );
      }
    } else {
      const inlineTargetDeps =
        /(\.(?:executableTarget|target)\([\s\S]*?^([ \t]*)dependencies\s*:\s*)\[\s*\]/m;
      const inlineMatch = next.match(inlineTargetDeps);
      if (inlineMatch) {
        const indent = inlineMatch[2] ?? "            ";
        const prodLine = `.product(name: "${spec.productName}", package: "${spec.packageName}"),`;
        next = next.replace(
          inlineMatch[0],
          `${inlineMatch[1]}[${eol}${indent}    ${prodLine}${eol}${indent}]`,
        );
      }
    }
  }

  return next;
}

/**
 * Safely mutates CocoaPods `Podfile`.
 */
export function mutatePodfile(content: string, action: "add" | "remove", pkg: PackageSpec): string {
  const podEsc = escapeRegex(pkg.name);
  const podLineRegex = new RegExp(
    `^[ \\t]*pod\\s+["']${podEsc}["'](?:\\s*,\\s*["']([^"']+)["'])?[^\\r\\n]*\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(podLineRegex, "");
  }

  const cleanVer = cleanVersionSpec(pkg.version);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const newPodLine = cleanVer ? `pod '${pkg.name}', '~> ${cleanVer}'` : `pod '${pkg.name}'`;

  const existing = content.match(podLineRegex);
  if (existing) {
    const indent = existing[0].match(/^[ \t]*/)?.[0] ?? "  ";
    return content.replace(existing[0], `${indent}${newPodLine}${eol}`);
  }

  const targetMatch = content.match(/(^[ \t]*target\s+["'][^"']+["']\s+do\r?\n)/m);
  if (targetMatch) {
    const targetIndent = targetMatch[1].match(/^[ \t]*/)?.[0] ?? "";
    const itemIndent = `${targetIndent}  `;
    return content.replace(targetMatch[0], `${targetMatch[0]}${itemIndent}${newPodLine}${eol}`);
  }

  const sep = content.length === 0 || content.endsWith("\n") ? "" : eol;
  return `${content}${sep}${newPodLine}${eol}`;
}

/**
 * Safely mutates Carthage `Cartfile`.
 */
export function mutateCartfile(
  content: string,
  action: "add" | "remove",
  pkg: PackageSpec,
): string {
  const fullName = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name;
  const escapedName = escapeRegex(fullName);
  const entryRegex = new RegExp(
    `^(?:github|git|binary)\\s+["']${escapedName}["'][^\\r\\n]*\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(entryRegex, "");
  }

  const cleanVer = cleanVersionSpec(pkg.version);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const constraint = cleanVer ? ` ~> ${cleanVer}` : "";
  const origin = fullName.startsWith("http") ? "git" : "github";
  const line = `${origin} "${fullName}"${constraint}${eol}`;

  const existing = content.match(entryRegex);
  if (existing) {
    return content.replace(existing[0], line);
  }

  const sep = content.length === 0 || content.endsWith("\n") ? "" : eol;
  return `${content}${sep}${line}`;
}
