#!/usr/bin/env tsx

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ExtractedDoc {
  name: string;
  type: "interface" | "type" | "function" | "class" | "enum" | "const";
  description: string;
  signature?: string;
  properties?: Array<{
    name: string;
    type: string;
    description: string;
    optional: boolean;
  }>;
  parameters?: Array<{
    name: string;
    type: string;
    description: string;
    optional: boolean;
  }>;
  returnType?: string;
  filePath: string;
  exportOrder?: number;
  /** TSDoc @category tag value, used for filtering and grouping in llms.txt. */
  category?: string;
}

interface RuleDoc {
  name: string;
  summary: string;
  details: string;
  configType: string;
}

class TSDocExtractor {
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private docs: ExtractedDoc[] = [];
  private exportedSymbols = new Set<string>();
  private packageDocumentation: string = "";
  private exportOrder = new Map<string, number>();
  private moduleDocumentation = new Map<string, string>();

  constructor(private rootDir: string) {
    const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
    const configFile = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined;
    const compilerOptions = configFile
      ? ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir).options
      : {};

    const sourceFiles = this.getSourceFiles(path.join(rootDir, "src"));
    this.program = ts.createProgram(sourceFiles, compilerOptions);
    this.checker = this.program.getTypeChecker();

    // Extract exported symbols from index.ts
    this.extractExportedSymbols();
  }

  private extractExportedSymbols(): void {
    const indexPath = path.join(this.rootDir, "src", "index.ts");
    if (!fs.existsSync(indexPath)) {
      console.warn("No index.ts found");
      return;
    }

    const indexSource = this.program.getSourceFile(indexPath);
    if (!indexSource) {
      console.warn("Failed to get source for index.ts");
      return;
    }

    // Extract module-level JSDoc with @packageDocumentation
    // Module-level JSDoc is attached to the first statement, not the source file itself
    const statements = indexSource.statements;
    if (statements.length > 0) {
      const firstStatement = statements[0];
      if (!firstStatement) {
        return;
      }
      const jsDoc = ts.getJSDocCommentsAndTags(firstStatement);
      for (const comment of jsDoc) {
        if (ts.isJSDoc(comment)) {
          const tags = comment.tags;
          if (tags?.some((tag) => tag.tagName.text === "packageDocumentation")) {
            this.packageDocumentation = comment.comment
              ? ts.getTextOfJSDocComment(comment.comment) || ""
              : "";

            // Extract @remarks tags for package docs
            const remarksTags = tags?.filter((tag) => tag.tagName.text === "remarks");
            if (remarksTags && remarksTags.length > 0) {
              remarksTags.forEach((tag) => {
                const remarksText = tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "";
                if (remarksText) {
                  this.packageDocumentation += `\n\n${remarksText}`;
                }
              });
            }
            break;
          }
        }
      }
    }

    let currentOrder = 0;
    const visit = (node: ts.Node): void => {
      // Handle export * from "./module" statements
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        currentOrder++;
        const moduleSpecifier = node.moduleSpecifier.text;
        const resolvedModule = this.resolveModulePath(moduleSpecifier, indexPath);
        if (resolvedModule) {
          this.extractSymbolsFromModule(resolvedModule, currentOrder * 1000);
        }
      }

      // Handle named exports: export { foo, bar } from "./module" or export { foo, bar }
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          currentOrder++;
          this.exportedSymbols.add(element.name.text);
          this.exportOrder.set(element.name.text, currentOrder);
        }
      }

      // Handle direct exports: export function foo() {}, export interface Bar {}
      if (
        ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        currentOrder++;
        if (ts.isInterfaceDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          this.exportOrder.set(node.name.text, currentOrder);
        }
        if (ts.isTypeAliasDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          this.exportOrder.set(node.name.text, currentOrder);
        }
        if (ts.isFunctionDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          this.exportOrder.set(node.name.text, currentOrder);
        }
        if (ts.isClassDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          this.exportOrder.set(node.name.text, currentOrder);
        }
        if (ts.isEnumDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          this.exportOrder.set(node.name.text, currentOrder);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(indexSource);
  }

  private resolveModulePath(moduleSpecifier: string, fromFile: string): string | null {
    const basePath = path.dirname(fromFile);
    const resolvedPath = path.resolve(basePath, moduleSpecifier);

    // Try .ts extension
    if (fs.existsSync(resolvedPath + ".ts")) {
      return resolvedPath + ".ts";
    }

    // Try .js extension (since the imports use .js in the index)
    const jsPath = resolvedPath.replace(/\.js$/, ".ts");
    if (fs.existsSync(jsPath)) {
      return jsPath;
    }

    return null;
  }

  private extractSymbolsFromModule(modulePath: string, baseOrder: number = 10000): void {
    const sourceFile = this.program.getSourceFile(modulePath);
    if (!sourceFile) return;

    let subOrder = 0;
    const visit = (node: ts.Node): void => {
      // Handle export * from "./module" patterns - recursively follow
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        !node.exportClause // export * (not export { ... })
      ) {
        const moduleSpecifier = node.moduleSpecifier.text;
        const resolvedModule = this.resolveModulePath(moduleSpecifier, modulePath);
        if (resolvedModule) {
          this.extractSymbolsFromModule(resolvedModule, baseOrder + subOrder);
        }
        subOrder++;
      }

      // Handle export { A, B } from "./module" or export { A, B }
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          this.exportedSymbols.add(element.name.text);
          if (!this.exportOrder.has(element.name.text)) {
            this.exportOrder.set(element.name.text, baseOrder + subOrder++);
          }
        }

        // If there's a moduleSpecifier, also follow that module to get its exports
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const moduleSpecifier = node.moduleSpecifier.text;
          const resolvedModule = this.resolveModulePath(moduleSpecifier, modulePath);
          if (resolvedModule) {
            this.extractSymbolsFromModule(resolvedModule, baseOrder + subOrder);
          }
          subOrder++;
        }
      }

      // Only include exported symbols with direct export keyword
      if (
        ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (ts.isInterfaceDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          if (!this.exportOrder.has(node.name.text)) {
            this.exportOrder.set(node.name.text, baseOrder + subOrder++);
          }
        }
        if (ts.isTypeAliasDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          if (!this.exportOrder.has(node.name.text)) {
            this.exportOrder.set(node.name.text, baseOrder + subOrder++);
          }
        }
        if (ts.isFunctionDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          if (!this.exportOrder.has(node.name.text)) {
            this.exportOrder.set(node.name.text, baseOrder + subOrder++);
          }
        }
        if (ts.isClassDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          if (!this.exportOrder.has(node.name.text)) {
            this.exportOrder.set(node.name.text, baseOrder + subOrder++);
          }
        }
        if (ts.isEnumDeclaration(node) && node.name) {
          this.exportedSymbols.add(node.name.text);
          if (!this.exportOrder.has(node.name.text)) {
            this.exportOrder.set(node.name.text, baseOrder + subOrder++);
          }
        }
        if (ts.isVariableStatement(node)) {
          node.declarationList.declarations.forEach((decl) => {
            if (ts.isIdentifier(decl.name)) {
              this.exportedSymbols.add(decl.name.text);
              if (!this.exportOrder.has(decl.name.text)) {
                this.exportOrder.set(decl.name.text, baseOrder + subOrder++);
              }
            }
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private getSourceFiles(dir: string): string[] {
    const files: string[] = [];

    function traverse(currentDir: string) {
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          traverse(fullPath);
        } else if (item.endsWith(".ts") && !item.endsWith(".d.ts") && !item.endsWith(".test.ts")) {
          files.push(fullPath);
        }
      }
    }

    traverse(dir);
    return files;
  }

  private extractJSDocComment(node: ts.Node): string {
    const jsDoc = ts.getJSDocCommentsAndTags(node);
    if (jsDoc.length === 0) return "";

    const comment = jsDoc[0];
    if (!comment || !ts.isJSDoc(comment)) {
      return "";
    }

    let result = comment.comment ? ts.getTextOfJSDocComment(comment.comment) || "" : "";

    // Extract @remarks tag
    const remarksTags = comment.tags?.filter((tag) => tag.tagName.text === "remarks");
    if (remarksTags && remarksTags.length > 0) {
      remarksTags.forEach((tag) => {
        const remarksText = tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "";
        if (remarksText) {
          result += `\n\n${remarksText}`;
        }
      });
    }

    // Extract @example tag
    const exampleTags = comment.tags?.filter((tag) => tag.tagName.text === "example");
    if (exampleTags && exampleTags.length > 0) {
      exampleTags.forEach((tag) => {
        const exampleText = tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "";
        if (exampleText) {
          result += `\n\n**Example:**\n${exampleText}`;
        }
      });
    }

    return result;
  }

  /**
   * Extract the @category tag value from a node's JSDoc.
   * Returns undefined if no @category tag is present.
   */
  private extractCategory(node: ts.Node): string | undefined {
    const jsDoc = ts.getJSDocCommentsAndTags(node);
    for (const item of jsDoc) {
      if (ts.isJSDoc(item) && item.tags) {
        for (const tag of item.tags) {
          if (tag.tagName.text === "category") {
            return tag.comment ? (ts.getTextOfJSDocComment(tag.comment) || "").trim() : undefined;
          }
        }
      }
    }
    return undefined;
  }

  private getTypeString(node: ts.Node, maxLength: number = 2000): string {
    const type = this.checker.getTypeAtLocation(node);
    const typeString = this.checker.typeToString(
      type,
      node,
      ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation,
    );

    // Clean up import paths from type strings
    let cleaned = this.cleanupImportStatements(typeString);

    // If type string is too long, provide simplified version
    if (cleaned.length > maxLength) {
      // For very complex types, show a simplified message
      // Get the symbol name if available
      const symbol = type.getSymbol();
      if (symbol) {
        return `[Complex type: ${symbol.getName()}]`;
      }

      // Try to get a simpler representation using the type flags
      const simplified = this.checker.typeToString(type, node, ts.TypeFormatFlags.InTypeAlias);

      // Clean the simplified version too
      const cleanedSimplified = this.cleanupImportStatements(simplified);

      // Check if TypeScript truncated it (contains ...)
      if (cleanedSimplified.includes("...")) {
        // TypeScript already truncated, but it's messy - provide cleaner fallback
        return "[Complex type - see source code]";
      }

      // If simplified is also too long, truncate cleanly
      if (cleanedSimplified.length > maxLength) {
        return "[Complex type - see source code]";
      }

      return cleanedSimplified;
    }

    return cleaned;
  }

  private cleanupImportStatements(typeString: string): string {
    // Remove various forms of import statements:
    // - Complete with absolute paths: import("/absolute/path").TypeName
    // - Complete with relative paths: import("./relative/path").TypeName
    // - Truncated: import("/... or import("...
    // - In intersection types: & import(...)
    return (
      typeString
        // Remove complete import statements with type reference (handles both absolute and relative)
        .replace(/import\(["'][^"']*["']\)\./g, "")
        // Remove standalone or truncated import statements
        .replace(/import\(["'][^"']*\.{3}/g, "")
        // Remove partial imports at the end (common in truncated types)
        .replace(/\s*&\s*import\(["'][^"']*$/g, "")
    );
  }

  private extractParameters(
    node: ts.FunctionDeclaration | ts.MethodSignature | ts.FunctionTypeNode,
  ): Array<{
    name: string;
    type: string;
    description: string;
    optional: boolean;
  }> {
    return node.parameters.map((param) => {
      const paramDoc = this.extractJSDocComment(param);
      return {
        name: param.name.getText(),
        type: this.getTypeString(param),
        description: paramDoc,
        optional: !!param.questionToken,
      };
    });
  }

  private extractProperties(node: ts.InterfaceDeclaration | ts.TypeLiteralNode): Array<{
    name: string;
    type: string;
    description: string;
    optional: boolean;
  }> {
    // First, try to extract properties from direct members
    const members = node.members || [];
    const directProps = members.map((member) => {
      const propDoc = this.extractJSDocComment(member);
      const name = member.name?.getText() || "unknown";

      return {
        name,
        type: this.getTypeString(member),
        description: propDoc,
        optional: !!member.questionToken,
      };
    });

    // If no direct members (likely extends other interfaces), extract from resolved type
    if (directProps.length === 0 && ts.isInterfaceDeclaration(node)) {
      const type = this.checker.getTypeAtLocation(node);
      const properties = this.checker.getPropertiesOfType(type);

      return properties.map((prop) => {
        const propType = this.checker.getTypeOfSymbol(prop);
        const typeString = this.checker.typeToString(
          propType,
          undefined,
          ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation,
        );

        // Clean up import statements from inherited properties too
        const cleaned = this.cleanupImportStatements(typeString);

        // Check if property is optional
        const isOptional = !!(prop.flags & ts.SymbolFlags.Optional);

        return {
          name: prop.getName(),
          type: cleaned,
          description: "", // Inherited properties don't have direct JSDoc in this context
          optional: isOptional,
        };
      });
    }

    return directProps;
  }

  private visitNode = (node: ts.Node, sourceFile: ts.SourceFile): void => {
    const relativePath = path.relative(this.rootDir, sourceFile.fileName);

    // Extract interfaces - only if exported
    if (ts.isInterfaceDeclaration(node) && node.name && this.exportedSymbols.has(node.name.text)) {
      // Skip internal implementation types that don't provide useful documentation
      const SKIP_INTERFACES = ["InternalCoverageRequirement"];
      if (SKIP_INTERFACES.includes(node.name.text)) {
        return;
      }

      const doc: ExtractedDoc = {
        name: node.name.text,
        type: "interface",
        description: this.extractJSDocComment(node),
        properties: this.extractProperties(node),
        filePath: relativePath,
        exportOrder: this.exportOrder.get(node.name.text),
        category: this.extractCategory(node),
      };
      this.docs.push(doc);
    }

    // Extract type aliases - only if exported
    if (ts.isTypeAliasDeclaration(node) && node.name && this.exportedSymbols.has(node.name.text)) {
      // Skip internal implementation types that don't provide useful documentation
      const SKIP_TYPES = ["RuleFactories", "InternalCoverageRequirement"];
      if (SKIP_TYPES.includes(node.name.text)) {
        return;
      }

      const doc: ExtractedDoc = {
        name: node.name.text,
        type: "type",
        description: this.extractJSDocComment(node),
        signature: this.getTypeString(node.type),
        filePath: relativePath,
        exportOrder: this.exportOrder.get(node.name.text),
        category: this.extractCategory(node),
      };
      this.docs.push(doc);
    }

    // Extract functions - only if exported and has implementation (not just overload signatures)
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      this.exportedSymbols.has(node.name.text) &&
      node.body // Only include functions with implementations, skip overload signatures
    ) {
      // Check if we already have a doc for this function name to avoid duplicates from overloads
      const existingDoc = this.docs.find(
        (doc) => doc.name === node.name!.text && doc.type === "function",
      );

      if (!existingDoc) {
        const doc: ExtractedDoc = {
          name: node.name.text,
          type: "function",
          description: this.extractJSDocComment(node),
          parameters: this.extractParameters(node),
          returnType: node.type ? this.getTypeString(node.type) : "void",
          filePath: relativePath,
          exportOrder: this.exportOrder.get(node.name.text),
          category: this.extractCategory(node),
        };
        this.docs.push(doc);
      }
    }

    // Extract classes - only if exported
    if (ts.isClassDeclaration(node) && node.name && this.exportedSymbols.has(node.name.text)) {
      const doc: ExtractedDoc = {
        name: node.name.text,
        type: "class",
        description: this.extractJSDocComment(node),
        filePath: relativePath,
        exportOrder: this.exportOrder.get(node.name.text),
        category: this.extractCategory(node),
      };
      this.docs.push(doc);
    }

    // Extract enums - only if exported
    if (ts.isEnumDeclaration(node) && node.name && this.exportedSymbols.has(node.name.text)) {
      const doc: ExtractedDoc = {
        name: node.name.text,
        type: "enum",
        description: this.extractJSDocComment(node),
        filePath: relativePath,
        exportOrder: this.exportOrder.get(node.name.text),
        category: this.extractCategory(node),
      };
      this.docs.push(doc);
    }

    // Extract exported constants with types - only if exported
    if (
      ts.isVariableStatement(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      node.declarationList.declarations.forEach((decl) => {
        if (ts.isIdentifier(decl.name) && this.exportedSymbols.has(decl.name.text)) {
          const doc: ExtractedDoc = {
            name: decl.name.text,
            type: "const",
            description: this.extractJSDocComment(node),
            signature: this.getTypeString(decl),
            filePath: relativePath,
            exportOrder: this.exportOrder.get(decl.name.text),
            category: this.extractCategory(node),
          };
          this.docs.push(doc);
        }
      });
    }

    ts.forEachChild(node, (child) => this.visitNode(child, sourceFile));
  };

  private extractPackageDocFromFile(filePath: string): string {
    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) return "";

    const statements = sourceFile.statements;
    if (statements.length > 0) {
      const firstStatement = statements[0];
      if (!firstStatement) {
        return "";
      }
      const jsDoc = ts.getJSDocCommentsAndTags(firstStatement);
      for (const comment of jsDoc) {
        if (ts.isJSDoc(comment)) {
          const tags = comment.tags;
          if (tags?.some((tag) => tag.tagName.text === "packageDocumentation")) {
            let doc = comment.comment ? ts.getTextOfJSDocComment(comment.comment) || "" : "";

            // Extract @remarks tags
            const remarksTags = tags?.filter((tag) => tag.tagName.text === "remarks");
            if (remarksTags && remarksTags.length > 0) {
              remarksTags.forEach((tag) => {
                const remarksText = tag.comment ? ts.getTextOfJSDocComment(tag.comment) || "" : "";
                if (remarksText) {
                  doc += `\n\n${remarksText}`;
                }
              });
            }
            return doc;
          }
        }
      }
    }
    return "";
  }

  private extractRuleDocs(): RuleDoc[] {
    const rulesDir = path.join(this.rootDir, "src", "cpsat", "rules");
    if (!fs.existsSync(rulesDir)) {
      return [];
    }
    const ruleFiles = fs
      .readdirSync(rulesDir)
      .filter(
        (f) =>
          f.endsWith(".ts") &&
          f !== "rules.types.ts" &&
          f !== "index.ts" &&
          f !== "registry.ts" &&
          f !== "resolver.ts" &&
          f !== "scoping.ts" &&
          !f.endsWith(".test.ts"),
      );

    const ruleDocs: RuleDoc[] = [];

    for (const ruleFile of ruleFiles) {
      const rulePath = path.join(rulesDir, ruleFile);
      const sourceFile = this.program.getSourceFile(rulePath);
      if (!sourceFile) continue;

      // Find the exported function (e.g., createMaxHoursDayRule)
      ts.forEachChild(sourceFile, (node) => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          node.name.text.startsWith("create") &&
          node.name.text.endsWith("Rule") &&
          node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          // Extract rule name from function name (e.g., createMaxHoursDayRule -> max-hours-day)
          const funcName = node.name.text;
          const ruleName = funcName
            .replace(/^create/, "")
            .replace(/Rule$/, "")
            .replace(/([a-z])([A-Z])/g, "$1-$2")
            .toLowerCase();

          // Extract JSDoc from the function
          const details = this.extractJSDocComment(node);

          // Get config type from CpsatRuleRegistry
          let configType = "";
          const registryDoc = this.docs.find((d) => d.name === "CpsatRuleRegistry");
          if (registryDoc && registryDoc.properties) {
            const ruleProp = registryDoc.properties.find((p) => p.name === `"${ruleName}"`);
            if (ruleProp) {
              configType = ruleProp.type;
            }
          }

          ruleDocs.push({
            name: ruleName,
            summary: "", // Summary extracted from JSDoc
            details,
            configType,
          });
        }
      });
    }

    // Sort by name
    return ruleDocs.toSorted((a, b) => a.name.localeCompare(b.name));
  }

  public extract(): {
    docs: ExtractedDoc[];
    packageDoc: string;
    moduleDocs: Map<string, string>;
    ruleDocs: RuleDoc[];
  } {
    console.log(
      `Found ${this.exportedSymbols.size} exported symbols:`,
      Array.from(this.exportedSymbols).slice(0, 10).join(", "),
      this.exportedSymbols.size > 10 ? "..." : "",
    );

    // Extract package documentation from types.ts
    const typesPath = path.join(this.rootDir, "src", "types.ts");

    if (fs.existsSync(typesPath)) {
      const typesDoc = this.extractPackageDocFromFile(typesPath);
      if (typesDoc) {
        this.moduleDocumentation.set("types.ts", typesDoc);
      }
    }

    for (const sourceFile of this.program.getSourceFiles()) {
      if (!sourceFile.isDeclarationFile && sourceFile.fileName.includes("src/")) {
        this.visitNode(sourceFile, sourceFile);
      }
    }

    const ruleDocs = this.extractRuleDocs();

    return {
      docs: this.docs.toSorted((a, b) => {
        // Sort by export order first, then by type, then by name
        const orderA = a.exportOrder ?? 999999;
        const orderB = b.exportOrder ?? 999999;

        if (orderA !== orderB) {
          return orderA - orderB;
        }

        // If export order is the same, sort by type
        if (a.type !== b.type) {
          const order = ["class", "function", "interface", "type", "enum", "const"];
          return order.indexOf(a.type) - order.indexOf(b.type);
        }

        // Finally sort alphabetically
        return a.name.localeCompare(b.name);
      }),
      packageDoc: this.packageDocumentation,
      moduleDocs: this.moduleDocumentation,
      ruleDocs,
    };
  }
}

// ============================================================================
// llms.txt rendering — grouped by domain concept, not TS construct type.
//
// Only items with a @category matching LLM_CATEGORIES are included.
// The order here determines the reading order for the LLM.
// ============================================================================

const LLM_CATEGORIES = [
  { tag: "Semantic Times", heading: "Semantic Times & Coverage" },
  { tag: "Shifts", heading: "Shift Patterns" },
  { tag: "Rules", heading: "Rules" },
  { tag: "Types", heading: "Supporting Types" },
];

function generateLLMsTxt(
  docs: ExtractedDoc[],
  packageInfo: { name: string; description: string },
  ruleDocs: RuleDoc[],
): string {
  let content = `# ${packageInfo.name}\n\n`;
  content += `> ${packageInfo.description}\n\n`;

  for (const cat of LLM_CATEGORIES) {
    const catDocs = docs
      .filter((d) => d.category === cat.tag)
      .toSorted((a, b) => (a.exportOrder ?? 999999) - (b.exportOrder ?? 999999));

    // Always emit the Rules section (for the rules reference), even if no typed docs
    if (catDocs.length === 0 && !(cat.tag === "Rules" && ruleDocs.length > 0)) continue;

    content += `---\n\n## ${cat.heading}\n\n`;

    for (const doc of catDocs) {
      content += renderDoc(doc);
    }

    if (cat.tag === "Rules" && ruleDocs.length > 0) {
      content += generateRulesReference(ruleDocs);
    }
  }

  return content;
}

/**
 * Render a single doc item uniformly regardless of TS construct type.
 */
function renderDoc(doc: ExtractedDoc): string {
  let content = `### ${doc.name}\n`;
  if (doc.description) content += `${doc.description}\n\n`;

  if (doc.properties?.length) {
    content += `**Properties:**\n`;
    for (const prop of doc.properties) {
      const optional = prop.optional ? "?" : "";
      content += `- \`${prop.name}${optional}: ${prop.type}\``;
      if (prop.description) content += ` - ${prop.description}`;
      content += "\n";
    }
    content += "\n";
  }

  if (doc.type === "type" && doc.signature) {
    content += `\`\`\`typescript\n${doc.signature}\n\`\`\`\n\n`;
  }

  if (doc.parameters?.length) {
    content += `**Parameters:**\n`;
    for (const param of doc.parameters) {
      const optional = param.optional ? "?" : "";
      content += `- \`${param.name}${optional}: ${param.type}\``;
      if (param.description) content += ` - ${param.description}`;
      content += "\n";
    }
    content += "\n";
  }

  if (doc.returnType && doc.type === "function") {
    content += `**Returns:** \`${doc.returnType}\`\n\n`;
  }

  return content + "\n";
}

/**
 * Render the built-in rules reference with examples in ruleConfigs format.
 */
function generateRulesReference(ruleDocs: RuleDoc[]): string {
  let content = `### Built-In Rules\n\n`;
  content += `Each rule is a flat object in the \`ruleConfigs\` array with \`name\` as the discriminant.\n\n`;
  content += `**Scoping fields** available on most rules:\n`;
  content += `- Entity (at most one): \`employeeIds\`, \`roleIds\`, \`skillIds\`\n`;
  content += `- Time (at most one): \`dateRange\`, \`specificDates\`, \`dayOfWeek\`, \`recurringPeriods\`\n\n`;

  for (const rule of ruleDocs) {
    content += `#### ${rule.name}\n`;

    if (rule.details) {
      content += `${transformRuleDetails(rule.details, rule.name)}\n\n`;
    }
  }

  return content;
}

/**
 * Transform rule documentation to show ruleConfigs format instead of function calls.
 * Rewrites `createXxxRule({ ... })` → `{ name: "rule-name", ... }`.
 */
function transformRuleDetails(details: string, ruleName: string): string {
  let result = details;

  // Remove variable assignment prefix: `const rule = createXxxRule({` → `{ name: ...`
  result = result.replace(/(?:const \w+ = )?create\w+Rule\(\{/g, `{ name: "${ruleName}",`);

  // Close objects: `});` → `}`
  result = result.replace(/\}\);/g, "}");

  // Remove ModelBuilder lines (from assign-together example)
  result = result.replace(/^.*(?:new ModelBuilder|builder\b).*\n?/gm, "");

  return result;
}

function main() {
  const rootDir = path.resolve(__dirname, "..");
  const packageJsonPath = path.join(rootDir, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    console.error("package.json not found");
    process.exit(1);
  }

  const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

  console.log("Extracting TypeScript documentation...");
  const extractor = new TSDocExtractor(rootDir);
  const { docs, ruleDocs } = extractor.extract();

  const categorizedCount = docs.filter((d) => d.category).length;
  console.log(
    `Found ${docs.length} documented items (${categorizedCount} categorized for llms.txt)`,
  );
  console.log(`Found ${ruleDocs.length} rule docs`);

  const llmsTxtContent = generateLLMsTxt(docs, packageInfo, ruleDocs);
  const outputPath = path.join(rootDir, "llms.txt");

  fs.writeFileSync(outputPath, llmsTxtContent, "utf-8");
  console.log(`Generated ${outputPath}`);

  // Also generate a TypeScript file for easy importing
  const tsContent = `// Auto-generated TypeScript export of llms.txt
// This file is automatically generated by generate-llmstxt.ts
// Do not edit manually - it will be overwritten

/**
 * LLM-friendly API documentation for dabke
 */
export const apiDocs = ${JSON.stringify(llmsTxtContent)};
`;

  const tsOutputPath = path.join(rootDir, "src/llms.ts");
  fs.writeFileSync(tsOutputPath, tsContent, "utf-8");
  console.log(`Generated ${tsOutputPath}`);
}

// Run the script
main();
