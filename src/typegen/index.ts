import path from "node:path";
import ts from "typescript";
import { sha256 } from "../core/json.js";

/** A deliberately bounded JSON Schema subset emitted by Tubular. */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  const?: string | number | boolean | null;
  description?: string;
}

export interface CompileTypeSchemasOptions {
  tsconfigPath: string;
  entryFile: string;
  typeNames: readonly string[];
}

export interface CompileToolSchemasOptions {
  tsconfigPath: string;
  entryFile: string;
  functionNames: readonly string[];
}

export interface ToolSchemas {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

interface Compiler {
  checker: ts.TypeChecker;
  exports: Map<string, ts.Symbol>;
  program: ts.Program;
}

function createCompiler(tsconfigPath: string, entryFile: string): Compiler {
  const configPath = path.resolve(tsconfigPath);
  const configDir = path.dirname(configPath);
  const entryPath = path.resolve(configDir, entryFile);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(formatDiagnostics([config.error]));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, configDir, { noEmit: true, noCheck: false }, configPath);
  if (parsed.errors.length) throw new Error(formatDiagnostics(parsed.errors));
  if (!(parsed.options.strictNullChecks ?? parsed.options.strict ?? false)) {
    throw new Error("strictNullChecks must be enabled to preserve nullability in generated schemas");
  }
  const program = ts.createProgram([...new Set([...parsed.fileNames, entryPath])], parsed.options);
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(formatDiagnostics(errors));
  const source = program.getSourceFile(entryPath);
  if (!source) throw new Error(`Entry file not found: ${entryPath}`);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  if (!module) throw new Error(`Entry file has no exports: ${entryPath}`);
  const exports = new Map(checker.getExportsOfModule(module).map(symbol => [symbol.getName(), symbol]));
  return { checker, exports, program };
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => "\n",
  });
}

function exportedSymbol(compiler: Compiler, name: string): ts.Symbol {
  const symbol = compiler.exports.get(name);
  if (!symbol) throw new Error(`Export not found: ${name}`);
  return symbol.flags & ts.SymbolFlags.Alias ? compiler.checker.getAliasedSymbol(symbol) : symbol;
}

function schemaFor(checker: ts.TypeChecker, type: ts.Type, location: string, stack = new Set<ts.Type>()): JsonSchema {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.NonPrimitive | ts.TypeFlags.TypeParameter)) {
    throw new Error(`Unsupported type at ${location}: ${checker.typeToString(type)}`);
  }
  if (type.flags & ts.TypeFlags.Null) return { type: "null" };
  if (type.isStringLiteral()) return { type: "string", const: type.value };
  if (type.isNumberLiteral()) return { type: "number", const: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: "boolean", const: checker.typeToString(type) === "true" };
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (stack.has(type)) throw new Error(`Recursive type at ${location}: ${checker.typeToString(type)}`);
  stack.add(type);
  try {
    if (type.isUnion()) {
      const variants = type.types.map(part => schemaFor(checker, part, location, stack));
      variants.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
      return { anyOf: variants };
    }
    if (type.isIntersection()) {
      // Merge only structural object intersections. Primitive brands, arrays,
      // callables and impossible properties cannot be represented this way.
      for (const part of type.types) {
        if (schemaFor(checker, part, location, stack).type !== "object") {
          throw new Error(`Unsupported intersection at ${location}`);
        }
      }
    }
    if (checker.isTupleType(type)) throw new Error(`Unsupported tuple at ${location}`);
    if (checker.isArrayType(type)) {
      const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (!element) throw new Error(`Unsupported array at ${location}`);
      return { type: "array", items: schemaFor(checker, element, `${location}[]`, stack) };
    }
    if (!(type.flags & ts.TypeFlags.Object) && !type.isIntersection()) throw new Error(`Unsupported type at ${location}: ${checker.typeToString(type)}`);
    const symbol = type.getSymbol();
    const declarations = symbol?.getDeclarations() ?? [];
    if (declarations.some(d => ts.isClassDeclaration(d) || ts.isClassExpression(d) || ts.isEnumDeclaration(d))) {
      throw new Error(`Unsupported class or enum at ${location}`);
    }
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length || checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length || checker.getIndexInfosOfType(type).length) {
      throw new Error(`Unsupported callable or index signature at ${location}`);
    }
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const property of checker.getPropertiesOfType(type).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = property.getName();
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration || name.startsWith("__@") || (property.flags & ts.SymbolFlags.Method) || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration)) throw new Error(`Unsupported property ${location}.${name}`);
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      const optional = Boolean(property.flags & ts.SymbolFlags.Optional);
      // Optional members may contain undefined due to TypeScript's optional semantics.
      const parts = propertyType.isUnion() && optional ? propertyType.types.filter(t => !(t.flags & ts.TypeFlags.Undefined)) : [propertyType];
      if (parts.length === 0) throw new Error(`Unsupported type at ${location}.${name}`);
      let propertySchema: JsonSchema;
      if (parts.length === 1) {
        const part = parts[0];
        if (!part) throw new Error(`Unsupported type at ${location}.${name}`);
        propertySchema = schemaFor(checker, part, `${location}.${name}`, stack);
      } else {
        const variants = parts.map(part => schemaFor(checker, part, `${location}.${name}`, stack));
        variants.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
        propertySchema = { anyOf: variants };
      }
      const description = ts.displayPartsToString(property.getDocumentationComment(checker));
      if (description) propertySchema.description = description;
      Object.defineProperty(properties, name, { value: propertySchema, enumerable: true, configurable: true, writable: true });
      if (!optional) required.push(name);
    }
    return { type: "object", properties, required, additionalProperties: false };
  } finally {
    stack.delete(type);
  }
}

/** Derive closed schemas from named TypeScript type exports. Paths are relative to the tsconfig directory. */
export function compileTypeSchemas(options: CompileTypeSchemasOptions): Record<string, JsonSchema> {
  const compiler = createCompiler(options.tsconfigPath, options.entryFile);
  const result: Record<string, JsonSchema> = {};
  for (const name of [...new Set(options.typeNames)].sort()) {
    const symbol = exportedSymbol(compiler, name);
    if (!(symbol.flags & ts.SymbolFlags.Type)) throw new Error(`Export is not a type: ${name}`);
    Object.defineProperty(result, name, { value: schemaFor(compiler.checker, compiler.checker.getDeclaredTypeOfSymbol(symbol), name), enumerable: true, configurable: true, writable: true });
  }
  return result;
}

/** Derive schemas from named functions: a required input object, an optional host context parameter, and a JSON-serializable return. */
export function compileToolSchemas(options: CompileToolSchemasOptions): Record<string, ToolSchemas> {
  const compiler = createCompiler(options.tsconfigPath, options.entryFile);
  return toolSchemas(compiler, options.functionNames);
}

function toolSchemas(compiler: Compiler, names: readonly string[]): Record<string, ToolSchemas> {
  const result: Record<string, ToolSchemas> = {};
  for (const name of [...new Set(names)].sort()) {
    const symbol = exportedSymbol(compiler, name);
    const declaration = symbol.valueDeclaration;
    if (!declaration) throw new Error(`Export is not a function: ${name}`);
    const signatures = compiler.checker.getSignaturesOfType(compiler.checker.getTypeOfSymbolAtLocation(symbol, declaration), ts.SignatureKind.Call);
    if (signatures.length !== 1) throw new Error(`Tool ${name} must have exactly one non-overloaded call signature`);
    const signature = signatures[0];
    if (!signature || signature.thisParameter || signature.typeParameters?.length || (signature.parameters.length < 1 || signature.parameters.length > 2)) throw new Error(`Tool ${name} must have one required input parameter, at most one host context parameter, no this parameter, and no type parameters`);
    const parameter = signature.parameters[0];
    if (!parameter || parameter.flags & ts.SymbolFlags.Optional || !parameter.valueDeclaration || (ts.isParameter(parameter.valueDeclaration) && (parameter.valueDeclaration.dotDotDotToken || parameter.valueDeclaration.questionToken || parameter.valueDeclaration.initializer))) throw new Error(`Tool ${name} must have one required input parameter`);
    const contextParameter = signature.parameters[1];
    if (contextParameter?.valueDeclaration && ts.isParameter(contextParameter.valueDeclaration) && contextParameter.valueDeclaration.dotDotDotToken) throw new Error(`Tool ${name} cannot have a rest context parameter`);
    const input = compiler.checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration);
    const inputSchema = schemaFor(compiler.checker, input, `${name} input`);
    if (inputSchema.type !== "object") throw new Error(`Tool ${name} input must be an object`);
    const resultType = compiler.checker.getAwaitedType(signature.getReturnType());
    if (!resultType) throw new Error(`Tool ${name} has an unsupported return type`);
    const outputSchema = schemaFor(compiler.checker, resultType, `${name} output`);
    Object.defineProperty(result, name, { value: { inputSchema, outputSchema }, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

export interface CompileToolBindingsOptions extends CompileToolSchemasOptions {
  /** Destination determines the relative handler import. */
  readonly outputFile: string;
}

/** Generate direct imports and immutable schema/handler factories, never a name lookup. */
export function compileToolBindings(options: CompileToolBindingsOptions): string {
  const compiler = createCompiler(options.tsconfigPath, options.entryFile);
  const schemas = toolSchemas(compiler, options.functionNames);
  const directory = path.dirname(path.resolve(options.tsconfigPath));
  const entry = path.resolve(directory, options.entryFile);
  const output = path.resolve(options.outputFile);
  if (entry === output) throw new Error("Bindings must not overwrite their source entry");
  if (!/\.(?:ts|mts|cts)$/.test(entry) || /\.d\.(?:ts|mts|cts)$/.test(entry)) throw new Error("Bindings require a TypeScript implementation entry");
  let specifier = path.relative(path.dirname(output), entry).split(path.sep).join("/")
    .replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs").replace(/\.ts$/, ".js");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  const sources = compiler.program.getSourceFiles()
    .filter(file => path.resolve(file.fileName) !== output && !compiler.program.isSourceFileDefaultLibrary(file) && !compiler.program.isSourceFileFromExternalLibrary(file))
    .map(file => [path.relative(directory, file.fileName).split(path.sep).join("/"), file.text])
    .sort((a, b) => (a[0] ?? "") < (b[0] ?? "") ? -1 : (a[0] ?? "") > (b[0] ?? "") ? 1 : 0);
  const sourceDigest = sha256(JSON.stringify({ compiler: ts.version, sources, schemas }));
  const lines = ["// Generated by tubular. Regenerate and use --check in CI.", 'import { bindTool } from "@juxnow/tubular";'];
  Object.entries(schemas).forEach(([name, schema], index) => {
    // String-named imports also handle aliases and reserved export names safely.
    lines.push(`import { ${JSON.stringify(name)} as handler${index} } from ${JSON.stringify(specifier)};`);
    lines.push(`const binding${index} = bindTool(handler${index}, ${JSON.stringify(schema, null, 2)}, ${JSON.stringify({ entry: path.relative(directory, entry).split(path.sep).join("/"), exportName: name, sourceDigest }, null, 2)});`);
    lines.push(`export { binding${index} as ${JSON.stringify(name)} };`);
  });
  return `${lines.join("\n")}\n`;
}
