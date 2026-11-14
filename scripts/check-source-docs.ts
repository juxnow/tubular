import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** A declaration that must explain its contract independently of its identifier. */
interface DocumentationTarget {
  /** Repository-relative file and lexical declaration name used in diagnostics. */
  readonly key: string;
  /** Source offset before the declaration, used only by the local audit output. */
  readonly start: number;
  /** Whether a leading JSDoc block contains prose rather than only tags. */
  readonly documented: boolean;
  /** Single-line declaration preview to help authors review missing coverage. */
  readonly declaration: string;
}

/** Enumerate authored TypeScript without entering generated files or build output. */
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return ["generated", "build", "node_modules"].includes(entry.name) ? [] : files(file);
    return file.endsWith(".ts") && !file.endsWith("/bindings.ts") ? [file] : [];
  });
}

/** Inspect structural declarations, class state/methods, functions, and exported constants. */
function targets(file: string): DocumentationTarget[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const result: DocumentationTarget[] = [];
  /** Walk declarations and structural members while retaining their lexical owner for precise coverage diagnostics. */
  function visit(node: ts.Node, owner: string): void {
    const named =
      "name" in node &&
      node.name !== undefined &&
      typeof node.name === "object" &&
      node.name !== null &&
      "getText" in node.name &&
      typeof node.name.getText === "function"
        ? String(node.name.getText(source))
        : "";
    const declaration =
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node);
    const member =
      ts.isPropertySignature(node) ||
      ts.isMethodSignature(node) ||
      ts.isIndexSignatureDeclaration(node) ||
      ts.isCallSignatureDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node);
    const constant =
      ts.isVariableStatement(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const key = declaration
      ? named
      : constant && ts.isVariableStatement(node)
        ? node.declarationList.declarations.map((value) => value.name.getText(source)).join(",")
        : `${owner}.${named || (ts.isConstructorDeclaration(node) ? "constructor" : "index")}`;
    if (declaration || member || constant) {
      const jsdoc = ts.getJSDocCommentsAndTags(node);
      const documented = jsdoc.some(
        (doc) =>
          ts.isJSDoc(doc) &&
          doc.comment !== undefined &&
          (typeof doc.comment === "string" ? Boolean(doc.comment.trim()) : doc.comment.length > 0),
      );
      result.push({
        key: `${file}:${key}`,
        start: node.getStart(source),
        documented,
        declaration: node.getText(source).split("\n")[0] ?? "",
      });
    }
    ts.forEachChild(node, (child) => visit(child, declaration ? named : owner));
  }
  visit(source, "module");
  return result;
}

const audited = ["src", "scripts", "examples", "test"].flatMap(files).flatMap(targets);
const missing = audited.filter((target) => !target.documented);
if (process.argv.includes("--inventory")) {
  process.stdout.write(`${JSON.stringify(missing, null, 2)}\n`);
} else if (missing.length) {
  process.stderr.write(
    `Missing source documentation (${missing.length}/${audited.length} declarations):\n${missing.map((target) => target.key).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Source documentation verified for ${audited.length} authored declarations.\n`,
  );
}
