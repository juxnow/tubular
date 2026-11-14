import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Identifier for an invariant enforced by the repository source checker. */
export type SourceRuleId =
  | "interface-for-objects"
  | "layer-boundary"
  | "no-angle-assertion"
  | "no-any"
  | "no-blanket-assertion"
  | "no-double-assertion"
  | "no-network"
  | "no-suppression"
  | "no-wall-clock";

/** Single source-level invariant violation with 1-based line and column coordinates. */
export interface SourceViolation {
  /** Repository-relative or caller-supplied file path containing the offense. */
  readonly file: string;
  /** 1-based line number of the offending token or declaration. */
  readonly line: number;
  /** 1-based column number of the offending token or declaration. */
  readonly column: number;
  /** Stable rule identifier from the Totally Tubular engineering contract. */
  readonly rule: SourceRuleId;
  /** Human-readable explanation of how to resolve the violation. */
  readonly message: string;
}

const DOMAIN_PREFIXES = [
  "src/audit/",
  "src/authority/",
  "src/context/",
  "src/contracts/",
  "src/core/",
  "src/governed-tools/",
  "src/port-authority/",
  "src/runtime/",
  "src/type-validation/",
  "src/typed-tools/",
] as const;

const PROJECTION_FILES = new Set(["src/contracts/projections.ts"]);
const PROJECTION_PREFIXES = ["src/second-service/", "src/typed-projections/"] as const;
const ADAPTER_PREFIXES = ["src/adapters/", "src/mcp/", "src/typed-mcp/"] as const;
const ENTRYPOINT_PREFIXES = ["src/cli.ts", "src/demo.ts", "src/typegen/"] as const;

const FORBIDDEN_NETWORK_MODULES = new Set([
  "dgram",
  "dns",
  "http",
  "http2",
  "https",
  "net",
  "node:dgram",
  "node:dns",
  "node:http",
  "node:http2",
  "node:https",
  "node:net",
  "node:tls",
  "tls",
  "undici",
]);

const SUPPRESSION_PATTERN = /@(?:ts-ignore|ts-expect-error|ts-nocheck)\b|biome-ignore\b/;

/** Enumerate authored TypeScript files under a directory, skipping generated and build outputs. */
function collectAuthoredFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["build", "dist", "generated", "node_modules"].includes(entry.name)
        ? []
        : collectAuthoredFiles(fullPath);
    }
    const normalized = fullPath.split(path.sep).join("/");
    return normalized.endsWith(".ts") && !normalized.endsWith("/bindings.ts") ? [normalized] : [];
  });
}

/** Unwrap parenthesized expressions so nested assertions cannot hide behind parentheses. */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Unwrap parenthesized type nodes when inspecting type alias bodies. */
function unwrapTypeNode(node: ts.TypeNode): ts.TypeNode {
  let current = node;
  while (ts.isParenthesizedTypeNode(current)) {
    current = current.type;
  }
  return current;
}

/** Determine whether an `as` target is the benign `as const` literal narrowing form. */
function isConstAssertion(node: ts.AsExpression, source: ts.SourceFile): boolean {
  return (
    ts.isTypeReferenceNode(node.type) &&
    node.type.typeName.getText(source) === "const" &&
    node.type.typeArguments === undefined
  );
}

/** Convert a source offset into 1-based line and column coordinates. */
function positionOf(
  source: ts.SourceFile,
  pos: number,
): {
  /** 1-based source line number. */
  readonly line: number;
  /** 1-based source column number. */
  readonly column: number;
} {
  const { line, character } = source.getLineAndCharacterOfPosition(pos);
  return { line: line + 1, column: character + 1 };
}

/** Resolve a relative module specifier to a normalized repository-relative `.ts` path. */
function resolveInternalImport(importerFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(importerFile), specifier),
  );
  return resolved.replace(/\.js$/, ".ts");
}

/** Determine whether a normalized repository path belongs to the documentation projection layer. */
function isProjectionPath(normalizedPath: string): boolean {
  return (
    PROJECTION_FILES.has(normalizedPath) ||
    PROJECTION_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
  );
}

/** Determine whether a normalized repository path belongs to the domain or trusted kernel layer. */
function isDomainPath(normalizedPath: string): boolean {
  if (isProjectionPath(normalizedPath)) {
    return false;
  }
  return DOMAIN_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

/** Determine whether a normalized repository path belongs to the runtime adapter layer. */
function isAdapterPath(normalizedPath: string): boolean {
  return ADAPTER_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

/** Determine whether a normalized repository path belongs to the CLI, compiler, or demo layer. */
function isEntrypointOrCompilerPath(normalizedPath: string): boolean {
  return ENTRYPOINT_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix),
  );
}

/** Scan lexical comment tokens for compiler or linter suppression directives. */
function checkSuppressions(source: ts.SourceFile, file: string): SourceViolation[] {
  const violations: SourceViolation[] = [];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source.text,
  );
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const text = scanner.getTokenText();
      const match = SUPPRESSION_PATTERN.exec(text);
      if (match) {
        const pos = positionOf(source, scanner.getTokenStart());
        violations.push({
          file,
          line: pos.line,
          column: pos.column,
          rule: "no-suppression",
          message: `Compiler and linter suppressions (${match[0]}) are forbidden by AGENTS.md.`,
        });
      }
    }
    token = scanner.scan();
  }
  return violations;
}

/** Audit a parsed TypeScript source file (with optional TypeChecker) against all repository invariants. */
export function auditSourceFile(
  source: ts.SourceFile,
  file = source.fileName,
  checker?: ts.TypeChecker,
): SourceViolation[] {
  const normalizedFile = file.split(path.sep).join("/");
  const inSrc = normalizedFile.startsWith("src/");
  const isTimeModule = normalizedFile === "src/core/time.ts";
  const violations: SourceViolation[] = [...checkSuppressions(source, normalizedFile)];

  /** Recursively inspect every AST node in the source file. */
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const pos = positionOf(source, node.getStart(source));
      violations.push({
        file: normalizedFile,
        line: pos.line,
        column: pos.column,
        rule: "no-any",
        message: "Do not use `any`; use `unknown` at untrusted boundaries and narrow explicitly.",
      });
    }

    if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(unwrapTypeNode(node.type))) {
      const pos = positionOf(source, node.name.getStart(source));
      violations.push({
        file: normalizedFile,
        line: pos.line,
        column: pos.column,
        rule: "interface-for-objects",
        message: `Object-shaped model \`${node.name.getText(source)}\` must be declared with \`interface\`, not \`type\`.`,
      });
    }

    if (ts.isTypeAssertionExpression(node)) {
      const pos = positionOf(source, node.getStart(source));
      violations.push({
        file: normalizedFile,
        line: pos.line,
        column: pos.column,
        rule: "no-angle-assertion",
        message: "Angle-bracket type assertions (`<T>value`) are forbidden.",
      });
    }

    if (ts.isAsExpression(node) && !isConstAssertion(node, source)) {
      const inner = unwrapExpression(node.expression);
      if (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) {
        const pos = positionOf(source, node.getStart(source));
        violations.push({
          file: normalizedFile,
          line: pos.line,
          column: pos.column,
          rule: "no-double-assertion",
          message: "Double type assertions (`as ... as T`) are forbidden.",
        });
      } else if (checker !== undefined) {
        const exprType = checker.getTypeAtLocation(inner);
        if ((exprType.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !== 0) {
          const pos = positionOf(source, node.getStart(source));
          violations.push({
            file: normalizedFile,
            line: pos.line,
            column: pos.column,
            rule: "no-blanket-assertion",
            message:
              "Blanket assertion from `unknown` or `any` is forbidden; narrow with an explicit type guard.",
          });
        }
      }
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (inSrc && FORBIDDEN_NETWORK_MODULES.has(specifier)) {
        const pos = positionOf(source, node.moduleSpecifier.getStart(source));
        violations.push({
          file: normalizedFile,
          line: pos.line,
          column: pos.column,
          rule: "no-network",
          message: `Network module import \`${specifier}\` is forbidden without explicit authorization.`,
        });
      }

      if (inSrc) {
        const internalTarget = resolveInternalImport(normalizedFile, specifier);
        if (isDomainPath(normalizedFile)) {
          if (specifier.startsWith("@modelcontextprotocol/")) {
            const pos = positionOf(source, node.moduleSpecifier.getStart(source));
            violations.push({
              file: normalizedFile,
              line: pos.line,
              column: pos.column,
              rule: "layer-boundary",
              message: `Domain/kernel module cannot import protocol adapter package \`${specifier}\`.`,
            });
          } else if (internalTarget !== null) {
            if (
              isAdapterPath(internalTarget) ||
              isProjectionPath(internalTarget) ||
              isEntrypointOrCompilerPath(internalTarget)
            ) {
              const pos = positionOf(source, node.moduleSpecifier.getStart(source));
              violations.push({
                file: normalizedFile,
                line: pos.line,
                column: pos.column,
                rule: "layer-boundary",
                message: `Domain/kernel module \`${normalizedFile}\` cannot import from \`${internalTarget}\`.`,
              });
            }
          }
        } else if (isProjectionPath(normalizedFile)) {
          if (specifier.startsWith("@modelcontextprotocol/")) {
            const pos = positionOf(source, node.moduleSpecifier.getStart(source));
            violations.push({
              file: normalizedFile,
              line: pos.line,
              column: pos.column,
              rule: "layer-boundary",
              message: `Documentation projection cannot import runtime adapter package \`${specifier}\`.`,
            });
          } else if (
            internalTarget !== null &&
            (isAdapterPath(internalTarget) || internalTarget.startsWith("src/runtime/"))
          ) {
            const pos = positionOf(source, node.moduleSpecifier.getStart(source));
            violations.push({
              file: normalizedFile,
              line: pos.line,
              column: pos.column,
              rule: "layer-boundary",
              message: `Documentation projection \`${normalizedFile}\` cannot import runtime module \`${internalTarget}\`.`,
            });
          }
        }
      }
    }

    if (inSrc && !isTimeModule) {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Date" &&
        (node.arguments === undefined || node.arguments.length === 0)
      ) {
        const pos = positionOf(source, node.getStart(source));
        violations.push({
          file: normalizedFile,
          line: pos.line,
          column: pos.column,
          rule: "no-wall-clock",
          message: "Direct `new Date()` is forbidden outside `src/core/time.ts`; inject `Clock`.",
        });
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Date" &&
        node.expression.name.text === "now"
      ) {
        const pos = positionOf(source, node.getStart(source));
        violations.push({
          file: normalizedFile,
          line: pos.line,
          column: pos.column,
          rule: "no-wall-clock",
          message: "Direct `Date.now()` is forbidden outside `src/core/time.ts`; inject `Clock`.",
        });
      }
    }

    if (
      inSrc &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      const pos = positionOf(source, node.getStart(source));
      violations.push({
        file: normalizedFile,
        line: pos.line,
        column: pos.column,
        rule: "no-network",
        message: "Network calls (`fetch`) are forbidden in `src/` without explicit authorization.",
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

/** Audit a complete TypeScript snippet in memory for unit tests. */
export function auditSourceText(
  code: string,
  virtualFile = "src/core/sample.ts",
): SourceViolation[] {
  const normalizedFile = virtualFile.split(path.sep).join("/");
  const sourceFile = ts.createSourceFile(normalizedFile, code, ts.ScriptTarget.Latest, true);
  const defaultHost = ts.createCompilerHost({ strict: true, target: ts.ScriptTarget.ES2023 });
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => fileName === normalizedFile || defaultHost.fileExists(fileName),
    readFile: (fileName) => (fileName === normalizedFile ? code : defaultHost.readFile(fileName)),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      fileName === normalizedFile
        ? sourceFile
        : defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile),
  };
  const program = ts.createProgram([normalizedFile], { strict: true, noEmit: true }, host);
  return auditSourceFile(sourceFile, normalizedFile, program.getTypeChecker());
}

/** Audit all authored TypeScript files in the repository using the full TypeScript typechecker. */
export function auditRepository(rootDir = process.cwd()): {
  /** Number of authored TypeScript files checked. */
  readonly fileCount: number;
  /** Collected invariant violations across all checked files. */
  readonly violations: readonly SourceViolation[];
} {
  const authoredFiles = ["src", "scripts", "examples", "test"]
    .flatMap((dir) => collectAuthoredFiles(path.join(rootDir, dir)))
    .map((file) => path.relative(rootDir, file).split(path.sep).join("/"))
    .sort();

  const configPath = path.join(rootDir, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir);
  const absFiles = authoredFiles.map((file) => path.resolve(rootDir, file));
  const program = ts.createProgram(absFiles, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  const violations: SourceViolation[] = [];
  for (const relFile of authoredFiles) {
    const absFile = path.resolve(rootDir, relFile);
    const source =
      program.getSourceFile(absFile) ??
      ts.createSourceFile(relFile, readFileSync(absFile, "utf8"), ts.ScriptTarget.Latest, true);
    violations.push(...auditSourceFile(source, relFile, checker));
  }
  return { fileCount: authoredFiles.length, violations };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { fileCount, violations } = auditRepository();
  if (violations.length > 0) {
    process.stderr.write(`Source contract check failed with ${violations.length} offense(s):\n`);
    for (const violation of violations) {
      process.stderr.write(
        `  ${violation.file}:${violation.line}:${violation.column} [${violation.rule}] ${violation.message}\n`,
      );
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Source contract verified across ${fileCount} authored TypeScript files.\n`,
    );
  }
}
