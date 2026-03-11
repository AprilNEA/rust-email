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

  // Find the component function node to scope fallback extraction.
  // This prevents helper functions in the same file from polluting the schema.
  const componentNode = findComponentNode(sourceFile, componentName, SyntaxKind);

  // Scan JSX for `{propName ?? fallbackValue}` patterns to extract fallback values.
  // Only walk the component function body — not the entire file.
  extractFallbacks(componentNode ?? sourceFile, schema, SyntaxKind);

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
 * Walk the AST looking for `expr ?? literal` binary expressions.
 *
 * The `scopeNode` should be the component function body (not the whole file)
 * to prevent helper functions from polluting the schema.
 *
 * Left-hand side can be:
 * - `identifier` (plain prop name — must be a destructured prop, not a local var)
 * - `props.xxx` (property access where the object is the component's props parameter)
 * - `(props.xxx)` or `(identifier)` (parenthesized)
 *
 * Right-hand side supports string, number, and boolean literals.
 * Dynamic expressions on the right are ignored (no fallback inferred).
 */
function extractFallbacks(
  scopeNode: import("ts-morph").Node,
  schema: PropSchema,
  SK: typeof import("ts-morph").SyntaxKind,
): void {
  // Collect the names of the component's props parameter(s) so we can
  // distinguish `props.foo ?? x` from `someOtherObj.foo ?? x`.
  // Scope to the immediate function containing scopeNode.
  const propsParamNames = collectPropsParamNames(scopeNode, schema, SK);

  // Collect destructured prop identifiers from the component function's parameter.
  // e.g. `function Email({ name, age }: Props)` → Map{"name" → "name", "age" → "age"}
  // e.g. `function Email({ name: userName }: Props)` → Map{"userName" → "name"}
  const destructuredPropNames = collectDestructuredPropNames(scopeNode, SK);

  const binaryExprs = scopeNode.getDescendantsOfKind(SK.BinaryExpression);

  for (const expr of binaryExprs) {
    const op = expr.getOperatorToken();
    if (op.getKind() !== SK.QuestionQuestionToken) continue;

    // Resolve left-hand side to a prop name
    const propName = resolveLeftHandPropName(expr.getLeft(), SK, propsParamNames, destructuredPropNames);
    if (propName === null) continue;
    if (!(propName in schema) || !schema[propName].optional) continue;

    // Skip if a nested function between here and scopeNode shadows the identifier.
    // e.g. `function helper(name) { name ?? "x" }` — `name` is the helper's param, not the prop.
    // But `items.map(() => name ?? "x")` is fine — no shadowing, `name` still refers to the prop.
    const lhsIdentifier = extractLhsIdentifier(expr.getLeft(), SK);
    if (lhsIdentifier !== null && isShadowedByNestedFunction(expr, scopeNode, lhsIdentifier, SK)) continue;

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
    } else if (rightKind === SK.TrueKeyword) {
      schema[propName].fallback = true;
    } else if (rightKind === SK.FalseKeyword) {
      schema[propName].fallback = false;
    }
    // Other dynamic expressions: no fallback inferred, which is correct
  }
}

/**
 * Resolve the left-hand side of a `??` expression to a schema prop name.
 *
 * Supports:
 * - `bindingName` → schema key (only if it's a destructured prop binding)
 * - `props.propName` → "propName" (only if `props` is a known props parameter name)
 * - `(expr)` → unwrap parens and recurse
 *
 * Returns the **schema key** (original prop name), not the local binding name.
 * Returns null if the expression doesn't match any supported pattern.
 */
function resolveLeftHandPropName(
  node: import("ts-morph").Node,
  SK: typeof import("ts-morph").SyntaxKind,
  propsParamNames: Set<string>,
  destructuredPropNames: Map<string, string>,
): string | null {
  const kind = node.getKind();

  // Plain identifier: `userName` — check if it's a destructured prop binding
  // and resolve to the original schema key (e.g. `{ name: userName }` → "name")
  if (kind === SK.Identifier) {
    const name = node.getText();
    const schemaPropName = destructuredPropNames.get(name);
    if (schemaPropName !== undefined) {
      return schemaPropName;
    }
    // Not a known destructured prop — could be a local variable with the same name
    return null;
  }

  // Property access: `obj.propName` — only accept if obj is a known props param
  if (kind === SK.PropertyAccessExpression) {
    const propAccess = node.asKindOrThrow(SK.PropertyAccessExpression);
    const objText = propAccess.getExpression().getText();
    if (propsParamNames.has(objText)) {
      return propAccess.getName();
    }
    // Unknown object — don't infer
    return null;
  }

  // Parenthesized: `(expr)` — unwrap and recurse
  if (kind === SK.ParenthesizedExpression) {
    const paren = node.asKindOrThrow(SK.ParenthesizedExpression);
    return resolveLeftHandPropName(paren.getExpression(), SK, propsParamNames, destructuredPropNames);
  }

  return null;
}

/**
 * Extract the raw identifier text from the LHS of a `??` expression.
 *
 * For plain identifiers: returns the identifier text (e.g. "name", "userName").
 * For property access `props.name`: returns "props" (the object being accessed).
 * For parenthesized: unwraps and recurses.
 *
 * This is used to check parameter shadowing in nested functions.
 */
function extractLhsIdentifier(
  node: import("ts-morph").Node,
  SK: typeof import("ts-morph").SyntaxKind,
): string | null {
  const kind = node.getKind();
  if (kind === SK.Identifier) {
    return node.getText();
  }
  if (kind === SK.PropertyAccessExpression) {
    // For `props.name`, the relevant identifier to check for shadowing is "props"
    const propAccess = node.asKindOrThrow(SK.PropertyAccessExpression);
    return propAccess.getExpression().getText();
  }
  if (kind === SK.ParenthesizedExpression) {
    const paren = node.asKindOrThrow(SK.ParenthesizedExpression);
    return extractLhsIdentifier(paren.getExpression(), SK);
  }
  return null;
}

/**
 * Check whether a nested function between `node` and `scopeNode` shadows
 * the given identifier by declaring a parameter with the same name.
 *
 * This allows callback closures like `items.map(() => name ?? "x")` to pass
 * (no shadowing), while blocking `function helper(name) { name ?? "x" }`
 * (parameter `name` shadows the component's prop).
 */
function isShadowedByNestedFunction(
  node: import("ts-morph").Node,
  scopeNode: import("ts-morph").Node,
  identifierName: string,
  SK: typeof import("ts-morph").SyntaxKind,
): boolean {
  let current = node.getParent();
  while (current && current !== scopeNode) {
    const k = current.getKind();
    if (
      k === SK.FunctionDeclaration ||
      k === SK.ArrowFunction ||
      k === SK.FunctionExpression
    ) {
      // Check if this function declares a parameter that shadows the identifier
      const params = getParametersFromNode(current, SK);
      for (const param of params) {
        const nameNode = param.getNameNode();
        if (nameNode.getKind() === SK.ObjectBindingPattern) {
          // Destructured param: only binding names are local variables.
          // Example: ({ name: n }) declares `n`, not `name`.
          const binding = nameNode.asKindOrThrow(SK.ObjectBindingPattern);
          for (const element of binding.getElements()) {
            if (element.getName() === identifierName) return true;
          }
        } else if (param.getName() === identifierName) {
          return true;
        }
      }
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Find the component function/arrow node by name.
 *
 * Handles:
 * - `function ComponentName(props: Props) { ... }`
 * - `const ComponentName = (props: Props) => { ... }`
 * - `const ComponentName = memo((props: Props) => { ... })` (call-wrapped)
 * - `export default function ComponentName(...)`
 * - `export default (props: Props) => ...` (anonymous arrow)
 * - `export default ComponentName` (looks up the declaration)
 */
function findComponentNode(
  sourceFile: import("ts-morph").SourceFile,
  componentName: string,
  SK: typeof import("ts-morph").SyntaxKind,
): import("ts-morph").Node | null {
  // Try function declaration
  const funcDecl = sourceFile.getFunction(componentName);
  if (funcDecl) return funcDecl;

  // Try variable declaration: `const Comp = (...) => ...` or `const Comp = memo((...) => ...)`
  const varDecl = sourceFile.getVariableDeclaration(componentName);
  if (varDecl) {
    const init = varDecl.getInitializer();
    if (init) {
      const unwrapped = unwrapToFunction(init, SK);
      if (unwrapped) return unwrapped;
    }
    return varDecl;
  }

  // Try default export: `export default (...) => ...` or `export default memo((...) => ...)`
  const defaultExportDecl = sourceFile.getDefaultExportSymbol();
  if (defaultExportDecl) {
    for (const decl of defaultExportDecl.getDeclarations()) {
      // ExportAssignment: `export default <expr>`
      const exportAssignment = decl.asKind(SK.ExportAssignment);
      if (exportAssignment) {
        const expr = exportAssignment.getExpression();
        const unwrapped = unwrapToFunction(expr, SK);
        if (unwrapped) return unwrapped;
      }
      // FunctionDeclaration: `export default function(...)`
      const funcDeclNode = decl.asKind(SK.FunctionDeclaration);
      if (funcDeclNode) return funcDeclNode;
    }
  }

  return null;
}

/**
 * Unwrap an expression to find the innermost function/arrow.
 *
 * Handles:
 * - Direct arrow/function: `(props) => ...`
 * - Call expression wrapper: `memo((props) => ...)`, `forwardRef((props, ref) => ...)`
 * - Parenthesized: `((props) => ...)`
 */
function unwrapToFunction(
  node: import("ts-morph").Node,
  SK: typeof import("ts-morph").SyntaxKind,
): import("ts-morph").Node | null {
  const kind = node.getKind();

  if (kind === SK.ArrowFunction || kind === SK.FunctionExpression) {
    return node;
  }

  // Call expression: `memo((...) => ...)` — check first argument
  if (kind === SK.CallExpression) {
    const call = node.asKindOrThrow(SK.CallExpression);
    const args = call.getArguments();
    if (args.length > 0) {
      return unwrapToFunction(args[0], SK);
    }
  }

  // Parenthesized: `((...) => ...)`
  if (kind === SK.ParenthesizedExpression) {
    const paren = node.asKindOrThrow(SK.ParenthesizedExpression);
    return unwrapToFunction(paren.getExpression(), SK);
  }

  return null;
}

/**
 * Collect the parameter names that represent the component's props object
 * (non-destructured form like `function Comp(props: Props)`).
 *
 * Only examines the immediate function that `scopeNode` belongs to,
 * not all functions in the file.
 */
function collectPropsParamNames(
  scopeNode: import("ts-morph").Node,
  schema: PropSchema,
  SK: typeof import("ts-morph").SyntaxKind,
): Set<string> {
  const names = new Set<string>();
  const schemaKeys = new Set(Object.keys(schema));

  // Get the function parameters from the scope node itself
  // (scopeNode is the function/arrow node, or the source file as fallback)
  const params = getParametersFromNode(scopeNode, SK);

  for (const param of params) {
    // If the param is destructured `{ foo, bar }`, skip — those become plain identifiers
    if (param.getNameNode().getKind() === SK.ObjectBindingPattern) continue;

    const paramName = param.getName();
    const paramType = param.getType();
    const typeProps = paramType.getProperties().map((p) => p.getName());
    const overlap = typeProps.filter((p) => schemaKeys.has(p));
    if (overlap.length > 0 && overlap.length >= schemaKeys.size * 0.5) {
      names.add(paramName);
    }
  }

  return names;
}

/**
 * Collect identifiers that come from destructuring the component's props parameter.
 * e.g. `function Email({ name, age }: Props)` → Map{"name" → "name", "age" → "age"}
 * e.g. `function Email({ name: userName }: Props)` → Map{"userName" → "name"}
 *
 * Returns a map from binding name (the local identifier) to the original property name
 * (the schema key). For non-renamed bindings these are the same.
 *
 * Only examines the scope node's own parameters.
 */
function collectDestructuredPropNames(
  scopeNode: import("ts-morph").Node,
  SK: typeof import("ts-morph").SyntaxKind,
): Map<string, string> {
  const nameMap = new Map<string, string>();

  const params = getParametersFromNode(scopeNode, SK);

  for (const param of params) {
    const nameNode = param.getNameNode();
    if (nameNode.getKind() === SK.ObjectBindingPattern) {
      const binding = nameNode.asKindOrThrow(SK.ObjectBindingPattern);
      for (const element of binding.getElements()) {
        const bindingName = element.getName(); // local variable name
        const propertyNameNode = element.getPropertyNameNode();
        // If renamed: `{ name: userName }` → propertyNameNode is "name", bindingName is "userName"
        // If not renamed: `{ name }` → propertyNameNode is undefined, bindingName is "name"
        const propName = propertyNameNode ? propertyNameNode.getText() : bindingName;
        nameMap.set(bindingName, propName);
      }
    }
  }

  return nameMap;
}

/**
 * Extract parameter declarations from a function/arrow/source node.
 */
function getParametersFromNode(
  node: import("ts-morph").Node,
  SK: typeof import("ts-morph").SyntaxKind,
): import("ts-morph").ParameterDeclaration[] {
  if (node.getKind() === SK.FunctionDeclaration) {
    return node.asKindOrThrow(SK.FunctionDeclaration).getParameters();
  }
  if (node.getKind() === SK.ArrowFunction) {
    return node.asKindOrThrow(SK.ArrowFunction).getParameters();
  }
  if (node.getKind() === SK.FunctionExpression) {
    return node.asKindOrThrow(SK.FunctionExpression).getParameters();
  }
  return [];
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
