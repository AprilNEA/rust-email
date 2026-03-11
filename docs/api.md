# API Reference

## `renderTemplate(Component, props, schema, config?)`

Render a react-email component into an Askama-compatible HTML template.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `Component` | `React.ComponentType<P>` | React email component |
| `props` | `P` | Full props with all optional fields populated (typically `Component.PreviewProps`) |
| `schema` | `PropSchema` | Describes each prop's type and optionality |
| `config` | `RenderConfig` | Optional configuration |

**Config options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `useSnakeCase` | `boolean` | `true` | Convert camelCase to snake_case |
| `escapeHtml` | `boolean` | `false` | Add `\|e` filter to interpolations |

**Returns:** `{ html: string, warnings: string[] }`

Throws on any structural error (non-contiguous conditional blocks, missing required markers, residual markers).

---

## `inferSchema(filePath)`

Parse a TypeScript source file and extract the props interface automatically.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `filePath` | `string` | Path to the TypeScript component source file |

**Behavior:**

- Finds the interface ending with `Props`
- Maps TypeScript types to `PropMeta` types
- Detects `??` fallback values from JSX AST
    - LHS: `identifier`, `props.xxx`, `(props.xxx)` all supported
    - RHS: string, number, boolean literals supported; dynamic expressions ignored

**Returns:** `{ schema: PropSchema, interfaceName: string, componentName: string }`

Requires `ts-morph` as a peer dependency.

---

## `generateRustStruct(schema, config)`

Generate a Rust `#[derive(Template)]` struct from a `PropSchema`.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `schema` | `PropSchema` | Prop schema to generate from |
| `config` | `CodegenConfig` | Code generation configuration |

**Config options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `templatePath` | `string` | — | Askama `#[template(path = "...")]` value |
| `structName` | `string` | — | Rust struct name |
| `subjectTemplate` | `string?` | — | Optional format string for a `subject()` method |
| `subjectProps` | `string[]?` | — | Props to interpolate into the subject |
| `numberType` | `string` | `"i64"` | Rust numeric type |
| `derives` | `string[]?` | — | Additional `#[derive(...)]` entries |

**Subject argument rules for optional props:**

| Prop type | Generated Rust expression |
|---|---|
| `Option<String>` / `Option<object→String>` | `self.x.as_deref().unwrap_or("unknown")` |
| `Option<i64>` / `Option<bool>` | `self.x.map(\|v\| v.to_string()).unwrap_or_else(\|\| "unknown".to_string())` |
| `Option<Vec<String>>` | `self.x.as_ref().map(\|v\| v.join(", ")).unwrap_or_else(\|\| "unknown".to_string())` |

---

## `generateRustModule(templates)`

Batch version of `generateRustStruct` — generates a complete Rust module with `use askama::Template;` and multiple structs.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `templates` | `Array<{ schema, config }>` | Array of schema + config pairs |

---

## `validateTemplate(template, props, schema?)`

Check that no raw prop values or marker strings remain in the generated template. Throws on failure.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `template` | `string` | The generated HTML template |
| `props` | `Record<string, unknown>` | The original props used for rendering |
| `schema` | `PropSchema?` | Optional schema to suppress false positives when a prop's preview value matches its fallback |

---

## `AskamaWrapper(Component, defaultProps, config?)` ⚠️ Deprecated

!!! warning "Deprecated in v0.3.0"
    Will be removed in v0.4.0. Use `renderTemplate()` instead. AskamaWrapper replaces props before React renders, which breaks `&&` and `??` patterns.

    **Migration:** Replace `AskamaWrapper(Comp, props)` → `await renderTemplate(Comp, props, schema)`.

---

## Types

### `PropMeta`

```typescript
interface PropMeta {
  type: "string" | "number" | "boolean" | "string[]" | "object";
  optional: boolean;
  fallback?: string | number | boolean;
}
```

### `PropSchema`

```typescript
type PropSchema = Record<string, PropMeta>;
```

### `RenderConfig`

```typescript
interface RenderConfig {
  useSnakeCase?: boolean;
  escapeHtml?: boolean;
}
```

### `CodegenConfig`

```typescript
interface CodegenConfig {
  templatePath: string;
  structName: string;
  derives?: string[];
  numberType?: "i32" | "i64" | "u32" | "u64" | "f32" | "f64";
  subjectTemplate?: string;
  subjectProps?: string[];
}
```

### `RenderResult`

```typescript
interface RenderResult {
  html: string;
  warnings: string[];
}
```
