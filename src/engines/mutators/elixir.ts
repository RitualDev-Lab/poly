import type { PackageSpec } from "../../types.js";
import { cleanVersionSpec, escapeRegex } from "./file-helpers.js";

/**
 * Safely mutates Elixir `mix.exs` inside `defp deps do [ ... ] end`.
 */
export function mutateMixExs(content: string, action: "add" | "remove", pkg: PackageSpec): string {
  const pkgEsc = escapeRegex(pkg.name);
  const entryRegex = new RegExp(
    `^[ \\t]*\\{:${pkgEsc},\\s*["']([^"']+)["'][^\\r\\n]*\\},?\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(entryRegex, "");
  }

  const rawVer = cleanVersionSpec(pkg.version);
  const constraint = rawVer ? `~> ${rawVer}` : ">= 0.0.0";
  const existing = content.match(entryRegex);
  if (existing) {
    const updated = existing[0].replace(
      new RegExp(`(\\{:${pkgEsc},\\s*["'])([^"']+)(["'])`),
      `$1${constraint}$3`,
    );
    return content.replace(existing[0], updated);
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const devOpt = pkg.isDev ? ", only: [:dev, :test]" : "";
  const entryBody = `{:${pkg.name}, "${constraint}"${devOpt}}`;

  const depsBlockRegex = /(defp\s+deps\s+do\s*\r?\n([ \t]*)\[)([\s\S]*?)(\r?\n\2\])/;
  const match = content.match(depsBlockRegex);
  if (match) {
    const listIndent = match[2];
    const itemIndent = `${listIndent}  `;
    const inner = match[3];
    if (inner.trim().length === 0) {
      return content.replace(match[0], `${match[1]}${eol}${itemIndent}${entryBody}${match[4]}`);
    }
    const withoutTrailing = inner.replace(/\s+$/, "");
    const needsComma = !withoutTrailing.endsWith(",");
    const updatedInner = `${withoutTrailing}${needsComma ? "," : ""}${eol}${itemIndent}${entryBody}`;
    return content.replace(match[0], `${match[1]}${updatedInner}${match[4]}`);
  }

  const inlineEmptyMatch = content.match(/(defp\s+deps\s+do\s*\r?\n([ \t]*))\[\s*\]/);
  if (inlineEmptyMatch) {
    const listIndent = inlineEmptyMatch[2];
    const itemIndent = `${listIndent}  `;
    return content.replace(
      inlineEmptyMatch[0],
      `${inlineEmptyMatch[1]}[${eol}${itemIndent}${entryBody}${eol}${listIndent}]`,
    );
  }

  return content;
}

/**
 * Safely mutates Erlang `rebar.config` `{deps, [ ... ]}.`.
 */
export function mutateRebarConfig(
  content: string,
  action: "add" | "remove",
  pkg: PackageSpec,
): string {
  const pkgEsc = escapeRegex(pkg.name);
  const tupleRegex = new RegExp(
    `^[ \\t]*(?:\\{${pkgEsc},\\s*["']([^"']+)["']\\}|${pkgEsc}),?\\r?\\n?`,
    "m",
  );

  if (action === "remove") {
    return content.replace(tupleRegex, "");
  }

  const rawVer = cleanVersionSpec(pkg.version);
  const newItem = rawVer ? `{${pkg.name}, "${rawVer}"}` : pkg.name;

  const existing = content.match(tupleRegex);
  if (existing && rawVer) {
    const hasComma = existing[0].trimEnd().endsWith(",");
    const indent = existing[0].match(/^[ \t]*/)?.[0] ?? "  ";
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    return content.replace(existing[0], `${indent}${newItem}${hasComma ? "," : ""}${eol}`);
  }
  if (existing) {
    return content;
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const depsMatch = content.match(/(\{deps,\s*\[)([\s\S]*?)(\]\}\s*\.)/);
  if (depsMatch) {
    const inner = depsMatch[2];
    if (inner.trim().length === 0) {
      return content.replace(
        depsMatch[0],
        `${depsMatch[1]}${eol}  ${newItem}${eol}${depsMatch[3]}`,
      );
    }
    const stripped = inner.replace(/\s+$/, "");
    const needsComma = !stripped.endsWith(",");
    const updated = `${depsMatch[1]}${stripped}${needsComma ? "," : ""}${eol}  ${newItem}${eol}${depsMatch[3]}`;
    return content.replace(depsMatch[0], updated);
  }

  const sep = content.length === 0 || content.endsWith("\n") ? "" : eol;
  return `${content}${sep}{deps, [${eol}  ${newItem}${eol}]}.${eol}`;
}
