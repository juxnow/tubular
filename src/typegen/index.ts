import path from "node:path";
import ts from "typescript";
import type { ToolDocumentation } from "../contracts/documentation.js";
import { isJsonValue, type JsonValue, sha256 } from "../core/json.js";
import { validateSchema } from "../type-validation/index.js";
import {
  type CompilerFileSystem,
  compilerHost,
  createNodeCompilerFileSystem,
} from "./file-system.js";

export { type CompilerFileSystem, createNodeCompilerFileSystem } from "./file-system.js";

/** A deliberately bounded JSON Schema subset emitted by Tubular. */
export interface JsonSchema {
  /** Assert one JSON primitive or container type; integer is an enforced numeric subset. */
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  /** Closed object member schemas, recursively derived from TypeScript declarations. */
  properties?: Record<string, JsonSchema>;
  /** Names of nonoptional properties; nullability remains a separate type choice. */
  required?: string[];
  /** Always false for generated objects; unknown input fields are rejected rather than silently dropped. */
  additionalProperties?: false;
  /** Homogeneous array element schema; tuples and unchecked item types are unsupported. */
  items?: JsonSchema;
  /** Union alternatives; at least one complete branch must validate. */
  anyOf?: JsonSchema[];
  /** Single literal value accepted by this branch, preserving TypeScript literal unions. */
  const?: string | number | boolean | null;
  /** Source declaration prose and remarks, exposed as JSON Schema annotation metadata. */
  description?: string;
  /** Optional @title display label; no runtime policy or validation semantics. */
  title?: string;
  /** JSON examples validated against this schema during compilation; examples do not change accepted values. */
  examples?: JsonValue[];
  /** Validated documentation default only; the runtime never inserts or coerces it. */
  default?: JsonValue;
  /** Source deprecation annotation; invocation remains permitted when host policy allows it. */
  deprecated?: boolean;
  /** Inclusive numeric lower bound, enforced only on numeric values. */
  minimum?: number;
  /** Inclusive numeric upper bound, enforced only on numeric values. */
  maximum?: number;
  /** Exclusive numeric lower bound expressed as a number, matching JSON Schema 2020-12. */
  exclusiveMinimum?: number;
  /** Exclusive numeric upper bound expressed as a number, matching JSON Schema 2020-12. */
  exclusiveMaximum?: number;
  /** Minimum string length in Unicode code points, excluding an explicit null alternative. */
  minLength?: number;
  /** Maximum string length in Unicode code points, not UTF-16 code units or UTF-8 bytes. */
  maxLength?: number;
  /** Minimum array length as a nonnegative safe integer. */
  minItems?: number;
  /** Maximum array length as a nonnegative safe integer. */
  maxItems?: number;
  /** ECMAScript regular expression compiled with Unicode mode and no implicit anchors; trusted authors must bound expensive patterns. */
  pattern?: string;
  /** Only uuid is supported and asserted by the runtime; unsupported format claims fail compilation. */
  format?: "uuid";
}

/** Compiler inputs selecting exported TypeScript models from a strict project. */
export interface CompileTypeSchemasOptions extends SchemaProjectOptions {
  /** Exported model names to compile, deduplicated and sorted for deterministic output. */
  typeNames: readonly string[];
}

/** One strict project snapshot; reuse a compiler session for related artifacts. */
export interface SchemaProjectOptions {
  /** Strict project configuration path, resolved from the selected filesystem's current directory. */
  tsconfigPath: string;
  /** Source module path relative to the tsconfig directory; its exported models are eligible for generation. */
  entryFile: string;
  /** Optional host project reader. Defaults to Node filesystem access; no compiler writes occur. */
  fileSystem?: CompilerFileSystem;
}

/** Compiler inputs selecting exported functions whose first parameter and return value define tool contracts. */
export interface CompileToolSchemasOptions extends SchemaProjectOptions {
  /** Exported function names to compile, deduplicated and sorted; overloads and generic tool signatures are rejected. */
  functionNames: readonly string[];
}

/** Generated contracts and optional source documentation for one exported function. */
export interface ToolSchemas {
  /** Canonical JSON Schema describing accepted input; consumers must also respect host policy and runtime validation. */
  inputSchema: JsonSchema;
  /** Canonical JSON Schema describing successful output; invalid output must not be released as a success. */
  outputSchema: JsonSchema;
  /** Source-derived discovery text and annotations; omission means the source supplied none. */
  documentation?: ToolDocumentation;
}

/** TypeScript program, checker, and entry export table shared during one compilation. */
interface Compiler {
  /** Host working directory captured for resolving generated output paths consistently. */
  currentDirectory: string;
  /** Absolute entry path captured with this immutable program snapshot. */
  entryPath: string;
  /** Absolute configuration directory used for relative provenance and imports. */
  directory: string;
  /** TypeScript semantic checker used to preserve resolved property and union types. */
  checker: ts.TypeChecker;
  /** Entry module export table, including aliases resolved before schema compilation. */
  exports: Map<string, ts.Symbol>;
  /** Strict TypeScript program retained for semantic diagnostics and dependency fingerprints. */
  program: ts.Program;
}

/** Load the project, require strict nullability, reject TypeScript errors, and resolve the entry export table. */
function createCompiler(options: SchemaProjectOptions): Compiler {
  const files = options.fileSystem ?? createNodeCompilerFileSystem();
  const currentDirectory = files.getCurrentDirectory();
  const configPath = path.resolve(currentDirectory, options.tsconfigPath);
  const configDir = path.dirname(configPath);
  const entryPath = path.resolve(configDir, options.entryFile);
  const config = ts.readConfigFile(configPath, (file) => files.readFile(file));
  if (config.error) throw new Error(formatDiagnostics([config.error], files, currentDirectory));
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    files,
    configDir,
    { noEmit: true, noCheck: false },
    configPath,
  );
  if (parsed.errors.length)
    throw new Error(formatDiagnostics(parsed.errors, files, currentDirectory));
  if (!(parsed.options.strictNullChecks ?? parsed.options.strict !== false)) {
    throw new Error(
      "strictNullChecks must be enabled to preserve nullability in generated schemas",
    );
  }
  const program = ts.createProgram(
    [...new Set([...parsed.fileNames, entryPath])],
    parsed.options,
    compilerHost(parsed.options, files, currentDirectory),
  );
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(formatDiagnostics(errors, files, currentDirectory));
  const source = program.getSourceFile(entryPath);
  if (!source) throw new Error(`Entry file not found: ${entryPath}`);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  if (!module) throw new Error(`Entry file has no exports: ${entryPath}`);
  const exports = new Map(
    checker.getExportsOfModule(module).map((symbol) => [symbol.getName(), symbol]),
  );
  return { checker, exports, program, entryPath, directory: configDir, currentDirectory };
}

/** Render TypeScript diagnostics with file locations for actionable compiler and CLI errors. */
function formatDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  files: CompilerFileSystem,
  currentDirectory: string,
): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => (files.useCaseSensitiveFileNames ? file : file.toLowerCase()),
    getCurrentDirectory: () => currentDirectory,
    getNewLine: () => "\n",
  });
}

/** Resolve a named export and follow import aliases; throw when the entry does not export it. */
function exportedSymbol(compiler: Compiler, name: string): ts.Symbol {
  const symbol = compiler.exports.get(name);
  if (!symbol) throw new Error(`Export not found: ${name}`);
  return symbol.flags & ts.SymbolFlags.Alias ? compiler.checker.getAliasedSymbol(symbol) : symbol;
}

const proseTags = new Set([
  "param",
  "returns",
  "return",
  "remarks",
  "see",
  "throws",
  "typeParam",
  "internal",
  "public",
  "private",
  "readonly",
  "override",
  "inheritDoc",
  "packageDocumentation",
]);
const numericTags = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

/** Detect annotations that cannot safely survive TypeScript alias erasure or property overriding. */
function inspectDocumentationDependencies(
  node: ts.Node,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): void {
  if (seen.has(node)) return;
  seen.add(node);
  if (ts.isTypeAliasDeclaration(node)) {
    const symbol = checker.getSymbolAtLocation(node.name);
    const unsupported = symbol?.getJsDocTags(checker).find((tag) => !proseTags.has(tag.name));
    if (unsupported !== undefined) {
      throw new Error(
        `Unsupported @${unsupported.name} on type alias ${node.name.text}; place contract annotations on an interface or property to avoid TypeScript alias erasure`,
      );
    }
  }
  if (ts.isInterfaceDeclaration(node)) {
    const inherited = new Map<string, ts.Symbol>();
    for (const clause of node.heritageClauses ?? [])
      for (const base of clause.types) {
        for (const property of checker.getPropertiesOfType(checker.getTypeAtLocation(base))) {
          const previous = inherited.get(property.name);
          if (
            previous !== undefined &&
            (hasContractTags(previous, checker) || hasContractTags(property, checker))
          ) {
            throw new Error(
              `Ambiguous inherited annotations at ${node.name.text}.${property.name}; declare one authoritative property`,
            );
          }
          inherited.set(property.name, property);
        }
      }
    for (const member of node.members)
      if (ts.isPropertySignature(member)) {
        const symbol = checker.getSymbolAtLocation(member.name);
        const base = symbol === undefined ? undefined : inherited.get(symbol.name);
        if (base !== undefined && hasContractTags(base, checker)) {
          throw new Error(
            `Overridden annotated property ${node.name.text}.${base.name}; retain the inherited declaration or use a separate model`,
          );
        }
      }
  }
  if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
    const name = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
    const reference = checker.getSymbolAtLocation(name);
    const symbol =
      reference !== undefined && reference.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(reference)
        : reference;
    for (const declaration of symbol?.declarations ?? []) {
      if (
        !declaration.getSourceFile().hasNoDefaultLib &&
        (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration))
      ) {
        inspectDocumentationDependencies(declaration, checker, seen);
      }
    }
  }
  ts.forEachChild(node, (child) => {
    if (!ts.isBlock(child)) inspectDocumentationDependencies(child, checker, seen);
  });
}

/** Whether a symbol adds machine-readable semantics beyond ordinary explanatory prose. */
function hasContractTags(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  return symbol.getJsDocTags(checker).some((tag) => !proseTags.has(tag.name));
}

/** Parse examples/defaults as JSON, never executable expressions or coerced values. */
function documentationValue(text: string, location: string): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON at ${location}`);
  }
  if (!isJsonValue(value)) throw new Error(`Expected finite JSON data at ${location}`);
  return value;
}

/** Preserve explanatory remarks in addition to the declaration's leading prose. */
function descriptionFor(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  return [
    ts.displayPartsToString(symbol.getDocumentationComment(checker)),
    ...symbol
      .getJsDocTags(checker)
      .filter((tag) => tag.name === "remarks")
      .map((tag) => ts.displayPartsToString(tag.text)),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Apply an integer assertion to every numeric alternative, preserving explicit null. */
function integerSchema(schema: JsonSchema, location: string): void {
  if (schema.type === "number" || schema.type === "integer") {
    schema.type = "integer";
    return;
  }
  if (schema.anyOf !== undefined && schema.anyOf.some((part) => part.type !== "null")) {
    for (const part of schema.anyOf) if (part.type !== "null") integerSchema(part, location);
    return;
  }
  throw new Error(`@isInt requires a numeric type at ${location}`);
}

/** Compile the supported annotation vocabulary and reject unknown or contradictory claims. */
function documentedSchema(
  schema: JsonSchema,
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
  location: string,
): JsonSchema {
  if (symbol === undefined) return schema;
  const description = descriptionFor(symbol, checker);
  if (description) schema.description = description;
  const seen = new Set<string>();
  for (const tag of symbol.getJsDocTags(checker)) {
    const text = ts.displayPartsToString(tag.text).trim();
    if (proseTags.has(tag.name)) continue;
    if (seen.has(tag.name) && tag.name !== "example")
      throw new Error(`Repeated @${tag.name} at ${location}`);
    seen.add(tag.name);
    if (numericTags.has(tag.name)) {
      const value = documentationValue(text, `${location} @${tag.name}`);
      if (typeof value !== "number")
        throw new Error(`@${tag.name} requires a number at ${location}`);
      Object.defineProperty(schema, tag.name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else if (tag.name === "example") {
      (schema.examples ??= []).push(documentationValue(text, `${location} @example`));
    } else if (tag.name === "default")
      schema.default = documentationValue(text, `${location} @default`);
    else if (tag.name === "title") {
      if (!text) throw new Error(`Empty @title at ${location}`);
      schema.title = text;
    } else if (tag.name === "deprecated") schema.deprecated = true;
    else if (tag.name === "pattern") schema.pattern = text;
    else if (tag.name === "format") {
      if (text !== "uuid")
        throw new Error(`Unsupported @format ${text} at ${location}; only uuid is asserted`);
      schema.format = "uuid";
    } else if (tag.name === "isInt") {
      if (text) throw new Error(`@isInt takes no value at ${location}`);
      integerSchema(schema, location);
    } else
      throw new Error(
        `Unsupported documentation tag @${tag.name} at ${location}; use TypeScript for allowed values and nullability`,
      );
  }
  const checked = validateSchema(schema, null);
  if (!checked.ok) {
    const invalid = checked.issues.find((issue) => issue.code === "invalid_schema");
    if (invalid !== undefined)
      throw new Error(`Invalid documentation at ${location}${invalid.path}: ${invalid.message}`);
  }
  return schema;
}

/** Add model/alias documentation after deriving its structurally supported JSON shape. */
function schemaFor(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: string,
  stack = new Set<ts.Type>(),
): JsonSchema {
  return documentedSchema(
    schemaShapeFor(checker, type, location, stack),
    type.aliasSymbol ?? type.getSymbol(),
    checker,
    location,
  );
}

/** Derive the supported closed JSON structure, rejecting recursion, unsafe types, and constructs that cannot be preserved. */
function schemaShapeFor(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: string,
  stack: Set<ts.Type>,
): JsonSchema {
  if (
    type.flags &
    (ts.TypeFlags.Any |
      ts.TypeFlags.Unknown |
      ts.TypeFlags.Never |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Void |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.NonPrimitive |
      ts.TypeFlags.TypeParameter)
  ) {
    throw new Error(`Unsupported type at ${location}: ${checker.typeToString(type)}`);
  }
  if (type.flags & ts.TypeFlags.Null) return { type: "null" };
  if (type.isStringLiteral()) return { type: "string", const: type.value };
  if (type.isNumberLiteral()) return { type: "number", const: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral)
    return { type: "boolean", const: checker.typeToString(type) === "true" };
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (stack.has(type))
    throw new Error(`Recursive type at ${location}: ${checker.typeToString(type)}`);
  stack.add(type);
  try {
    if (type.isUnion()) {
      const variants = type.types.map((part) => schemaFor(checker, part, location, stack));
      variants.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
      return { anyOf: variants };
    }
    if (type.isIntersection()) {
      // Merge only structural object intersections. Primitive brands, arrays,
      // callables and impossible properties cannot be represented this way.
      const seenProperties = new Map<string, ts.Symbol>();
      for (const part of type.types) {
        if (schemaFor(checker, part, location, stack).type !== "object") {
          throw new Error(`Unsupported intersection at ${location}`);
        }
        const partSymbol = part.aliasSymbol ?? part.getSymbol();
        if (partSymbol !== undefined && hasContractTags(partSymbol, checker)) {
          throw new Error(
            `Unsupported annotated intersection component at ${location}; use one authoritative interface model`,
          );
        }
        for (const property of checker.getPropertiesOfType(part)) {
          const previous = seenProperties.get(property.name);
          if (
            previous !== undefined &&
            (hasContractTags(previous, checker) || hasContractTags(property, checker))
          ) {
            throw new Error(
              `Ambiguous intersection annotations at ${location}.${property.name}; declare one authoritative property`,
            );
          }
          seenProperties.set(property.name, property);
        }
      }
    }
    if (checker.isTupleType(type)) throw new Error(`Unsupported tuple at ${location}`);
    if (checker.isArrayType(type)) {
      const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (!element) throw new Error(`Unsupported array at ${location}`);
      return { type: "array", items: schemaFor(checker, element, `${location}[]`, stack) };
    }
    if (!(type.flags & ts.TypeFlags.Object) && !type.isIntersection())
      throw new Error(`Unsupported type at ${location}: ${checker.typeToString(type)}`);
    const symbol = type.getSymbol();
    const declarations = symbol?.getDeclarations() ?? [];
    if (
      declarations.some(
        (d) => ts.isClassDeclaration(d) || ts.isClassExpression(d) || ts.isEnumDeclaration(d),
      )
    ) {
      throw new Error(`Unsupported class or enum at ${location}`);
    }
    if (
      checker.getSignaturesOfType(type, ts.SignatureKind.Call).length ||
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length ||
      checker.getIndexInfosOfType(type).length
    ) {
      throw new Error(`Unsupported callable or index signature at ${location}`);
    }
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const property of checker
      .getPropertiesOfType(type)
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = property.getName();
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (
        !declaration ||
        name.startsWith("__@") ||
        property.flags & ts.SymbolFlags.Method ||
        ts.isGetAccessorDeclaration(declaration) ||
        ts.isSetAccessorDeclaration(declaration)
      )
        throw new Error(`Unsupported property ${location}.${name}`);
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      const optional = Boolean(property.flags & ts.SymbolFlags.Optional);
      // Optional members may contain undefined due to TypeScript's optional semantics.
      const parts =
        propertyType.isUnion() && optional
          ? propertyType.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined))
          : [propertyType];
      if (parts.length === 0) throw new Error(`Unsupported type at ${location}.${name}`);
      let propertySchema: JsonSchema;
      if (parts.length === 1) {
        const part = parts[0];
        if (!part) throw new Error(`Unsupported type at ${location}.${name}`);
        propertySchema = schemaFor(checker, part, `${location}.${name}`, stack);
      } else {
        const variants = parts.map((part) =>
          schemaFor(checker, part, `${location}.${name}`, stack),
        );
        variants.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
        propertySchema = { anyOf: variants };
      }
      propertySchema = documentedSchema(propertySchema, property, checker, `${location}.${name}`);
      Object.defineProperty(properties, name, {
        value: propertySchema,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      if (!optional) required.push(name);
    }
    return { type: "object", properties, required, additionalProperties: false };
  } finally {
    stack.delete(type);
  }
}

/** Derive closed schemas from named TypeScript type exports. Paths are relative to the tsconfig directory. */
export function compileTypeSchemas(options: CompileTypeSchemasOptions): Record<string, JsonSchema> {
  return createSchemaCompiler(options).compileTypes(options.typeNames);
}

/** Compile named model contracts from an already checked project snapshot. */
function typeSchemas(compiler: Compiler, names: readonly string[]): Record<string, JsonSchema> {
  const result: Record<string, JsonSchema> = {};
  for (const name of [...new Set(names)].sort()) {
    const symbol = exportedSymbol(compiler, name);
    for (const declaration of symbol.declarations ?? [])
      inspectDocumentationDependencies(declaration, compiler.checker);
    if (!(symbol.flags & ts.SymbolFlags.Type)) throw new Error(`Export is not a type: ${name}`);
    Object.defineProperty(result, name, {
      value: schemaFor(compiler.checker, compiler.checker.getDeclaredTypeOfSymbol(symbol), name),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** Derive schemas from named functions: a required input object, an optional host context parameter, and a JSON-serializable return. */
export function compileToolSchemas(
  options: CompileToolSchemasOptions,
): Record<string, ToolSchemas> {
  return createSchemaCompiler(options).compileTools(options.functionNames);
}

/** Derive one input, awaited output, and source documentation record per supported exported function. */
function toolSchemas(compiler: Compiler, names: readonly string[]): Record<string, ToolSchemas> {
  const result: Record<string, ToolSchemas> = {};
  for (const name of [...new Set(names)].sort()) {
    const symbol = exportedSymbol(compiler, name);
    const declaration = symbol.valueDeclaration;
    if (!declaration) throw new Error(`Export is not a function: ${name}`);
    const signatures = compiler.checker.getSignaturesOfType(
      compiler.checker.getTypeOfSymbolAtLocation(symbol, declaration),
      ts.SignatureKind.Call,
    );
    if (signatures.length !== 1)
      throw new Error(`Tool ${name} must have exactly one non-overloaded call signature`);
    const signature = signatures[0];
    if (
      !signature ||
      signature.thisParameter ||
      signature.typeParameters?.length ||
      signature.parameters.length < 1 ||
      signature.parameters.length > 2
    )
      throw new Error(
        `Tool ${name} must have one required input parameter, at most one host context parameter, no this parameter, and no type parameters`,
      );
    const parameter = signature.parameters[0];
    if (
      !parameter ||
      parameter.flags & ts.SymbolFlags.Optional ||
      !parameter.valueDeclaration ||
      (ts.isParameter(parameter.valueDeclaration) &&
        (parameter.valueDeclaration.dotDotDotToken ||
          parameter.valueDeclaration.questionToken ||
          parameter.valueDeclaration.initializer))
    )
      throw new Error(`Tool ${name} must have one required input parameter`);
    inspectDocumentationDependencies(parameter.valueDeclaration, compiler.checker);
    const returnTypeNode = signature.getDeclaration()?.type;
    if (returnTypeNode !== undefined)
      inspectDocumentationDependencies(returnTypeNode, compiler.checker);
    const contextParameter = signature.parameters[1];
    if (
      contextParameter?.valueDeclaration &&
      ts.isParameter(contextParameter.valueDeclaration) &&
      contextParameter.valueDeclaration.dotDotDotToken
    )
      throw new Error(`Tool ${name} cannot have a rest context parameter`);
    const input = compiler.checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration);
    const inputSchema = schemaFor(compiler.checker, input, `${name} input`);
    if (inputSchema.type !== "object") throw new Error(`Tool ${name} input must be an object`);
    const resultType = compiler.checker.getAwaitedType(signature.getReturnType());
    if (!resultType) throw new Error(`Tool ${name} has an unsupported return type`);
    const outputSchema = schemaFor(compiler.checker, resultType, `${name} output`);
    const description = descriptionFor(symbol, compiler.checker);
    let title: string | undefined;
    let resultDescription: string | undefined;
    let deprecated: boolean | undefined;
    for (const tag of symbol.getJsDocTags(compiler.checker)) {
      const text = ts.displayPartsToString(tag.text).trim();
      if (tag.name === "summary") {
        if (!text || title !== undefined) throw new Error(`Invalid @summary on ${name}`);
        title = text;
      } else if (tag.name === "returns" || tag.name === "return") resultDescription = text;
      else if (tag.name === "deprecated") deprecated = true;
      else if (tag.name === "example")
        (inputSchema.examples ??= []).push(documentationValue(text, `${name} @example input`));
      else if (tag.name !== "tubular" && !proseTags.has(tag.name))
        throw new Error(`Unsupported function documentation tag @${tag.name} on ${name}`);
    }
    const checked = validateSchema(inputSchema, null);
    if (!checked.ok && checked.issues.some((issue) => issue.code === "invalid_schema"))
      throw new Error(`Invalid input example on ${name}`);
    const documentation: ToolDocumentation = {
      ...(description ? { description } : {}),
      ...(title === undefined ? {} : { title }),
      ...(resultDescription === undefined ? {} : { resultDescription }),
      ...(deprecated === undefined ? {} : { deprecated }),
    };
    Object.defineProperty(result, name, {
      value: {
        inputSchema,
        outputSchema,
        ...(Object.keys(documentation).length ? { documentation } : {}),
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** Tool schema compilation plus output locations needed to bind the actual exported handlers and fingerprint their dependencies. */
export interface CompileToolBindingsOptions extends CompileToolSchemasOptions {
  /** Destination determines the relative handler import. */
  readonly outputFile: string;
}

/** Generate direct imports and immutable schema/handler factories, never a name lookup. */
export function compileToolBindings(options: CompileToolBindingsOptions): string {
  return createSchemaCompiler(options).compileBindings(options.functionNames, options.outputFile);
}

/** Render direct bindings using the same checked program as the schema projection. */
function toolBindings(
  compiler: Compiler,
  schemas: Record<string, ToolSchemas>,
  outputFile: string,
): string {
  const directory = compiler.directory;
  const entry = compiler.entryPath;
  const output = path.resolve(compiler.currentDirectory, outputFile);
  if (entry === output) throw new Error("Bindings must not overwrite their source entry");
  if (!/\.(?:ts|mts|cts)$/.test(entry) || /\.d\.(?:ts|mts|cts)$/.test(entry))
    throw new Error("Bindings require a TypeScript implementation entry");
  let specifier = path
    .relative(path.dirname(output), entry)
    .split(path.sep)
    .join("/")
    .replace(/\.mts$/, ".mjs")
    .replace(/\.cts$/, ".cjs")
    .replace(/\.ts$/, ".js");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  const sources = compiler.program
    .getSourceFiles()
    .filter(
      (file) =>
        path.resolve(file.fileName) !== output &&
        !compiler.program.isSourceFileDefaultLibrary(file) &&
        !compiler.program.isSourceFileFromExternalLibrary(file),
    )
    .map((file) => [path.relative(directory, file.fileName).split(path.sep).join("/"), file.text])
    .sort((a, b) => ((a[0] ?? "") < (b[0] ?? "") ? -1 : (a[0] ?? "") > (b[0] ?? "") ? 1 : 0));
  const sourceDigest = sha256(JSON.stringify({ compiler: ts.version, sources, schemas }));
  const lines = [
    "// Generated by tubular. Regenerate and use --check in CI.",
    'import { bindTool } from "@juxnow/tubular";',
  ];
  Object.entries(schemas).forEach(([name, schema], index) => {
    // String-named imports also handle aliases and reserved export names safely.
    lines.push(
      `import { ${JSON.stringify(name)} as handler${index} } from ${JSON.stringify(specifier)};`,
    );
    lines.push(
      `const binding${index} = bindTool(handler${index}, ${JSON.stringify(schema, null, 2)}, ${JSON.stringify({ entry: path.relative(directory, entry).split(path.sep).join("/"), exportName: name, sourceDigest }, null, 2)});`,
    );
    lines.push(`export { binding${index} as ${JSON.stringify(name)} };`);
  });
  return `${lines.join("\n")}\n`;
}

/** Reusable checked project snapshot. Create a new session after changing source files. */
export interface SchemaCompiler {
  /** Derive selected exported model schemas without recompiling the TypeScript project. */
  compileTypes(names: readonly string[]): Record<string, JsonSchema>;
  /** Derive selected handler schemas and documentation from this exact project snapshot. */
  compileTools(names: readonly string[]): Record<string, ToolSchemas>;
  /** Render direct bindings without emitting; output paths resolve from the captured host working directory. */
  compileBindings(names: readonly string[], outputFile: string): string;
}

/** Check a project once, then derive related contracts from the same immutable source snapshot. */
export function createSchemaCompiler(options: SchemaProjectOptions): SchemaCompiler {
  const compiler = createCompiler(options);
  const toolCache = new Map<string, Record<string, ToolSchemas>>();
  const projectTools = (names: readonly string[]): Record<string, ToolSchemas> => {
    const selected = [...new Set(names)].sort();
    const key = JSON.stringify(selected);
    let schemas = toolCache.get(key);
    if (schemas === undefined) {
      schemas = toolSchemas(compiler, selected);
      toolCache.set(key, schemas);
    }
    return structuredClone(schemas);
  };
  return Object.freeze({
    compileTypes: (names: readonly string[]) => typeSchemas(compiler, names),
    compileTools: projectTools,
    compileBindings: (names: readonly string[], outputFile: string) =>
      toolBindings(compiler, projectTools(names), outputFile),
  });
}
