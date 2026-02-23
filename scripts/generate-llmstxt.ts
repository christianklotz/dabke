#!/usr/bin/env tsx

/**
 * Generates llms.txt and src/llms.ts from TSDoc in the source files.
 *
 * Symbols opt in via `@category <Section Name>` in their TSDoc. The
 * generator discovers all categorized exports, groups them by category,
 * and renders them in the order defined by SECTION_ORDER. Symbols
 * without `@category` are excluded from llms.txt (they remain in
 * TypeDoc and IDE tooltips).
 *
 * The overview comes from `@packageDocumentation` in index.ts.
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
// Document structure.
//
// Section order for llms.txt. Only categories listed here are rendered;
// any @category value not in this list is ignored with a warning.
// All descriptive content comes from TSDoc in the source files.
// ============================================================================

const SECTION_ORDER = [
  "Schedule Definition",
  "Time Periods",
  "Coverage",
  "Shift Patterns",
  "Rules",
  "Cost Optimization",
  "Supporting Types",
];

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

/** Convert {@link Foo} and {@link Foo display text} to backticked name. */
function stripLinks(s: string): string {
  return s.replace(/\{@link\s+([^}\s]+)(?:\s+[^}]*)?\}/g, "`$1`");
}

function getJSDocNode(node: ts.Node): ts.JSDoc | undefined {
  const items = ts.getJSDocCommentsAndTags(node);
  const first = items[0];
  return first && ts.isJSDoc(first) ? first : undefined;
}

/** Check if a node's JSDoc contains @internal. */
function isInternal(node: ts.Node): boolean {
  const doc = getJSDocNode(node);
  return doc?.tags?.some((t) => t.tagName.text === "internal") ?? false;
}

/** Extract the @category value from a node's JSDoc. */
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
    // Skip tags that should not appear in public output
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

/** Extract the @returns description from a node's JSDoc. */
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

/** Extract @param description for a specific parameter. */
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

/**
 * Extract the @packageDocumentation block from a source file.
 */
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

/** Get the declared type text from a node's type annotation or method signature. */
function sourceType(node: ts.Node): string | undefined {
  // Method signatures: render as (params) => ReturnType
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
  signature?: string;
  properties?: { name: string; type: string; description: string; optional: boolean }[];
  parameters?: { name: string; type: string; description: string; optional: boolean }[];
  returnType?: string;
  returnsDoc?: string;
}

function extractDocEntry(
  checker: ts.TypeChecker,
  name: string,
  node: ts.Node,
  sf: ts.SourceFile,
): DocEntry | undefined {
  if (ts.isInterfaceDeclaration(node)) {
    return {
      name,
      kind: "interface",
      description: extractJSDoc(node),
      properties: extractProperties(checker, node),
    };
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return {
      name,
      kind: "type",
      description: extractJSDoc(node),
      signature: typeToString(checker, node.type),
    };
  }
  if (ts.isFunctionDeclaration(node)) {
    const docNode = findDocumentedOverload(sf, name) ?? node;
    return {
      name,
      kind: "function",
      description: extractJSDoc(docNode),
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
      return {
        name,
        kind: "const",
        description: extractJSDoc(node),
        signature: typeToString(checker, decl),
      };
    }
  }
  return undefined;
}

/**
 * Strip leading "- " from @param descriptions.
 * TSDoc convention is `@param name - description`; the parser includes
 * the hyphen in the comment text.
 */
function cleanParamDescription(desc: string): string {
  return desc.replace(/^- /, "");
}

/**
 * Find the first overload signature of a function that has JSDoc.
 * Returns undefined if no documented overload exists.
 */
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

/** Extract the exported name from a declaration node, if any. */
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

/**
 * Discover all exported symbols that have a @category tag.
 * Returns a map from category name to ordered list of DocEntry.
 */
function discoverCategories(program: ts.Program, checker: ts.TypeChecker): Map<string, DocEntry[]> {
  const groups = new Map<string, DocEntry[]>();
  const seen = new Set<string>();

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;

    ts.forEachChild(sf, (node) => {
      const name = getExportedName(node);
      if (!name || seen.has(name)) return;

      // For overloaded functions, check all overloads for @category.
      // The category tag lives on the documented overload (no body).
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
    return (
      node.members
        // Filter out @internal members
        .filter((m) => !isInternal(m))
        .map((m) => ({
          name: m.name?.getText() || "unknown",
          type: sourceType(m) ?? typeToString(checker, m),
          description: extractJSDoc(m),
          optional: !!(m as ts.PropertySignature).questionToken,
        }))
    );
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
// Markdown rendering
// ============================================================================

function renderDoc(doc: DocEntry): string {
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
      // Compact signature line, but only when no example code block
      // is already present (examples demonstrate usage better).
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
// Main
// ============================================================================

function main(): void {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  const program = createProgram();
  const checker = program.getTypeChecker();

  // -- Title & overview --
  let content = `# ${pkg.name}\n\n> ${pkg.description}\n\n`;

  let overview = extractPackageDoc(program, path.join(ROOT_DIR, "src", "index.ts"));
  // The @packageDocumentation summary often duplicates package.json description.
  // Strip the first line if it closely matches the blockquote already emitted.
  if (overview) {
    const firstLine = overview.split("\n")[0]?.replace(/\.$/, "").trim();
    const desc = pkg.description?.replace(/\.$/, "").trim();
    if (firstLine && desc && firstLine.toLowerCase() === desc.toLowerCase()) {
      overview = overview.slice(overview.indexOf("\n") + 1).trimStart();
    }
    content += `${overview}\n\n`;
  }

  // -- Sections from @category tags --
  const discovered = discoverCategories(program, checker);

  // Warn about categories not in SECTION_ORDER
  for (const cat of discovered.keys()) {
    if (!SECTION_ORDER.includes(cat)) {
      console.warn(`Warning: @category "${cat}" is not in SECTION_ORDER — skipped`);
    }
  }

  for (const heading of SECTION_ORDER) {
    const entries = discovered.get(heading);
    if (!entries?.length) continue;

    content += `---\n\n## ${heading}\n\n`;
    for (const entry of entries) content += renderDoc(entry);
  }

  // -- Write outputs --
  const llmsPath = path.join(ROOT_DIR, "llms.txt");
  fs.writeFileSync(llmsPath, content, "utf-8");
  console.log(`Generated ${llmsPath}`);

  const tsPath = path.join(ROOT_DIR, "src/llms.ts");
  fs.writeFileSync(
    tsPath,
    `// Auto-generated — do not edit manually\nexport const apiDocs = ${JSON.stringify(content)};\n`,
    "utf-8",
  );
  console.log(`Generated ${tsPath}`);
}

main();
