import type { PackageSpec } from "../../types.js";
import { cleanVersionSpec, escapeRegex } from "./file-helpers.js";

export interface MavenCoordinates {
  groupId: string;
  artifactId: string;
  version?: string;
}

/**
 * Normalizes Maven/Gradle/sbt coordinates from `group:artifact`, `group/artifact`, or `namespace/name`.
 */
export function parseJvmCoordinates(pkg: PackageSpec): MavenCoordinates {
  const version = cleanVersionSpec(pkg.version);
  if (pkg.namespace) {
    return {
      groupId: pkg.namespace.replace(/^@/, ""),
      artifactId: pkg.name,
      version,
    };
  }
  if (pkg.name.includes(":")) {
    const [groupId, artifactId] = pkg.name.split(":", 2);
    return { groupId: groupId.trim(), artifactId: artifactId.trim(), version };
  }
  if (pkg.name.includes("/")) {
    const [groupId, artifactId] = pkg.name.split("/", 2);
    return { groupId: groupId.trim(), artifactId: artifactId.trim(), version };
  }
  return { groupId: "org.example", artifactId: pkg.name.trim(), version };
}

/**
 * Safely mutates a Maven pom.xml manifest (add/upsert or remove `<dependency>` block).
 */
export function mutatePomXml(content: string, action: "add" | "remove", pkg: PackageSpec): string {
  const { groupId, artifactId, version } = parseJvmCoordinates(pkg);
  const gEsc = escapeRegex(groupId);
  const aEsc = escapeRegex(artifactId);

  const depBlockRegex = new RegExp(
    `[ \\t]*<dependency>\\s*<groupId>${gEsc}</groupId>\\s*<artifactId>${aEsc}</artifactId>[\\s\\S]*?</dependency>\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(depBlockRegex, "");
  }

  const verLine = version ?? "RELEASE";
  const existing = content.match(depBlockRegex);
  if (existing) {
    const versionTagRegex = /(<version>)([^<]*)(<\/version>)/;
    if (versionTagRegex.test(existing[0])) {
      const updatedBlock = existing[0].replace(versionTagRegex, `$1${verLine}$3`);
      return content.replace(existing[0], updatedBlock);
    }
    return content;
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const scopeTag = pkg.isDev ? `${eol}            <scope>test</scope>` : "";

  const depsCloseMatch = content.match(/^([ \t]*)<\/dependencies>/m);
  if (depsCloseMatch) {
    const baseIndent = depsCloseMatch[1];
    const depIndent = `${baseIndent}    `;
    const propIndent = `${depIndent}    `;
    const scopeLine = pkg.isDev ? `${eol}${propIndent}<scope>test</scope>` : "";
    const block =
      `${depIndent}<dependency>${eol}` +
      `${propIndent}<groupId>${groupId}</groupId>${eol}` +
      `${propIndent}<artifactId>${artifactId}</artifactId>${eol}` +
      `${propIndent}<version>${verLine}</version>${scopeLine}${eol}` +
      `${depIndent}</dependency>${eol}`;

    return content.replace(depsCloseMatch[0], `${block}${depsCloseMatch[0]}`);
  }

  const projectCloseMatch = content.match(/^([ \t]*)<\/project>/m);
  if (projectCloseMatch) {
    const baseIndent = `${projectCloseMatch[1]}    `;
    const depIndent = `${baseIndent}    `;
    const propIndent = `${depIndent}    `;
    const block =
      `${baseIndent}<dependencies>${eol}` +
      `${depIndent}<dependency>${eol}` +
      `${propIndent}<groupId>${groupId}</groupId>${eol}` +
      `${propIndent}<artifactId>${artifactId}</artifactId>${eol}` +
      `${propIndent}<version>${verLine}</version>${scopeTag}${eol}` +
      `${depIndent}</dependency>${eol}` +
      `${baseIndent}</dependencies>${eol}`;
    return content.replace(projectCloseMatch[0], `${block}${projectCloseMatch[0]}`);
  }

  return content;
}

/**
 * Safely mutates an Apache Ivy `ivy.xml` manifest.
 */
export function mutateIvyXml(content: string, action: "add" | "remove", pkg: PackageSpec): string {
  const { groupId, artifactId, version } = parseJvmCoordinates(pkg);
  const gEsc = escapeRegex(groupId);
  const aEsc = escapeRegex(artifactId);

  const tagRegex = new RegExp(
    `[ \\t]*<dependency\\b[^>]*org=["']${gEsc}["'][^>]*name=["']${aEsc}["'][^>]*/?>\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(tagRegex, "");
  }

  const ver = version ?? "latest.release";
  const existing = content.match(tagRegex);
  if (existing) {
    const updatedTag = existing[0].replace(/(\brev=["'])([^"']*)(["'])/, `$1${ver}$3`);
    return content.replace(existing[0], updatedTag);
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const closeMatch = content.match(/^([ \t]*)<\/dependencies>/m);
  if (closeMatch) {
    const indent = `${closeMatch[1]}    `;
    const conf = pkg.isDev ? ' conf="test->default"' : "";
    const tag = `${indent}<dependency org="${groupId}" name="${artifactId}" rev="${ver}"${conf}/>${eol}`;
    return content.replace(closeMatch[0], `${tag}${closeMatch[0]}`);
  }

  return content;
}

function toCatalogAlias(artifactId: string): string {
  return artifactId.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
}

/**
 * Safely mutates Gradle Version Catalog (`gradle/libs.versions.toml`).
 */
export function mutateGradleCatalog(
  content: string,
  action: "add" | "remove",
  pkg: PackageSpec,
): string {
  const { groupId, artifactId, version } = parseJvmCoordinates(pkg);
  const alias = toCatalogAlias(artifactId);
  const gEsc = escapeRegex(groupId);
  const aEsc = escapeRegex(artifactId);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";

  const libLineRegex = new RegExp(
    `^([a-zA-Z0-9_-]+)\\s*=\\s*\\{[^\\r\\n]*(?:module\\s*=\\s*["']${gEsc}:${aEsc}["']|group\\s*=\\s*["']${gEsc}["'][^\\r\\n]*name\\s*=\\s*["']${aEsc}["'])[^\\r\\n]*\\}\\r?\\n?`,
    "m",
  );

  const match = content.match(libLineRegex);
  if (action === "remove") {
    if (!match) return content;
    const matchedLine = match[0];
    const verRefMatch = matchedLine.match(/version\.ref\s*=\s*["']([^"']+)["']/);
    let next = content.replace(matchedLine, "");
    if (verRefMatch?.[1]) {
      const refEsc = escapeRegex(verRefMatch[1]);
      if (!new RegExp(`version\\.ref\\s*=\\s*["']${refEsc}["']`).test(next)) {
        next = next.replace(new RegExp(`^${refEsc}\\s*=\\s*["'][^"']*["']\\r?\\n?`, "m"), "");
      }
    }
    return next;
  }

  const ver = version ?? "latest";
  if (match) {
    const matchedLine = match[0];
    const verRefMatch = matchedLine.match(/version\.ref\s*=\s*["']([^"']+)["']/);
    if (verRefMatch?.[1]) {
      const refEsc = escapeRegex(verRefMatch[1]);
      return content.replace(
        new RegExp(`^(${refEsc}\\s*=\\s*["'])([^"']*)(["'])`, "m"),
        `$1${ver}$3`,
      );
    }
    const directVerMatch = matchedLine.match(/(\bversion\s*=\s*["'])([^"']*)(["'])/);
    if (directVerMatch) {
      return content.replace(matchedLine, matchedLine.replace(directVerMatch[0], `$1${ver}$3`));
    }
    return content;
  }

  let next = content;
  const verKey = alias;
  if (/^\[versions\]/m.test(next)) {
    const verPropRegex = new RegExp(`^(${escapeRegex(verKey)}\\s*=\\s*["'])([^"']*)(["'])`, "m");
    if (verPropRegex.test(next)) {
      next = next.replace(verPropRegex, `$1${ver}$3`);
    } else {
      next = next.replace(
        /^\[versions\][ \t]*\r?\n?/m,
        (hdr) => `${hdr}${verKey} = "${ver}"${eol}`,
      );
    }
  } else {
    next = `[versions]${eol}${verKey} = "${ver}"${eol}${eol}${next}`;
  }

  const libEntry = `${alias} = { group = "${groupId}", name = "${artifactId}", version.ref = "${verKey}" }${eol}`;
  if (/^\[libraries\]/m.test(next)) {
    next = next.replace(/^\[libraries\][ \t]*\r?\n?/m, (hdr) => `${hdr}${libEntry}`);
  } else {
    const sep = next.endsWith("\n") ? eol : `${eol}${eol}`;
    next = `${next}${sep}[libraries]${eol}${libEntry}`;
  }

  return next;
}

/**
 * Safely mutates `build.gradle` (Groovy) or `build.gradle.kts` (Kotlin DSL).
 */
export function mutateGradleBuild(
  content: string,
  action: "add" | "remove",
  pkg: PackageSpec,
  isKotlinDsl = false,
): string {
  const { groupId, artifactId, version } = parseJvmCoordinates(pkg);
  const coordPrefixEsc = escapeRegex(`${groupId}:${artifactId}`);

  const depRegex = new RegExp(
    `^[ \\t]*(?:testImplementation|implementation|api|compileOnly|runtimeOnly)\\s*(?:\\(\\s*)?["']${coordPrefixEsc}(?::([^"']*))?["']\\s*\\)?\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(depRegex, "");
  }

  const ver = version ?? "latest.release";
  const existing = content.match(depRegex);
  if (existing) {
    const updatedLine = existing[0].replace(
      new RegExp(`(["'])${coordPrefixEsc}(?::[^"']*)?(["'])`),
      `$1${groupId}:${artifactId}:${ver}$2`,
    );
    return content.replace(existing[0], updatedLine);
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const cfg = pkg.isDev ? "testImplementation" : "implementation";
  const lineBody = isKotlinDsl
    ? `${cfg}("${groupId}:${artifactId}:${ver}")`
    : `${cfg} '${groupId}:${artifactId}:${ver}'`;

  const depsBlockRegex = /^([ \t]*)dependencies\s*\{[\s\S]*?^\1\}/m;
  const blockMatch = content.match(depsBlockRegex);
  if (blockMatch) {
    const blockIndent = blockMatch[1];
    const itemIndent = `${blockIndent}    `;
    const closeToken = `${blockIndent}}`;
    const lastIdx = blockMatch[0].lastIndexOf(closeToken);
    if (lastIdx !== -1) {
      const updatedBlock =
        `${blockMatch[0].slice(0, lastIdx)}` +
        `${itemIndent}${lineBody}${eol}` +
        `${blockMatch[0].slice(lastIdx)}`;
      return content.replace(blockMatch[0], updatedBlock);
    }
  }

  const prefix = content.endsWith("\n") ? eol : `${eol}${eol}`;
  return `${content}${prefix}dependencies {${eol}    ${lineBody}${eol}}${eol}`;
}

/**
 * Safely mutates Scala sbt `build.sbt`.
 */
export function mutateSbtBuild(
  content: string,
  action: "add" | "remove",
  pkg: PackageSpec,
): string {
  const { groupId, artifactId, version } = parseJvmCoordinates(pkg);
  const gEsc = escapeRegex(groupId);
  const aEsc = escapeRegex(artifactId);

  const singleLineRegex = new RegExp(
    `^[ \\t]*libraryDependencies\\s*\\+=\\s*["']${gEsc}["']\\s*%{1,2}\\s*["']${aEsc}["']\\s*%\\s*["']([^"']+)["'](?:\\s*%\\s*Test)?\\r?\\n?`,
    "m",
  );
  const tupleEntryRegex = new RegExp(
    `^[ \\t]*["']${gEsc}["']\\s*%{1,2}\\s*["']${aEsc}["']\\s*%\\s*["']([^"']+)["'](?:\\s*%\\s*Test)?,?\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(singleLineRegex, "").replace(tupleEntryRegex, "");
  }

  const ver = version ?? "latest.integration";
  const verReplaceRegex = new RegExp(`(["']${aEsc}["']\\s*%\\s*["'])([^"']+)(["'])`);
  const singleExisting = content.match(singleLineRegex);
  if (singleExisting) {
    const updated = singleExisting[0].replace(verReplaceRegex, `$1${ver}$3`);
    return content.replace(singleExisting[0], updated);
  }

  const tupleExisting = content.match(tupleEntryRegex);
  if (tupleExisting) {
    const updated = tupleExisting[0].replace(verReplaceRegex, `$1${ver}$3`);
    return content.replace(tupleExisting[0], updated);
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const testSuffix = pkg.isDev ? " % Test" : "";
  const seqMatch = content.match(/libraryDependencies\s*\+\+=\s*Seq\s*\(([\s\S]*?)\)/);
  if (seqMatch) {
    const inner = seqMatch[1];
    const hasItems = inner.trim().length > 0;
    const normalizedInner = hasItems ? `${inner.replace(/[,\s]+$/, "")},${eol}` : eol;
    const entry = `  "${groupId}" %% "${artifactId}" % "${ver}"${testSuffix}${eol}`;
    return content.replace(seqMatch[0], `libraryDependencies ++= Seq(${normalizedInner}${entry})`);
  }

  const newLine = `libraryDependencies += "${groupId}" %% "${artifactId}" % "${ver}"${testSuffix}${eol}`;
  const sep = content.length === 0 || content.endsWith("\n") ? "" : eol;
  return `${content}${sep}${newLine}`;
}
