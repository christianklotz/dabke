#!/usr/bin/env tsx

/**
 * Generates llms.txt and src/llms.ts from TSDoc in the source files.
 *
 * All content comes from TSDoc. The generator controls only ordering:
 * which symbols appear and in what section order. The overview comes
 * from @packageDocumentation in index.ts; sections group symbols under
 * headings.
 *
 * TSDoc filtering:
 *   - @internal members are excluded from interface property lists
 *   - @privateRemarks content is omitted
 *   - {@link Foo} references are converted to plain `Foo` in output
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
// Each section has a heading and a list of exported symbol names whose
// TSDoc is extracted and rendered. Order here is the reading order in
// llms.txt. All descriptive content comes from TSDoc in the source files.
// ============================================================================

interface Section {
  heading: string;
  symbols: string[];
}

const SECTIONS: Section[] = [
  {
    heading: "Schedule Definition",
    symbols: ["defineSchedule", "ScheduleDefinition", "RuntimeArgs"],
  },
  {
    heading: "Time Periods",
    symbols: ["t", "time", "weekdays", "weekend"],
  },
  {
    heading: "Coverage",
    symbols: ["cover", "CoverageOptions", "CoverageVariant"],
  },
  {
    heading: "Shift Patterns",
    symbols: ["shift"],
  },
  {
    heading: "Rules",
    symbols: [
      "RuleOptions",
      "EntityOnlyRuleOptions",
      "TimeOffOptions",
      "CostRuleOptions",
      "maxHoursPerDay",
      "maxHoursPerWeek",
      "minHoursPerDay",
      "minHoursPerWeek",
      "maxShiftsPerDay",
      "maxConsecutiveDays",
      "minConsecutiveDays",
      "minRestBetweenShifts",
      "preference",
      "preferLocation",
      "timeOff",
      "assignTogether",
      "minimizeCost",
      "dayMultiplier",
      "daySurcharge",
      "timeSurcharge",
      "overtimeMultiplier",
      "overtimeSurcharge",
      "dailyOvertimeMultiplier",
      "dailyOvertimeSurcharge",
      "tieredOvertimeMultiplier",
    ],
  },
  {
    heading: "Supporting Types",
    symbols: [
      "TimeOfDay",
      "DayOfWeek",
      "SchedulingPeriod",
      "SchedulingMember",
      "HourlyPay",
      "SalariedPay",
      "Priority",
    ],
  },
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

function extractJSDoc(node: ts.Node): string {
  const doc = getJSDocNode(node);
  if (!doc) return "";

  let result = doc.comment ? ts.getTextOfJSDocComment(doc.comment) || "" : "";

  for (const tag of doc.tags ?? []) {
    // Skip tags that should not appear in public output
    if (tag.tagName.text === "privateRemarks") continue;
    if (tag.tagName.text === "internal") continue;
    if (tag.tagName.text === "packageDocumentation") continue;
    if (tag.tagName.text === "module") continue;
    if (tag.tagName.text === "param") continue;
    if (tag.tagName.text === "returns") continue;

    const text = tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "";
    if (!text) continue;
    if (tag.tagName.text === "remarks") result += `\n\n${text}`;
    if (tag.tagName.text === "example") result += `\n\n**Example:**\n${text}`;
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
      if (tag.tagName.text === "example") result += `\n\n**Example:**\n${text}`;
    }
    return stripLinks(result);
  }
  return "";
}

// ============================================================================
// Type formatting
// ============================================================================

/** Get the declared type text from a node's type annotation. */
function sourceType(node: ts.Node): string | undefined {
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
// Symbol lookup
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

function extractSymbol(
  program: ts.Program,
  checker: ts.TypeChecker,
  name: string,
): DocEntry | undefined {
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const found = findNamedExport(sf, name);
    if (!found) continue;

    if (ts.isInterfaceDeclaration(found)) {
      return {
        name,
        kind: "interface",
        description: extractJSDoc(found),
        properties: extractProperties(checker, found),
      };
    }
    if (ts.isTypeAliasDeclaration(found)) {
      return {
        name,
        kind: "type",
        description: extractJSDoc(found),
        signature: typeToString(checker, found.type),
      };
    }
    if (ts.isFunctionDeclaration(found)) {
      // For overloaded functions the JSDoc lives on the first overload
      // signature, but we want params/return from whichever node has
      // the doc. Find the documented overload if it differs from found.
      const docNode = findDocumentedOverload(sf, name) ?? found;
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
    if (ts.isVariableStatement(found)) {
      const decl = found.declarationList.declarations[0];
      if (decl) {
        return {
          name,
          kind: "const",
          description: extractJSDoc(found),
          signature: typeToString(checker, decl),
        };
      }
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

/**
 * Find an exported declaration by name.
 * For functions, returns the first matching declaration (typically the
 * first overload signature). Use {@link findDocumentedOverload} to get
 * the overload that carries JSDoc.
 */
function findNamedExport(sf: ts.SourceFile, name: string): ts.Node | undefined {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (result) return;
    const hasExport =
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) {
      if (ts.isSourceFile(node) || ts.isModuleBlock(node)) {
        ts.forEachChild(node, visit);
      }
      return;
    }
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name?.text === name
    ) {
      result = node;
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      if (node.body) {
        result = node;
      } else if (!result) {
        // Keep the first overload as a fallback
        result = node;
      }
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          result = node;
          return;
        }
      }
    }
  };
  ts.forEachChild(sf, visit);
  return result;
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
    } else {
      // Compact: single signature line when no @param descriptions
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

  // -- Sections --
  for (const section of SECTIONS) {
    const entries: DocEntry[] = [];
    for (const sym of section.symbols) {
      const doc = extractSymbol(program, checker, sym);
      if (doc) entries.push(doc);
      else console.warn(`Warning: symbol "${sym}" not found`);
    }
    if (entries.length === 0) continue;

    content += `---\n\n## ${section.heading}\n\n`;
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
