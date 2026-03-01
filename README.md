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

Generated Askama template:

```html
<p>Hi {% if let Some(ref user_name) = user_name %}{{ user_name }}{% else %}there{% endif %},</p>
<p>Your workspace is ready.</p>
```

Generated Rust struct:

```rust
#[derive(Template)]
#[template(path = "auth/welcome.html")]
pub struct Welcome {
    pub user_name: Option<String>,
}
```

## How It Works

Traditional approach (`AskamaWrapper`, v0.1) replaces prop values **before** React renders — this breaks `&&` conditionals and `??` fallbacks because the placeholder string is always truthy.

`renderTemplate()` (v0.2) uses **post-render replacement**:

1. Render the component normally with unique marker values
2. For `&&` conditional blocks: render again without the prop, diff the two HTML outputs (LCP/LCS) to locate the conditional section
3. Wrap detected sections with `{% if let Some(...) %}`
4. Replace markers with `{{ variable }}` or `{% if let Some %}...{% else %}fallback{% endif %}`

This correctly handles all common React patterns:

| React pattern | Askama output |
|---|---|
| `{userName ?? 'there'}` | `{% if let Some(ref user_name) = user_name %}{{ user_name }}{% else %}there{% endif %}` |
| `{deploymentId && <Muted>...</Muted>}` | `{% if let Some(deployment_id) = deployment_id %}...{% endif %}` |
| `{currency ?? 'US$'}` | `{% if let Some(ref currency) = currency %}{{ currency }}{% else %}US${% endif %}` |
| `{serviceName}` (required) | `{{ service_name }}` |

## API

### `renderTemplate(Component, props, schema, config?)`

Render a react-email component into an Askama-compatible HTML template.

- `Component` — React component
- `props` — Full props with all optional fields populated (typically `Component.PreviewProps`)
- `schema` — `PropSchema` describing each prop's type and optionality
- `config.useSnakeCase` — Convert camelCase to snake_case (default: `true`)
- `config.escapeHtml` — Add `|e` filter to interpolations (default: `false`)

Returns `{ html: string, warnings: string[] }`.

### `inferSchema(filePath)`

Parse a TypeScript source file and extract the props interface automatically.

- Finds the interface ending with `Props`
- Maps TypeScript types to `PropMeta` types
- Detects `??` fallback values from JSX AST

Returns `{ schema: PropSchema, interfaceName: string, componentName: string }`.

Requires `ts-morph` as a peer dependency.

### `generateRustStruct(schema, config)`

Generate a Rust `#[derive(Template)]` struct from a `PropSchema`.

- `config.templatePath` — Askama `#[template(path = "...")]` value
- `config.structName` — Rust struct name
- `config.subjectTemplate` — Optional format string for a `subject()` method
- `config.subjectProps` — Props to interpolate into the subject
- `config.numberType` — Rust numeric type (default: `"i64"`)
- `config.derives` — Additional `#[derive(...)]` entries

### `generateRustModule(templates)`

Batch version of `generateRustStruct` — generates a complete Rust module with `use askama::Template;` and multiple structs.

### `validateTemplate(template, props, schema?)`

Check that no raw prop values or marker strings remain in the generated template. Pass the schema to suppress false positives when a prop's preview value matches its fallback.

### `AskamaWrapper(Component, defaultProps, config?)` (legacy)

The original v0.1 HOC approach. Still works for templates without conditional rendering. Use `renderTemplate` for anything non-trivial.

## Example Export Script

A complete script for batch-exporting all templates in a project:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import {
  inferSchema,
  renderTemplate,
  generateRustStruct,
  validateTemplate,
} from "rust-email";

const TEMPLATES = [
  {
    file: "auth/welcome.tsx",
    structName: "Welcome",
    templatePath: "auth/welcome.html",
    subject: { template: "Welcome to MyApp" },
  },
  {
    file: "auth/email-verification.tsx",
    structName: "EmailVerification",
    templatePath: "auth/email-verification.html",
    subject: { template: "Verify your email address" },
  },
  // ... add all your templates
];

const EMAILS_DIR = "./emails";
const TEMPLATES_OUT = "../../libs/my-email/templates";
const RUST_OUT = "../../libs/my-email/src/templates";

async function main() {
  for (const tmpl of TEMPLATES) {
    const filePath = path.join(EMAILS_DIR, tmpl.file);

    const { schema } = await inferSchema(filePath);
    const mod = await import(filePath);
    const Component = mod.default;

    const { html, warnings } = await renderTemplate(
      Component,
      Component.PreviewProps,
      schema,
      { useSnakeCase: true },
    );

    if (warnings.length > 0) {
      console.warn(`[${tmpl.file}] warnings:`, warnings);
    }

    const validation = validateTemplate(html, Component.PreviewProps, schema);
    if (!validation.valid) {
      console.error(`[${tmpl.file}] unreplaced:`, validation.unreplaced);
      process.exit(1);
    }

    const outPath = path.join(TEMPLATES_OUT, tmpl.templatePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);

    const rustCode = generateRustStruct(schema, {
      templatePath: tmpl.templatePath,
      structName: tmpl.structName,
      subjectTemplate: tmpl.subject.template,
      subjectProps: tmpl.subject.props,
    });

    // Append to module file (or write per-domain files)
    fs.appendFileSync(path.join(RUST_OUT, "mod.rs"), rustCode + "\n");

    console.log(`[${tmpl.file}] OK`);
  }
}

main();
```

## License

MIT
