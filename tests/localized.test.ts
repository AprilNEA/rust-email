import { describe, it, expect } from "vitest";
import {
  generateLocaleEnum,
  generateLocalizedRustModule,
  generateLocalizedRustStruct,
} from "../src/codegen";
import type { LocalizedCodegenConfig, PropSchema } from "../src/types";

const locales = { locales: ["zh-Hans", "en"] };

const schema: PropSchema = {
  url: { type: "string", optional: false },
  schoolName: { type: "string", optional: true },
};

function config(overrides: Partial<LocalizedCodegenConfig> = {}): LocalizedCodegenConfig {
  return {
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
        subjectTemplate: "Verify {}",
        subjectProps: ["url"],
      },
    ],
    ...overrides,
  };
}

// ── Locale enum ──────────────────────────────────────────────────────

describe("generateLocaleEnum", () => {
  it("should generate one variant per tag with tag() and from_tag()", () => {
    const code = generateLocaleEnum(locales);

    expect(code).toContain("pub enum Locale {");
    expect(code).toContain("    ZhHans,");
    expect(code).toContain("    En,");
    expect(code).toContain("pub const ALL: [Self; 2] = [Self::ZhHans, Self::En];");
    expect(code).toContain('Self::ZhHans => "zh-Hans",');
    expect(code).toContain('Self::En => "en",');
    expect(code).toContain("pub fn from_tag(tag: &str) -> Option<Self>");
    expect(code).toContain("eq_ignore_ascii_case(tag)");
  });

  it("should use a custom enum name", () => {
    const code = generateLocaleEnum({ ...locales, localeEnum: "MailLocale" });
    expect(code).toContain("pub enum MailLocale {");
    expect(code).toContain("impl MailLocale {");
  });

  it("should throw on an empty, duplicate or colliding tag list", () => {
    expect(() => generateLocaleEnum({ locales: [] })).toThrow(/at least one/);
    expect(() => generateLocaleEnum({ locales: ["en", "en"] })).toThrow(/more than once/);
    expect(() => generateLocaleEnum({ locales: ["zh-Hans", "zh_hans"] })).toThrow(
      /both convert to the enum variant "ZhHans"/,
    );
  });

  it("should throw when a tag does not make a valid Rust variant", () => {
    expect(() => generateLocaleEnum({ locales: ["419"] })).toThrow(/valid Rust enum variant/);
  });
});

// ── Localized struct ─────────────────────────────────────────────────

describe("generateLocalizedRustStruct", () => {
  it("should generate a data struct without the Template derive", () => {
    const code = generateLocalizedRustStruct(schema, config(), locales);

    expect(code).toContain("#[derive(Debug, Clone)]\npub struct VerifyEmail {");
    expect(code).toContain("    pub url: String,");
    expect(code).toContain("    pub school_name: Option<String>,");
    expect(code).not.toMatch(/#\[derive\(Template[^\n]*\]\npub struct VerifyEmail/);
  });

  it("should omit the derive line when no derives are given", () => {
    const code = generateLocalizedRustStruct(schema, config({ derives: [] }), locales);
    expect(code.startsWith("pub struct VerifyEmail {")).toBe(true);
  });

  it("should match every locale in subject(), render_html() and render_text()", () => {
    const code = generateLocalizedRustStruct(schema, config(), locales);

    expect(code).toContain("pub fn subject(&self, locale: Locale) -> String {");
    expect(code).toContain('Locale::ZhHans => "验证你的邮箱".to_string(),');
    expect(code).toContain('Locale::En => format!("Verify {}", self.url),');

    expect(code).toContain("pub fn render_html(&self, locale: Locale) -> askama::Result<String> {");
    expect(code).toContain("Locale::ZhHans => VerifyEmailZhHansHtml(self).render(),");
    expect(code).toContain("Locale::En => VerifyEmailEnHtml(self).render(),");

    expect(code).toContain("pub fn render_text(&self, locale: Locale) -> askama::Result<String> {");
    expect(code).toContain("Locale::ZhHans => VerifyEmailZhHansText(self).render(),");
    expect(code).toContain("Locale::En => VerifyEmailEnText(self).render(),");
  });

  it("should generate one Deref wrapper per template", () => {
    const code = generateLocalizedRustStruct(schema, config(), locales);

    expect(code).toContain(
      '#[template(path = "mail/verify-email.zh-Hans.html")]\nstruct VerifyEmailZhHansHtml<\'a>(&\'a VerifyEmail);',
    );
    expect(code).toContain(
      '#[template(path = "mail/verify-email.en.txt")]\nstruct VerifyEmailEnText<\'a>(&\'a VerifyEmail);',
    );
    expect(code).toContain("impl std::ops::Deref for VerifyEmailEnText<'_> {");
    expect(code.match(/#\[derive\(Template\)\]/g)).toHaveLength(4);
  });

  it("should follow the module locale order, not the entry order", () => {
    const reversed = config();
    reversed.locales = [...reversed.locales].reverse();
    const code = generateLocalizedRustStruct(schema, reversed, locales);

    expect(code.indexOf("Locale::ZhHans => VerifyEmailZhHansHtml")).toBeLessThan(
      code.indexOf("Locale::En => VerifyEmailEnHtml"),
    );
  });

  it("should omit subject() and render_text() when no locale sets them", () => {
    const base = config();
    const code = generateLocalizedRustStruct(
      schema,
      {
        ...base,
        locales: base.locales.map(({ locale, templatePath }) => ({ locale, templatePath })),
      },
      locales,
    );

    expect(code).not.toContain("fn subject");
    expect(code).not.toContain("fn render_text");
    expect(code).not.toContain("Text<'a>");
    expect(code).toContain("fn render_html");
  });

  it("should throw when only some locales set textTemplatePath or subjectTemplate", () => {
    const partialText = config();
    partialText.locales = partialText.locales.map((l, i) =>
      i === 0 ? { ...l, textTemplatePath: undefined } : l,
    );
    expect(() => generateLocalizedRustStruct(schema, partialText, locales)).toThrow(
      /textTemplatePath for 1 of 2 locales/,
    );

    const partialSubject = config();
    partialSubject.locales = partialSubject.locales.map((l, i) =>
      i === 1 ? { ...l, subjectTemplate: undefined, subjectProps: undefined } : l,
    );
    expect(() => generateLocalizedRustStruct(schema, partialSubject, locales)).toThrow(
      /subjectTemplate for 1 of 2 locales/,
    );
  });

  it("should throw on a missing, unknown or duplicate locale entry", () => {
    const base = config();

    expect(() =>
      generateLocalizedRustStruct(schema, { ...base, locales: [base.locales[0]] }, locales),
    ).toThrow(/no templates for locale\(s\) en/);

    expect(() =>
      generateLocalizedRustStruct(
        schema,
        { ...base, locales: [...base.locales, { locale: "fr", templatePath: "fr.html" }] },
        locales,
      ),
    ).toThrow(/locale "fr", which is not in locales/);

    expect(() =>
      generateLocalizedRustStruct(
        schema,
        { ...base, locales: [...base.locales, base.locales[0]] },
        locales,
      ),
    ).toThrow(/more than one entry for locale "zh-Hans"/);
  });

  it("should validate the subject of each locale", () => {
    const bad = config();
    bad.locales = bad.locales.map((l) =>
      l.locale === "en" ? { ...l, subjectProps: ["nonExistent"] } : l,
    );
    expect(() => generateLocalizedRustStruct(schema, bad, locales)).toThrow(
      /nonExistent.*does not exist/,
    );
  });
});

// ── Localized module ─────────────────────────────────────────────────

describe("generateLocalizedRustModule", () => {
  it("should emit the import, the enum once and every struct", () => {
    const code = generateLocalizedRustModule(
      [
        { schema, config: config() },
        {
          schema: { code: { type: "string", optional: false } },
          config: {
            structName: "SchoolCode",
            locales: [
              { locale: "zh-Hans", templatePath: "mail/school-code.zh-Hans.html" },
              { locale: "en", templatePath: "mail/school-code.en.html" },
            ],
          },
        },
      ],
      locales,
    );

    expect(code.startsWith("use askama::Template;\n")).toBe(true);
    expect(code.match(/pub enum Locale \{/g)).toHaveLength(1);
    expect(code).toContain("pub struct VerifyEmail {");
    expect(code).toContain("pub struct SchoolCode {");
    expect(code).toContain("Locale::En => SchoolCodeEnHtml(self).render(),");
  });
});
