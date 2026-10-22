import { describe, it, expect } from "vitest";
import { generateRustStruct } from "../src/codegen";
import type { PropSchema } from "../src/types";

// ── 5. Codegen: optional number/bool subject args ────────────────────

describe("codegen subject() optional non-string types", () => {
  it("should use map(|v| v.to_string()) for Option<i64>", () => {
    const schema: PropSchema = {
      serviceName: { type: "string", optional: false },
      retryCount: { type: "number", optional: true },
    };

    const code = generateRustStruct(schema, {
      templatePath: "test.html",
      structName: "TestEmail",
      subjectTemplate: "{} (attempt {})",
      subjectProps: ["serviceName", "retryCount"],
    });

    // Must NOT contain as_deref() for number
    expect(code).not.toContain("retry_count.as_deref()");
    // Must use map(|v| v.to_string())
    expect(code).toContain(
      "self.retry_count.map(|v| v.to_string()).unwrap_or_else(|| \"unknown\".to_string())",
    );
  });

  it("should use map(|v| v.to_string()) for Option<bool>", () => {
    const schema: PropSchema = {
      title: { type: "string", optional: false },
      isUrgent: { type: "boolean", optional: true },
    };

    const code = generateRustStruct(schema, {
      templatePath: "test.html",
      structName: "AlertEmail",
      subjectTemplate: "{} (urgent: {})",
      subjectProps: ["title", "isUrgent"],
    });

    expect(code).not.toContain("is_urgent.as_deref()");
    expect(code).toContain(
      "self.is_urgent.map(|v| v.to_string()).unwrap_or_else(|| \"unknown\".to_string())",
    );
  });

  it("should use as_ref().map(|v| v.join()) for Option<Vec<String>>", () => {
    const schema: PropSchema = {
      subject: { type: "string", optional: false },
      tags: { type: "string[]", optional: true },
    };

    const code = generateRustStruct(schema, {
      templatePath: "test.html",
      structName: "TagEmail",
      subjectTemplate: "{} [{}]",
      subjectProps: ["subject", "tags"],
    });

    expect(code).toContain(
      'self.tags.as_ref().map(|v| v.join(", ")).unwrap_or_else(|| "unknown".to_string())',
    );
  });

  it("should still use as_deref() for Option<String>", () => {
    const schema: PropSchema = {
      greeting: { type: "string", optional: true },
    };

    const code = generateRustStruct(schema, {
      templatePath: "test.html",
      structName: "GreetEmail",
      subjectTemplate: "{}",
      subjectProps: ["greeting"],
    });

    expect(code).toContain('self.greeting.as_deref().unwrap_or("unknown")');
  });
});

describe("codegen subject validation", () => {
  it("should throw when placeholder count mismatches subjectProps", () => {
    const schema: PropSchema = {
      name: { type: "string", optional: false },
    };

    expect(() =>
      generateRustStruct(schema, {
        templatePath: "test.html",
        structName: "Bad",
        subjectTemplate: "Hello {} and {}",
        subjectProps: ["name"],
      }),
    ).toThrow(/2 placeholder.*1 prop/);
  });

  it("should throw when subjectProp does not exist in schema", () => {
    const schema: PropSchema = {
      name: { type: "string", optional: false },
    };

    expect(() =>
      generateRustStruct(schema, {
        templatePath: "test.html",
        structName: "Bad",
        subjectTemplate: "Hello {}",
        subjectProps: ["nonExistent"],
      }),
    ).toThrow(/nonExistent.*does not exist/);
  });

  it("should skip Rust escaped braces {{}} when counting placeholders", () => {
    const schema: PropSchema = {
      name: { type: "string", optional: false },
    };

    // "Literal {{}} and {}" has 1 real placeholder, not 2
    expect(() =>
      generateRustStruct(schema, {
        templatePath: "test.html",
        structName: "EscapedBraces",
        subjectTemplate: "Literal {{}} and {}",
        subjectProps: ["name"],
      }),
    ).not.toThrow();

    const code = generateRustStruct(schema, {
      templatePath: "test.html",
      structName: "EscapedBraces",
      subjectTemplate: "Literal {{}} and {}",
      subjectProps: ["name"],
    });
    expect(code).toContain("self.name");
  });

  it("should use .join() for required string[] in subject args", () => {
    const schema: PropSchema = {
      tags: { type: "string[]", optional: false },
    };

    const code = generateRustStruct(schema, {
      templatePath: "test.html",
      structName: "TagEmail",
      subjectTemplate: "Tags: {}",
      subjectProps: ["tags"],
    });

    // Vec<String> doesn't implement Display — must use .join()
    expect(code).toContain('self.tags.join(", ")');
    expect(code).not.toMatch(/format!.*self\.tags[^.]/);
  });
});

describe("codegen plain-text template", () => {
  const schema: PropSchema = {
    name: { type: "string", optional: false },
  };

  it("should not change the output when textTemplatePath is not set", () => {
    const code = generateRustStruct(schema, {
      templatePath: "auth/welcome.html",
      structName: "Welcome",
    });

    expect(code).toBe(
      [
        "#[derive(Template)]",
        '#[template(path = "auth/welcome.html")]',
        "pub struct Welcome {",
        "    pub name: String,",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("should add render_text() and a Deref wrapper for the text template", () => {
    const code = generateRustStruct(schema, {
      templatePath: "auth/welcome.html",
      textTemplatePath: "auth/welcome.txt",
      structName: "Welcome",
      subjectTemplate: "Welcome, {}",
      subjectProps: ["name"],
    });

    // subject() and render_text() share one impl block
    expect(code.match(/impl Welcome \{/g)).toHaveLength(1);
    expect(code).toContain("pub fn subject(&self) -> String {");
    expect(code).toContain("pub fn render_text(&self) -> askama::Result<String> {");
    expect(code).toContain("WelcomeText(self).render()");
    expect(code).toContain(
      '#[template(path = "auth/welcome.txt")]\nstruct WelcomeText<\'a>(&\'a Welcome);',
    );
    expect(code).toContain("impl std::ops::Deref for WelcomeText<'_> {");
    expect(code).toContain("    fn deref(&self) -> &Welcome {");
  });
});

describe("codegen Rust string literals", () => {
  it("should write escapes that Rust accepts", () => {
    const code = generateRustStruct(
      { name: { type: "string", optional: false } },
      {
        templatePath: "test.html",
        structName: "Literal",
        subjectTemplate: 'Tab\there "quoted" \u0001 \b C:\\build',
      },
    );

    expect(code).toContain(
      '"Tab\\there \\"quoted\\" \\u{0001} \\u{8} C:\\\\build".to_string()',
    );
  });
});
