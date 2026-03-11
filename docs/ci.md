# CI Integration

Add a verify script to your CI to ensure templates stay in sync with your React email components.

## Setup

Add a script to your `package.json`:

```json
{
  "scripts": {
    "verify:rust-email": "tsx scripts/export-templates.ts --check"
  }
}
```

The `--check` flag should compare generated output against committed files and exit non-zero on diff.

## Example Script

```typescript
// scripts/export-templates.ts
import { inferSchema, renderTemplate, generateRustStruct } from "rust-email";
import * as fs from "node:fs";
import * as path from "node:path";

const templates = [
  {
    source: "./emails/auth/welcome.tsx",
    htmlOut: "templates/auth/welcome.html",
    rustOut: "src/templates/auth.rs",
    structName: "Welcome",
    subject: "Welcome to MyApp",
  },
  // ...add more templates
];

const isCheck = process.argv.includes("--check");

for (const t of templates) {
  const { schema } = await inferSchema(t.source);
  const { default: Component } = await import(path.resolve(t.source));

  const { html } = await renderTemplate(
    Component,
    Component.PreviewProps,
    schema,
  );

  const rustCode = generateRustStruct(schema, {
    templatePath: t.htmlOut.replace("templates/", ""),
    structName: t.structName,
    subjectTemplate: t.subject,
  });

  if (isCheck) {
    const existingHtml = fs.readFileSync(t.htmlOut, "utf-8");
    const existingRust = fs.readFileSync(t.rustOut, "utf-8");
    if (existingHtml !== html || existingRust !== rustCode) {
      console.error(`Templates out of sync: ${t.source}`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(t.htmlOut), { recursive: true });
    fs.mkdirSync(path.dirname(t.rustOut), { recursive: true });
    fs.writeFileSync(t.htmlOut, html);
    fs.writeFileSync(t.rustOut, rustCode);
  }
}

console.log(isCheck ? "All templates in sync." : "Templates exported.");
```
