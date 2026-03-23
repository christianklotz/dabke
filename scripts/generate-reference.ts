#!/usr/bin/env tsx

/**
 * Generates API reference documentation from TSDoc in the source files.
 *
 * Two modes:
 *
 *   1. Default (no args): writes api.md, llms.txt, src/llms.ts to the
 *      package root. Used for the published npm package.
 *
 *   2. --outdir <path>: writes per-section markdown files and a README.md
 *      index to the given directory. Used by the tile build script to
 *      populate the skill's references/ folder.
 *
 * Symbols opt in via `@category <Section Name>` in their TSDoc. The
 * generator discovers all categorized exports, groups them by category,
 * and renders them in the order defined by SECTION_ORDER.
 *
 * TSDoc filtering:
 *   - `@category` controls inclusion and grouping
 *   - `@internal` members are excluded from interface property lists
 *   - `@privateRemarks` content is omitted
 *   - Only the first `@example` per symbol is rendered
 *   - `{@link Foo}` references are converted to plain `Foo` in output
 */

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// ============================================================================
// Document structure
// ============================================================================

interface SectionDef {
  heading: string;
  slug: string;
}

const SECTIONS: SectionDef[] = [
  { heading: "Schedule Definition", slug: "schedule" },
  { heading: "Time Periods", slug: "time-periods" },
  { heading: "Coverage", slug: "coverage" },
  { heading: "Shift Patterns", slug: "shift-patterns" },
  { heading: "Rules", slug: "rules" },
  { heading: "Cost Optimization", slug: "cost" },
  { heading: "Supporting Types", slug: "types" },
];

const SECTION_ORDER = SECTIONS.map((s) => s.heading);

function slugFor(heading: string): string {
  return (
    SECTIONS.find((s) => s.heading === heading)?.slug ?? heading.toLowerCase().replace(/\s+/g, "-")
  );
}

// ============================================================================
// TypeScript program setup
// ============================================================================

function createProgram(): ts.Program {
  const configPath = ts.findConfigFile(ROOT_DIR, ts.sys.fileExists, "tsconfig.json")!;
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT_DIR);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

// ============================================================================
// TSDoc extraction
// ============================================================================

function stripLinks(s: string): string {
  return s.replace(/\{@link\s+([^}\s]+)(?:\s+[^}]*)?\}/g, "`$1`");
}

function getJSDocNode(node: ts.Node): ts.JSDoc | undefined {
  const items = ts.getJSDocCommentsAndTags(node);
  const first = items[0];
  return first && ts.isJSDoc(first) ? first : undefined;
}

function isInternal(node: ts.Node): boolean {
  const doc = getJSDocNode(node);
  return doc?.tags?.some((t) => t.tagName.text === "internal") ?? false;
}

function extractCategory(node: ts.Node): string | undefined {
  const doc = getJSDocNode(node);
  if (!doc?.tags) return undefined;
  for (const tag of doc.tags) {
    if (tag.tagName.text === "category") {
      return (tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "").trim() || undefined;
    }
  }
  return undefined;
}

function extractJSDoc(node: ts.Node): string {
  const doc = getJSDocNode(node);
  if (!doc) return "";

  let result = doc.comment ? ts.getTextOfJSDocComment(doc.comment) || "" : "";
  let exampleRendered = false;

  for (const tag of doc.tags ?? []) {
    if (tag.tagName.text === "privateRemarks") continue;
    if (tag.tagName.text === "internal") continue;
    if (tag.tagName.text === "packageDocumentation") continue;
    if (tag.tagName.text === "module") continue;
    if (tag.tagName.text === "param") continue;
    if (tag.tagName.text === "returns") continue;
    if (tag.tagName.text === "category") continue;

    const text = tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "";
    if (!text) continue;
    if (tag.tagName.text === "remarks") result += `\n\n${text}`;
    if (tag.tagName.text === "example" && !exampleRendered) {
      result += `\n\n${text}`;
      exampleRendered = true;
    }
  }
  return stripLinks(result);
}

function extractReturnsDoc(node: ts.Node): string {
  const doc = getJSDocNode(node);
  if (!doc?.tags) return "";
  for (const tag of doc.tags) {
    if (tag.tagName.text === "returns") {
      return stripLinks(tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "");
    }
  }
  return "";
}

function extractParamDoc(node: ts.Node, paramName: string): string {
  const doc = getJSDocNode(node);
  if (!doc?.tags) return "";
  for (const tag of doc.tags) {
    if (
      tag.tagName.text === "param" &&
      ts.isJSDocParameterTag(tag) &&
      tag.name.getText() === paramName
    ) {
      return stripLinks(tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "");
    }
  }
  return "";
}

function extractPackageDoc(program: ts.Program, filePath: string): string {
  const sf = program.getSourceFile(filePath);
  if (!sf || sf.statements.length === 0) return "";

  const first = sf.statements[0]!;
  for (const item of ts.getJSDocCommentsAndTags(first)) {
    if (!ts.isJSDoc(item)) continue;
    if (!item.tags?.some((t) => t.tagName.text === "packageDocumentation")) continue;

    let result = item.comment ? ts.getTextOfJSDocComment(item.comment) || "" : "";
    for (const tag of item.tags ?? []) {
      if (tag.tagName.text === "privateRemarks") continue;
      const text = tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "";
      if (!text) continue;
      if (tag.tagName.text === "remarks") result += `\n\n${text}`;
      if (tag.tagName.text === "example") result += `\n\n${text}`;
    }
    return stripLinks(result);
  }
  return "";
}

// ============================================================================
// Type formatting
// ============================================================================

function sourceType(node: ts.Node): string | undefined {
  if (ts.isMethodSignature(node)) {
    const params = node.parameters
      .map((p) => `${p.name.getText()}: ${p.type?.getText() ?? "unknown"}`)
      .join(", ");
    const ret = node.type?.getText() ?? "void";
    return `(${params}) => ${ret}`;
  }
  const sig = node as ts.PropertySignature | ts.ParameterDeclaration;
  return sig.type?.getText();
}

function cleanImports(s: string): string {
  return s.replace(/import\(["'][^"']*["']\)\./g, "");
}

function typeToString(checker: ts.TypeChecker, node: ts.Node, maxLen = 2000): string {
  const type = checker.getTypeAtLocation(node);
  const raw = checker.typeToString(
    type,
    node,
    ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation,
  );
  const cleaned = cleanImports(raw);
  return cleaned.length > maxLen ? "[Complex type]" : cleaned;
}

// ============================================================================
// Symbol extraction
// ============================================================================

interface DocEntry {
  name: string;
  kind: "interface" | "type" | "function" | "const";
  description: string;
  summary: string;
  signature?: string;
  properties?: { name: string; type: string; description: string; optional: boolean }[];
  parameters?: { name: string; type: string; description: string; optional: boolean }[];
  returnType?: string;
  returnsDoc?: string;
}

function firstSentence(desc: string): string {
  if (!desc) return "";
  const match = desc.match(/^(.+?\.)\s/);
  if (match) return match[1]!;
  const firstLine = desc.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine;
}

function extractDocEntry(
  checker: ts.TypeChecker,
  name: string,
  node: ts.Node,
  sf: ts.SourceFile,
): DocEntry | undefined {
  if (ts.isInterfaceDeclaration(node)) {
    const description = extractJSDoc(node);
    return {
      name,
      kind: "interface",
      description,
      summary: firstSentence(description),
      properties: extractProperties(checker, node),
    };
  }
  if (ts.isTypeAliasDeclaration(node)) {
    const description = extractJSDoc(node);
    return {
      name,
      kind: "type",
      description,
      summary: firstSentence(description),
      signature: typeToString(checker, node.type),
    };
  }
  if (ts.isFunctionDeclaration(node)) {
    const docNode = findDocumentedOverload(sf, name) ?? node;
    const description = extractJSDoc(docNode);
    return {
      name,
      kind: "function",
      description,
      summary: firstSentence(description),
      parameters: docNode.parameters.map((p) => ({
        name: p.name.getText(),
        type: sourceType(p) ?? typeToString(checker, p),
        description: cleanParamDescription(extractParamDoc(docNode, p.name.getText())),
        optional: !!p.questionToken,
      })),
      returnType: docNode.type ? docNode.type.getText() : "void",
      returnsDoc: extractReturnsDoc(docNode),
    };
  }
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl) {
      const description = extractJSDoc(node);
      return {
        name,
        kind: "const",
        description,
        summary: firstSentence(description),
        signature: typeToString(checker, decl),
      };
    }
  }
  return undefined;
}

function cleanParamDescription(desc: string): string {
  return desc.replace(/^- /, "");
}

function findDocumentedOverload(
  sf: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined;
  ts.forEachChild(sf, (node) => {
    if (found) return;
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name &&
      !node.body &&
      getJSDocNode(node)
    ) {
      found = node;
    }
  });
  return found;
}

function getExportedName(node: ts.Node): string | undefined {
  const hasExport =
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!hasExport) return undefined;

  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node)
  ) {
    return node.name?.text;
  }
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return undefined;
}

function discoverCategories(program: ts.Program, checker: ts.TypeChecker): Map<string, DocEntry[]> {
  const groups = new Map<string, DocEntry[]>();
  const seen = new Set<string>();

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;

    ts.forEachChild(sf, (node) => {
      const name = getExportedName(node);
      if (!name || seen.has(name)) return;

      let categoryNode: ts.Node = node;
      if (ts.isFunctionDeclaration(node)) {
        const docOverload = findDocumentedOverload(sf, name);
        if (docOverload) categoryNode = docOverload;
      }

      const category = extractCategory(categoryNode);
      if (!category) return;
      seen.add(name);

      const entry = extractDocEntry(checker, name, node, sf);
      if (!entry) return;

      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(entry);
    });
  }

  return groups;
}

function extractProperties(
  checker: ts.TypeChecker,
  node: ts.InterfaceDeclaration,
): DocEntry["properties"] {
  if (node.members.length > 0) {
    return node.members
      .filter((m) => !isInternal(m))
      .map((m) => ({
        name: m.name?.getText() || "unknown",
        type: sourceType(m) ?? typeToString(checker, m),
        description: extractJSDoc(m),
        optional: !!(m as ts.PropertySignature).questionToken,
      }));
  }
  const type = checker.getTypeAtLocation(node);
  return checker.getPropertiesOfType(type).map((prop) => {
    const propType = checker.getTypeOfSymbol(prop);
    return {
      name: prop.getName(),
      type: cleanImports(
        checker.typeToString(
          propType,
          undefined,
          ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation,
        ),
      ),
      description: "",
      optional: !!(prop.flags & ts.SymbolFlags.Optional),
    };
  });
}

// ============================================================================
// Rendering: full doc entry (used in per-section files and monolithic output)
// ============================================================================

function renderFullDoc(doc: DocEntry): string {
  let out = `### \`${doc.name}\`\n\n`;
  if (doc.description) out += `${doc.description}\n\n`;

  if (doc.properties?.length) {
    out += "**Properties:**\n";
    for (const p of doc.properties) {
      const opt = p.optional ? "?" : "";
      out += `- \`${p.name}${opt}: ${p.type}\``;
      if (p.description) out += ` — ${p.description}`;
      out += "\n";
    }
    out += "\n";
  }

  if ((doc.kind === "type" || doc.kind === "const") && doc.signature) {
    out += `\`\`\`typescript\n${doc.signature}\n\`\`\`\n\n`;
  }

  if (doc.kind === "function" && doc.parameters?.length) {
    const hasParamDocs = doc.parameters.some((p) => p.description);
    if (hasParamDocs) {
      out += "**Parameters:**\n";
      for (const p of doc.parameters) {
        const opt = p.optional ? "?" : "";
        out += `- \`${p.name}${opt}: ${p.type}\``;
        if (p.description) out += ` — ${p.description}`;
        out += "\n";
      }
      out += "\n";
      if (doc.returnType || doc.returnsDoc) {
        let ret = "**Returns:**";
        if (doc.returnType) ret += ` \`${doc.returnType}\``;
        if (doc.returnsDoc) ret += ` — ${doc.returnsDoc}`;
        out += `${ret}\n\n`;
      }
    } else if (!doc.description?.includes("```")) {
      const params = doc.parameters
        .map((p) => {
          const opt = p.optional ? "?" : "";
          return `${p.name}${opt}: ${p.type}`;
        })
        .join(", ");
      const ret = doc.returnType ? `: ${doc.returnType}` : "";
      out += `\`\`\`ts\n${doc.name}(${params})${ret}\n\`\`\`\n\n`;
    }
  }

  return out;
}

// ============================================================================
// Rendering: --outdir mode (three-tier: README.md, api.md, per-section files)
// ============================================================================

/**
 * README.md: conceptual overview from @packageDocumentation.
 */
function renderOutdirReadme(pkg: { name: string; description: string }, overview: string): string {
  let content = `# ${pkg.name}\n\n> ${pkg.description}\n\n`;
  if (overview) {
    // Strip first line if it duplicates the package description
    let cleaned = overview;
    const firstLine = overview.split("\n")[0]?.replace(/\.$/, "").trim();
    const desc = pkg.description?.replace(/\.$/, "").trim();
    if (firstLine && desc && firstLine.toLowerCase() === desc.toLowerCase()) {
      cleaned = overview.slice(overview.indexOf("\n") + 1).trimStart();
    }
    if (cleaned) content += `${cleaned}\n\n`;
  }
  content += `See [api.md](api.md) for the full API reference index.\n`;
  return content;
}

/**
 * api.md: compact API surface index with links to per-section files.
 */
function renderOutdirApiIndex(discovered: Map<string, DocEntry[]>): string {
  let content = `# API Reference\n\n`;

  for (const heading of SECTION_ORDER) {
    const entries = discovered.get(heading);
    if (!entries?.length) continue;

    const slug = slugFor(heading);
    content += `## [${heading}](${slug}.md)\n\n`;

    for (const entry of sortEntriesFunctionsFirst(entries)) {
      const nameFormatted = entry.kind === "function" ? `${entry.name}()` : entry.name;
      content += `- \`${nameFormatted}\``;
      if (entry.summary) content += ` — ${entry.summary}`;
      content += "\n";
    }
    content += "\n";
  }

  return content;
}

/**
 * Sort entries: functions and constants first, then interfaces and types.
 * Within each group, preserve original declaration order.
 */
function sortEntriesFunctionsFirst(entries: DocEntry[]): DocEntry[] {
  const kindOrder: Record<string, number> = { function: 0, const: 1, interface: 2, type: 3 };
  return entries.toSorted((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9));
}

/**
 * Per-section detail file (e.g., rules.md, coverage.md).
 */
function renderSectionFile(heading: string, entries: DocEntry[]): string {
  let content = `# ${heading}\n\n`;
  for (const entry of sortEntriesFunctionsFirst(entries)) content += renderFullDoc(entry);
  return content;
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  const outdirIdx = args.indexOf("--outdir");
  const outdir = outdirIdx !== -1 ? args[outdirIdx + 1] : undefined;

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  const program = createProgram();
  const checker = program.getTypeChecker();

  const overview = extractPackageDoc(program, path.join(ROOT_DIR, "src", "index.ts"));
  const discovered = discoverCategories(program, checker);

  for (const cat of discovered.keys()) {
    if (!SECTION_ORDER.includes(cat)) {
      console.warn(`Warning: @category "${cat}" is not in SECTION_ORDER — skipped`);
    }
  }

  if (outdir) {
    // --outdir mode: write README.md + api.md + per-section .md files
    fs.mkdirSync(outdir, { recursive: true });

    const readme = renderOutdirReadme(pkg, overview);
    fs.writeFileSync(path.join(outdir, "README.md"), readme, "utf-8");
    console.log(`Generated ${path.join(outdir, "README.md")} (${readme.split("\n").length} lines)`);

    const apiIndex = renderOutdirApiIndex(discovered);
    fs.writeFileSync(path.join(outdir, "api.md"), apiIndex, "utf-8");
    console.log(`Generated ${path.join(outdir, "api.md")} (${apiIndex.split("\n").length} lines)`);

    for (const heading of SECTION_ORDER) {
      const entries = discovered.get(heading);
      if (!entries?.length) continue;

      const slug = slugFor(heading);
      const content = renderSectionFile(heading, entries);
      const filePath = path.join(outdir, `${slug}.md`);
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`Generated ${filePath} (${content.split("\n").length} lines)`);
    }
  } else {
    console.error("Usage: generate-reference.ts --outdir <path>");
    process.exit(1);
  }
}

main();
