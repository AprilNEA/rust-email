# API Reference

## `renderTemplate(Component, props, schema, config?)`

Render a react-email component into an Askama-compatible HTML template, and optionally a plain-text template.

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
| `plainText` | `boolean \| PlainTextConfig` | `false` | Also generate a plain-text template |

**Returns:** `{ html: string, text?: string, warnings: string[] }`. When `plainText` is set, `text` has the type `string`.

Throws on any structural error (non-contiguous conditional blocks, missing required markers, residual markers).

**Plain text:** rust-email converts each render with `toPlainText` from `@react-email/render`, then runs the same replacement on the text. React Email's rules apply: images are skipped, a link whose text equals its URL is printed once, and headings are upper case. The text template never gets the `|e` filter. A prop that the text does not use, such as an image URL, adds a warning instead of an error.

Pass `{ htmlToTextOptions }` to change the conversion. Custom `selectors` extend React Email's selectors: html-to-text merges selectors with the same `selector` value, and the later one wins. This example keeps headings in their case:

```typescript
const { html, text } = await renderTemplate(Email, props, schema, {
  plainText: {
    htmlToTextOptions: {
      selectors: ["h1", "h2", "h3"].map((selector) => ({
        selector,
        options: { uppercase: false },
      })),
    },
  },
});
```

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
| `textTemplatePath` | `string?` | — | Plain-text template for a `render_text()` method |
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

**Plain-text template:** with `textTemplatePath`, the output also has a private wrapper struct `{structName}Text` and a `render_text()` method. The wrapper borrows the struct and implements `Deref`, so the text template reads the same fields:

```rust
impl Welcome {
    /// Renders the plain-text template `auth/welcome.txt`.
    pub fn render_text(&self) -> askama::Result<String> {
        WelcomeText(self).render()
    }
}

#[derive(Template)]
#[template(path = "auth/welcome.txt")]
struct WelcomeText<'a>(&'a Welcome);
```

---

## `generateRustModule(templates)`

Batch version of `generateRustStruct` — generates a complete Rust module with `use askama::Template;` and multiple structs.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `templates` | `Array<{ schema, config }>` | Array of schema + config pairs |

---

## `generateLocalizedRustModule(templates, localeConfig)`

Generate a Rust module for emails that have one template set per locale. The module contains `use askama::Template;`, the locale enum from `generateLocaleEnum()` and one struct per email from `generateLocalizedRustStruct()`.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `templates` | `Array<{ schema, config: LocalizedCodegenConfig }>` | One entry per email |
| `localeConfig` | `LocaleEnumConfig` | Locale tags and the enum name |

Render each locale with `renderTemplate()` first. Pass the locale to the component as a prop that is not in the schema, so that each render uses the copy of that locale.

---

## `generateLocaleEnum(localeConfig)`

Generate the locale enum. Each tag becomes a PascalCase variant: `zh-Hans` → `ZhHans`, `en` → `En`.

| Option | Type | Default | Description |
|---|---|---|---|
| `locales` | `string[]` | — | Locale tags in declaration order |
| `localeEnum` | `string?` | `"Locale"` | Enum name |

The enum derives `Clone, Copy, Debug, PartialEq, Eq, Hash` and has these items:

| Item | Description |
|---|---|
| `Locale::ALL` | Every locale, in declaration order |
| `locale.tag()` | The locale tag, such as `"zh-Hans"` |
| `Locale::from_tag(tag)` | The locale whose tag equals `tag`, ignoring ASCII case, or `None` |

Throws if `locales` is empty, has a duplicate tag, or has two tags that convert to the same variant, such as `zh-Hans` and `zh_hans`.

---

## `generateLocalizedRustStruct(schema, config, localeConfig)`

Generate the struct of one localized email. The struct holds the props and has no `Template` derive. Private wrapper structs, one per template, borrow it and implement `Deref`.

**Config options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `structName` | `string` | — | Rust struct name |
| `derives` | `string[]?` | — | `#[derive(...)]` entries for the struct |
| `numberType` | `string` | `"i64"` | Rust numeric type |
| `locales` | `LocaleTemplateConfig[]` | — | One entry per locale of `localeConfig` |

Each `LocaleTemplateConfig` has `locale`, `templatePath`, and optionally `textTemplatePath`, `subjectTemplate` and `subjectProps`. The subject rules of `generateRustStruct()` apply to each locale.

**Generated methods:**

| Method | When |
|---|---|
| `render_html(&self, locale) -> askama::Result<String>` | Always |
| `render_text(&self, locale) -> askama::Result<String>` | Every locale sets `textTemplatePath` |
| `subject(&self, locale) -> String` | Every locale sets `subjectTemplate` |

Each method matches on every variant, so the Rust compiler rejects a missing locale. Throws if a locale of `localeConfig` has no entry, if an entry has an unknown or repeated locale, or if only some locales set `textTemplatePath` or `subjectTemplate`.

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
    Will be removed in v0.5.0. Use `renderTemplate()` instead. AskamaWrapper replaces props before React renders, which breaks `&&` and `??` patterns.

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
  plainText?: boolean | PlainTextConfig;
}
```

### `PlainTextConfig`

```typescript
interface PlainTextConfig {
  // Options of html-to-text, as accepted by toPlainText from @react-email/render
  htmlToTextOptions?: HtmlToTextOptions;
}
```

### `CodegenConfig`

```typescript
interface CodegenConfig {
  templatePath: string;
  textTemplatePath?: string;
  structName: string;
  derives?: string[];
  numberType?: "i32" | "i64" | "u32" | "u64" | "f32" | "f64";
  subjectTemplate?: string;
  subjectProps?: string[];
}
```

### `LocalizedCodegenConfig`

```typescript
interface LocalizedCodegenConfig {
  structName: string;
  derives?: string[];
  numberType?: "i32" | "i64" | "u32" | "u64" | "f32" | "f64";
  locales: LocaleTemplateConfig[];
}

interface LocaleTemplateConfig {
  locale: string;
  templatePath: string;
  textTemplatePath?: string;
  subjectTemplate?: string;
  subjectProps?: string[];
}
```

### `LocaleEnumConfig`

```typescript
interface LocaleEnumConfig {
  locales: string[];
  localeEnum?: string;
}
```

### `RenderResult`

```typescript
interface RenderResult {
  html: string;
  text?: string;
  warnings: string[];
}
```
