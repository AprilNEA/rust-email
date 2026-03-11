# Getting Started

## Installation

```bash
pnpm add rust-email @react-email/render
# optional: for automatic schema inference from TypeScript interfaces
pnpm add -D ts-morph
```

### Peer Dependencies

| Package | Required | Purpose |
|---|---|---|
| `@react-email/render` | Yes | Render React components to HTML |
| `react` / `react-dom` | Yes | React runtime |
| `ts-morph` | Optional | Automatic schema inference from TypeScript |

## Basic Workflow

The typical workflow consists of four steps:

### 1. Infer the prop schema

```typescript
import { inferSchema } from "rust-email";

const { schema } = await inferSchema("./emails/auth/welcome.tsx");
```

`inferSchema` parses the TypeScript source and extracts the props interface, detecting types, optionality, and `??` fallback values.

### 2. Import and render

```typescript
import { renderTemplate } from "rust-email";

const { default: WelcomeEmail } = await import("./emails/auth/welcome.tsx");

const { html } = await renderTemplate(
  WelcomeEmail,
  WelcomeEmail.PreviewProps,
  schema,
  { useSnakeCase: true },
);
```

### 3. Generate Rust code

```typescript
import { generateRustStruct } from "rust-email";

const rustCode = generateRustStruct(schema, {
  templatePath: "auth/welcome.html",
  structName: "Welcome",
  subjectTemplate: "Welcome to ArcBox",
});
```

### 4. Write output files

```typescript
import * as fs from "node:fs";

fs.writeFileSync("templates/auth/welcome.html", html);
fs.writeFileSync("src/templates/auth.rs", rustCode);
```

## Failure Strategy

v0.3.0 adopts **strict-fail, no silent degradation**:

- **Non-contiguous diff** (ternary `?:` with both branches) → `throw Error` with prop name
- **Required marker missing** from rendered HTML → `throw Error`
- **Residual markers** in final output → `throw Error`
- **`validateTemplate()`** throws on leaked prop values or residual markers
- **`generateRustStruct()`** throws if `subjectTemplate` placeholder count ≠ `subjectProps` count, or if a `subjectProp` doesn't exist in the schema
