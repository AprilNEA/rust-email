import { snakeCase } from "change-case";
import type { PropMeta, PropSchema } from "./types";

export interface SchemaResult {
  schema: PropSchema;
  interfaceName: string;
  componentName: string;
}

/**
 * Infer a PropSchema from a react-email component's TypeScript source file.
 *
 * Uses ts-morph to parse the TypeScript AST and extract:
 * - Props interface (by convention: interface ending with "Props")
 * - Property names, types, optionality
 * - Fallback values from `{prop ?? fallback}` patterns in JSX
 */
export async function inferSchema(filePath: string): Promise<SchemaResult> {
  let tsmorph: typeof import("ts-morph");
  try {
    tsmorph = await import("ts-morph");
  } catch {
    throw new Error(
      "rust-email: ts-morph is required for schema inference. Install it with: pnpm add -D ts-morph",
    );
  }

  const { Project, SyntaxKind } = tsmorph;

  const project = new Project({
    compilerOptions: {
      jsx: tsmorph.ts.JsxEmit.ReactJSX,
      strict: true,
      skipLibCheck: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFile = project.addSourceFileAtPath(filePath);

  // Find the props interface (convention: name ends with "Props")
  const interfaces = sourceFile.getInterfaces();
  const propsInterface =
    interfaces.find((i) => i.getName().endsWith("Props")) ?? interfaces[0];

  if (!propsInterface) {
    throw new Error(
      `rust-email: no interface found in ${filePath}. Expected an interface ending with "Props".`,
    );
  }

  // Find the component name (default export or first exported function/const)
  let componentName = "Unknown";
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (defaultExport) {
    componentName = defaultExport.getName();
    // "default" means we need to look at the actual declaration
    if (componentName === "default") {
      const decl = defaultExport.getDeclarations()[0];
      if (decl) {
        const exportAssignment = decl.asKind(SyntaxKind.ExportAssignment);
        if (exportAssignment) {
          componentName = exportAssignment.getExpression().getText();
        }
      }
    }
  }

  // Extract props from interface
  const schema: PropSchema = {};

  for (const prop of propsInterface.getProperties()) {
    const name = prop.getName();
    const isOptional = prop.hasQuestionToken();
    const typeText = resolveTypeText(prop.getType().getText());

    schema[name] = {
      type: typeText,
      optional: isOptional,
    };
  }

  // Scan JSX for `{propName ?? fallbackValue}` patterns to extract fallback values
  extractFallbacks(sourceFile, schema, SyntaxKind);

  return {
    schema,
    interfaceName: propsInterface.getName(),
    componentName,
  };
}

/**
 * Map TypeScript type text to our simplified PropMeta type.
 */
function resolveTypeText(
  typeText: string,
): "string" | "number" | "boolean" | "string[]" | "object" {
  // Strip union with undefined (from optional)
  const cleaned = typeText.replace(/\s*\|\s*undefined/g, "").trim();

  if (cleaned === "string") return "string";
  if (cleaned === "number") return "number";
  if (cleaned === "boolean") return "boolean";
  if (cleaned === "string[]" || cleaned === "Array<string>") return "string[]";
  return "object";
}

/**
 * Walk the AST looking for `{identifier ?? literal}` binary expressions.
 * When the left-hand identifier matches a prop name, record the right-hand
 * literal as the prop's fallback value.
 */
function extractFallbacks(
  sourceFile: import("ts-morph").SourceFile,
  schema: PropSchema,
  SK: typeof import("ts-morph").SyntaxKind,
): void {
  const binaryExprs = sourceFile.getDescendantsOfKind(SK.BinaryExpression);

  for (const expr of binaryExprs) {
    const op = expr.getOperatorToken();
    if (op.getKind() !== SK.QuestionQuestionToken) continue;

    const left = expr.getLeft();
    if (left.getKind() !== SK.Identifier) continue;

    const propName = left.getText();
    if (!(propName in schema) || !schema[propName].optional) continue;

    // Already has a fallback from a previous occurrence — skip
    if (schema[propName].fallback !== undefined) continue;

    const right = expr.getRight();
    const rightKind = right.getKind();

    if (rightKind === SK.StringLiteral || rightKind === SK.NoSubstitutionTemplateLiteral) {
      // Strip surrounding quotes
      const text = right.getText();
      schema[propName].fallback = text.slice(1, -1);
    } else if (rightKind === SK.NumericLiteral) {
      schema[propName].fallback = Number(right.getText());
    }
  }
}

/**
 * Convert a PropSchema's keys from camelCase to snake_case.
 * Returns a new schema with snake_case keys.
 */
export function schemaToSnakeCase(schema: PropSchema): PropSchema {
  const result: PropSchema = {};
  for (const [key, meta] of Object.entries(schema)) {
    result[snakeCase(key)] = meta;
  }
  return result;
}
