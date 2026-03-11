# rust-email

Bridge [react-email](https://react.email) templates to Rust template engines (Askama / Tera / minijinja).

Design emails with React components and hot-reload preview, then export them as Askama HTML templates with typed Rust structs — no manual conversion needed.

## Features

- **React → Askama** — Write emails in React, compile to Askama templates
- **Type-safe codegen** — Auto-generate `#[derive(Template)]` Rust structs from TypeScript props
- **Schema inference** — Extract prop schemas from TypeScript interfaces via `ts-morph`
- **Post-render replacement** — Correctly handles `??` fallbacks and `&&` conditional blocks
- **Strict validation** — No silent degradation; errors on any structural issue

## Quick Example

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

## License

MIT
