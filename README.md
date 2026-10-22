# rust-email

Bridge [react-email](https://react.email) templates to Rust template engines (Askama / Tera / minijinja).

Design emails with React components and hot-reload preview, then export them as Askama HTML templates with typed Rust structs — no manual conversion needed.

## Install

```bash
pnpm add rust-email @react-email/render
# optional: for automatic schema inference from TypeScript interfaces
pnpm add -D ts-morph
```

## Quick Start

```typescript
import { inferSchema, renderTemplate, generateRustStruct } from "rust-email";
import * as fs from "node:fs";

// 1. Infer prop schema from your react-email component
const { schema } = await inferSchema("./emails/auth/welcome.tsx");

// 2. Import the component
const { default: WelcomeEmail } = await import("./emails/auth/welcome.tsx");

// 3. Render to Askama template
const { html } = await renderTemplate(
  WelcomeEmail,
  WelcomeEmail.PreviewProps,
  schema,
  { useSnakeCase: true },
);

// 4. Generate Rust struct
const rustCode = generateRustStruct(schema, {
  templatePath: "auth/welcome.html",
  structName: "Welcome",
  subjectTemplate: "Welcome to ArcBox",
});

// 5. Write outputs
fs.writeFileSync("templates/auth/welcome.html", html);
fs.writeFileSync("src/templates/auth.rs", rustCode);
```

## Plain Text and Multiple Locales

Set `plainText` to also get a plain-text Askama template from the same component. rust-email converts each render with React Email's `toPlainText`, so images, links and headings follow React Email's rules. The text template never gets the `|e` filter.

```typescript
const { html, text } = await renderTemplate(VerifyEmail, props, schema, {
  escapeHtml: true,
  plainText: true, // or { htmlToTextOptions: { ... } }
});
```

For an email with one template set per locale, render the component once per locale and generate one module. Pass the locale to the component as a prop that is not in the schema. The module has a `Locale` enum, and each struct selects the template of a locale at run time.

```typescript
import { generateLocalizedRustModule } from "rust-email";

const rustCode = generateLocalizedRustModule(
  [
    {
      schema,
      config: {
        structName: "VerifyEmail",
        derives: ["Debug", "Clone"],
        locales: [
          {
            locale: "zh-Hans",
            templatePath: "mail/verify-email.zh-Hans.html",
            textTemplatePath: "mail/verify-email.zh-Hans.txt",
            subjectTemplate: "验证你的邮箱",
          },
          {
            locale: "en",
            templatePath: "mail/verify-email.en.html",
            textTemplatePath: "mail/verify-email.en.txt",
            subjectTemplate: "Verify your email",
          },
        ],
      },
    },
  ],
  { locales: ["zh-Hans", "en"] },
);
```

```rust
let mail = VerifyEmail { url };
let locale = Locale::from_tag("zh-Hans").unwrap_or(Locale::En);
let subject = mail.subject(locale);
let html = mail.render_html(locale)?;
let text = mail.render_text(locale)?;
```

## Supported Syntax Matrix

| React pattern | Askama output | Notes |
|---|---|---|
| `{userName ?? 'there'}` | `{% if let Some(user_name) = user_name %}{{ user_name }}{% else %}there{% endif %}` | `??` with string/number/boolean literal fallback |
| `{props.currency ?? 'US$'}` | Same as above | Property access on LHS supported |
| `{(name) ?? 'anon'}` | Same as above | Parenthesized LHS supported |
| `{deploymentId && <Muted>...</Muted>}` | `{% if let Some(deployment_id) = deployment_id %}...{% endif %}` | Contiguous `&&` blocks only |
| `{serviceName}` (required) | `{{ service_name }}` | Direct interpolation |
| `{isActive}` (boolean) | `{% if is_active %}true{% else %}false{% endif %}` | Boolean rendering |

### Unsupported patterns (hard error, no implicit degradation)

| Pattern | Error |
|---|---|
| `{status ? <A/> : <B/>}` | **Non-contiguous conditional block** — ternary produces diff in both branches |
| Dynamic `??` RHS (e.g. `x ?? getDefault()`) | No fallback inferred (not an error, but fallback is `undefined`) |

## Failure Strategy

v0.3.0 adopts **strict-fail, no silent degradation**:

- **Non-contiguous diff** (ternary `?:` with both branches) → `throw Error` with prop name
- **Required marker missing** from rendered HTML → `throw Error`
- **Prop missing from the plain-text output** (for example an image URL) → warning in `warnings`, not an error
- **Residual markers** in final output → `throw Error`
- **`validateTemplate()`** throws on leaked prop values or residual markers
- **`generateRustStruct()`** throws if `subjectTemplate` placeholder count ≠ `subjectProps` count, or if a `subjectProp` doesn't exist in the schema
- **`generateLocalizedRustStruct()`** throws if a locale has no entry, an unknown entry or two entries, or if only some locales set `textTemplatePath` or `subjectTemplate`
- **`generateLocaleEnum()`** throws if two locale tags convert to the same enum variant

## How It Works

Traditional approach (`AskamaWrapper`, v0.1) replaces prop values **before** React renders — this breaks `&&` conditionals and `??` fallbacks because the placeholder string is always truthy.

`renderTemplate()` (v0.2+) uses **post-render replacement**:

1. Render the component with high-entropy marker strings for all prop types (no more `true`/`77700+N` — avoids collisions with real content)
2. Merge `{ ...props, ...markerProps }` so non-schema fields (e.g. `className`, `style`) survive
3. For `&&` conditional blocks: render again without the prop, diff the two HTML outputs (LCP/LCS) to locate the conditional section
4. Wrap detected sections with `{% if let Some(...) %}`
5. Replace markers with `{{ variable }}` or `{% if let Some %}...{% else %}fallback{% endif %}`
6. Final residual-marker check — any leftover markers are a hard error
7. With `plainText`, run steps 3–6 again on the plain-text conversion of each render. Markers are upper case, so they survive the upper-case headings of html-to-text

## API

### `renderTemplate(Component, props, schema, config?)`

Render a react-email component into an Askama-compatible HTML template, and optionally a plain-text template.

- `Component` — React component
- `props` — Full props with all optional fields populated (typically `Component.PreviewProps`)
- `schema` — `PropSchema` describing each prop's type and optionality
- `config.useSnakeCase` — Convert camelCase to snake_case (default: `true`)
- `config.escapeHtml` — Add `|e` filter to interpolations (default: `false`)
- `config.plainText` — Also generate a plain-text template: `true`, or `{ htmlToTextOptions }` to customise html-to-text. Custom `selectors` extend React Email's defaults (default: `false`)

Returns `{ html: string, text?: string, warnings: string[] }`. `text` is a `string` when `plainText` is set. Throws on any structural error.

### `inferSchema(filePath)`

Parse a TypeScript source file and extract the props interface automatically.

- Finds the interface ending with `Props`
- Maps TypeScript types to `PropMeta` types
- Detects `??` fallback values from JSX AST
  - LHS: `identifier`, `props.xxx`, `(props.xxx)` all supported
  - RHS: string, number, boolean literals supported; dynamic expressions ignored

Returns `{ schema: PropSchema, interfaceName: string, componentName: string }`.

Requires `ts-morph` as a peer dependency.

### `generateRustStruct(schema, config)`

Generate a Rust `#[derive(Template)]` struct from a `PropSchema`.

- `config.templatePath` — Askama `#[template(path = "...")]` value
- `config.textTemplatePath` — Optional plain-text template. Adds a `render_text()` method that renders it with the same fields
- `config.structName` — Rust struct name
- `config.subjectTemplate` — Optional format string for a `subject()` method. Placeholder count must match `subjectProps` length.
- `config.subjectProps` — Props to interpolate into the subject. Each must exist in the schema.
- `config.numberType` — Rust numeric type (default: `"i64"`)
- `config.derives` — Additional `#[derive(...)]` entries

**Subject argument rules for optional props:**

| Prop type | Generated Rust expression |
|---|---|
| `Option<String>` / `Option<object→String>` | `self.x.as_deref().unwrap_or("unknown")` |
| `Option<i64>` / `Option<bool>` | `self.x.map(\|v\| v.to_string()).unwrap_or_else(\|\| "unknown".to_string())` |
| `Option<Vec<String>>` | `self.x.as_ref().map(\|v\| v.join(", ")).unwrap_or_else(\|\| "unknown".to_string())` |

### `generateRustModule(templates)`

Batch version of `generateRustStruct` — generates a complete Rust module with `use askama::Template;` and multiple structs.

### `generateLocalizedRustModule(templates, localeConfig)`

Generate a module for emails with one template set per locale: `use askama::Template;`, the locale enum and one struct per email.

- `localeConfig.locales` — Locale tags in declaration order, such as `["zh-Hans", "en"]`. Each tag becomes a PascalCase variant, such as `ZhHans`
- `localeConfig.localeEnum` — Enum name (default: `"Locale"`)
- `templates[].config.structName`, `derives`, `numberType` — As in `generateRustStruct`. The struct holds the props and has no `Template` derive
- `templates[].config.locales` — One entry per locale: `locale`, `templatePath`, and optionally `textTemplatePath`, `subjectTemplate`, `subjectProps`

Each struct gets `render_html(locale)`, plus `render_text(locale)` and `subject(locale)` when every locale sets them. `generateLocaleEnum()` and `generateLocalizedRustStruct()` generate the parts separately.

### `validateTemplate(template, props, schema?)`

Check that no raw prop values or marker strings remain in the generated template. Throws on failure. Pass the schema to suppress false positives when a prop's preview value matches its fallback.

### `AskamaWrapper(Component, defaultProps, config?)` ⚠️ Deprecated

> **Deprecated in v0.3.0.** Will be removed in v0.5.0.
>
> Use `renderTemplate()` instead. AskamaWrapper replaces props before React renders, which breaks `&&` and `??` patterns.
>
> **Migration:** Replace `AskamaWrapper(Comp, props)` → `await renderTemplate(Comp, props, schema)`.

## CI Integration

Add a verify script to your CI to ensure templates stay in sync:

```json
{
  "scripts": {
    "verify:rust-email": "tsx scripts/export-templates.ts --check"
  }
}
```

The `--check` flag should compare generated output against committed files and exit non-zero on diff.

## License

MIT
