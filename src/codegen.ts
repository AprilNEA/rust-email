import { pascalCase, snakeCase } from "change-case";
import type {
  CodegenConfig,
  LocaleEnumConfig,
  LocalizedCodegenConfig,
  PropMeta,
  PropSchema,
} from "./types";

const RUST_TYPE_MAP: Record<string, Record<string, string>> = {
  string: { default: "String" },
  boolean: { default: "bool" },
  "string[]": { default: "Vec<String>" },
  object: { default: "String" },
  number: {
    i32: "i32",
    i64: "i64",
    u32: "u32",
    u64: "u64",
    f32: "f32",
    f64: "f64",
    default: "i64",
  },
};

function toRustType(meta: PropMeta, numberType: string): string {
  const typeMap = RUST_TYPE_MAP[meta.type] ?? RUST_TYPE_MAP.string;
  const baseType = typeMap[numberType] ?? typeMap.default ?? "String";
  return meta.optional ? `Option<${baseType}>` : baseType;
}

/**
 * Quote a string as a Rust string literal.
 *
 * JSON escapes are valid Rust escapes except `\b`, `\f` and `\uXXXX`, which
 * Rust writes as `\u{...}`.
 */
function rustStringLiteral(value: string): string {
  // Match `\\` too, so that an escaped backslash before `b` or `f` stays as is.
  return JSON.stringify(value).replace(
    /\\(\\|u[0-9a-fA-F]{4}|b|f)/g,
    (_match, escape: string) => {
      if (escape === "\\") return "\\\\";
      if (escape === "b") return "\\u{8}";
      if (escape === "f") return "\\u{c}";
      return `\\u{${escape.slice(1)}}`;
    },
  );
}

/**
 * Generate a Rust format! argument for a required field in a subject() method.
 *
 * Most types implement Display and can be used directly, but Vec<String> does not.
 */
function generateRequiredFormatArg(rustName: string, meta: PropMeta): string {
  switch (meta.type) {
    case "string[]":
      return `self.${rustName}.join(", ")`;
    default:
      return `self.${rustName}`;
  }
}

/**
 * Generate a Rust format! argument for an optional field in a subject() method.
 *
 * Rules:
 * - Option<String> / Option<object→String>: as_deref().unwrap_or("unknown")
 * - Option<i64> / Option<bool> (non-string scalars): map(|v| v.to_string()).unwrap_or_else(|| "unknown".to_string())
 * - Option<Vec<String>>: as_ref().map(|v| v.join(", ")).unwrap_or_else(|| "unknown".to_string())
 */
function generateOptionalFormatArg(rustName: string, meta: PropMeta): string {
  switch (meta.type) {
    case "string":
    case "object":
      return `self.${rustName}.as_deref().unwrap_or("unknown")`;
    case "number":
    case "boolean":
      return `self.${rustName}.map(|v| v.to_string()).unwrap_or_else(|| "unknown".to_string())`;
    case "string[]":
      return `self.${rustName}.as_ref().map(|v| v.join(", ")).unwrap_or_else(|| "unknown".to_string())`;
    default:
      return `self.${rustName}.as_deref().unwrap_or("unknown")`;
  }
}

/**
 * Validate a subject format string and return the Rust expression that
 * builds the subject from `self`.
 */
function generateSubjectExpr(
  schema: PropSchema,
  subjectTemplate: string,
  subjectProps: string[],
): string {
  // Validate: placeholder count must match subjectProps count
  // Count real placeholders: `{}` but not `{{}}` (Rust literal braces).
  // First strip all `{{` and `}}` escape sequences, then count `{}`.
  const stripped = subjectTemplate.replace(/\{\{/g, "").replace(/\}\}/g, "");
  const placeholderCount = (stripped.match(/\{}/g) || []).length;
  if (subjectProps.length !== placeholderCount) {
    throw new Error(
      `rust-email: subjectTemplate has ${placeholderCount} placeholder(s) but subjectProps has ${subjectProps.length} prop(s). ` +
      `They must match exactly.`,
    );
  }

  // Validate: all subjectProps must exist in the schema
  for (const p of subjectProps) {
    if (!(p in schema)) {
      throw new Error(
        `rust-email: subjectProp "${p}" does not exist in the schema. ` +
        `Available props: ${Object.keys(schema).join(", ")}`,
      );
    }
  }

  if (subjectProps.length === 0) {
    // Static subject
    return `${rustStringLiteral(subjectTemplate)}.to_string()`;
  }

  // Dynamic subject with format!
  const formatArgs = subjectProps
    .map((p) => {
      const rustName = snakeCase(p);
      const meta = schema[p];
      if (meta?.optional) {
        return generateOptionalFormatArg(rustName, meta);
      }
      return generateRequiredFormatArg(rustName, meta);
    })
    .join(", ");
  return `format!(${rustStringLiteral(subjectTemplate)}, ${formatArgs})`;
}

/** Generate the `pub field: Type,` lines of a struct body. */
function generateFields(schema: PropSchema, numberType: string): string[] {
  return Object.entries(schema).map(
    ([key, meta]) => `    pub ${snakeCase(key)}: ${toRustType(meta, numberType)},`,
  );
}

/**
 * Generate a private Askama template struct that borrows `dataStruct`.
 *
 * The `Deref` impl lets the template read the fields of `dataStruct`, so one
 * data struct can render several templates without copying its fields.
 */
function generateTemplateWrapper(
  wrapperName: string,
  dataStruct: string,
  templatePath: string,
): string[] {
  return [
    "#[derive(Template)]",
    `#[template(path = ${rustStringLiteral(templatePath)})]`,
    `struct ${wrapperName}<'a>(&'a ${dataStruct});`,
    "",
    `impl std::ops::Deref for ${wrapperName}<'_> {`,
    `    type Target = ${dataStruct};`,
    "",
    `    fn deref(&self) -> &${dataStruct} {`,
    "        self.0",
    "    }",
    "}",
  ];
}

/**
 * Generate a Rust struct definition with `#[derive(Template)]` for Askama.
 *
 * Converts a PropSchema into a Rust struct where:
 * - camelCase keys become snake_case fields
 * - TypeScript types map to Rust types (string → String, number → i64, etc.)
 * - Optional props become Option<T>
 *
 * With `textTemplatePath`, the struct also gets a `render_text()` method that
 * renders the plain-text template with the same fields.
 */
export function generateRustStruct(
  schema: PropSchema,
  config: CodegenConfig,
): string {
  const numberType = config.numberType ?? "i64";
  const derives = ["Template", ...(config.derives ?? [])];
  const lines: string[] = [];

  lines.push(`#[derive(${derives.join(", ")})]`);
  lines.push(`#[template(path = "${config.templatePath}")]`);
  lines.push(`pub struct ${config.structName} {`);
  lines.push(...generateFields(schema, numberType));
  lines.push("}");

  const methods: string[][] = [];

  // Generate subject() method if template provided
  if (config.subjectTemplate) {
    const expr = generateSubjectExpr(
      schema,
      config.subjectTemplate,
      config.subjectProps ?? [],
    );
    methods.push([
      "    pub fn subject(&self) -> String {",
      `        ${expr}`,
      "    }",
    ]);
  }

  const textWrapper = `${config.structName}Text`;
  if (config.textTemplatePath) {
    methods.push([
      `    /// Renders the plain-text template \`${config.textTemplatePath}\`.`,
      "    pub fn render_text(&self) -> askama::Result<String> {",
      `        ${textWrapper}(self).render()`,
      "    }",
    ]);
  }

  if (methods.length > 0) {
    lines.push("");
    lines.push(`impl ${config.structName} {`);
    methods.forEach((method, i) => {
      if (i > 0) lines.push("");
      lines.push(...method);
    });
    lines.push("}");
  }

  if (config.textTemplatePath) {
    lines.push("");
    lines.push(
      ...generateTemplateWrapper(
        textWrapper,
        config.structName,
        config.textTemplatePath,
      ),
    );
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate Rust structs for multiple templates at once.
 * Returns a complete Rust module with use statements.
 */
export function generateRustModule(
  templates: Array<{
    schema: PropSchema;
    config: CodegenConfig;
  }>,
): string {
  const lines: string[] = [];

  lines.push("use askama::Template;");
  lines.push("");

  for (const { schema, config } of templates) {
    lines.push(generateRustStruct(schema, config));
    lines.push("");
  }

  return lines.join("\n");
}

/** Map each locale tag to its Rust enum variant, and validate the tags. */
function localeVariants(config: LocaleEnumConfig): Map<string, string> {
  if (config.locales.length === 0) {
    throw new Error("rust-email: locales must contain at least one locale tag.");
  }

  const variants = new Map<string, string>();
  const tagsByVariant = new Map<string, string>();
  for (const tag of config.locales) {
    if (variants.has(tag)) {
      throw new Error(`rust-email: locale "${tag}" appears more than once in locales.`);
    }
    const variant = pascalCase(tag);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(variant)) {
      throw new Error(
        `rust-email: locale "${tag}" does not convert to a valid Rust enum variant (got "${variant}").`,
      );
    }
    const other = tagsByVariant.get(variant);
    if (other !== undefined) {
      throw new Error(
        `rust-email: locales "${other}" and "${tag}" both convert to the enum variant "${variant}".`,
      );
    }
    variants.set(tag, variant);
    tagsByVariant.set(variant, tag);
  }
  return variants;
}

/**
 * Generate the locale enum that localized structs take in their methods.
 *
 * The enum has one variant per locale tag, `ALL`, `tag()` and `from_tag()`.
 */
export function generateLocaleEnum(config: LocaleEnumConfig): string {
  const name = config.localeEnum ?? "Locale";
  const variants = localeVariants(config);
  const lines: string[] = [];

  lines.push("/// Locales of the generated email templates.");
  lines.push("#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]");
  lines.push(`pub enum ${name} {`);
  for (const [tag, variant] of variants) {
    lines.push(`    /// \`${tag}\``);
    lines.push(`    ${variant},`);
  }
  lines.push("}");
  lines.push("");
  lines.push(`impl ${name} {`);
  lines.push("    /// Every locale, in declaration order.");
  lines.push(
    `    pub const ALL: [Self; ${variants.size}] = [${[...variants.values()].map((v) => `Self::${v}`).join(", ")}];`,
  );
  lines.push("");
  lines.push("    /// Returns the locale tag, such as `" + config.locales[0] + "`.");
  lines.push("    pub const fn tag(self) -> &'static str {");
  lines.push("        match self {");
  for (const [tag, variant] of variants) {
    lines.push(`            Self::${variant} => ${rustStringLiteral(tag)},`);
  }
  lines.push("        }");
  lines.push("    }");
  lines.push("");
  lines.push("    /// Finds the locale whose tag equals `tag`, ignoring ASCII case.");
  lines.push("    pub fn from_tag(tag: &str) -> Option<Self> {");
  lines.push(
    "        Self::ALL.iter().copied().find(|locale| locale.tag().eq_ignore_ascii_case(tag))",
  );
  lines.push("    }");
  lines.push("}");

  return lines.join("\n") + "\n";
}

/**
 * Generate a Rust struct for an email that has one template set per locale.
 *
 * The struct holds the props. Its methods take a locale and pick the
 * template of that locale:
 * - `subject(locale)`, when every locale sets `subjectTemplate`
 * - `render_html(locale)`
 * - `render_text(locale)`, when every locale sets `textTemplatePath`
 *
 * The output refers to the locale enum from `generateLocaleEnum()`.
 */
export function generateLocalizedRustStruct(
  schema: PropSchema,
  config: LocalizedCodegenConfig,
  localeConfig: LocaleEnumConfig,
): string {
  const enumName = localeConfig.localeEnum ?? "Locale";
  const variants = localeVariants(localeConfig);
  const numberType = config.numberType ?? "i64";
  const name = config.structName;

  // Every module locale needs exactly one entry, so each match is exhaustive.
  const entries = new Map<string, LocalizedCodegenConfig["locales"][number]>();
  for (const entry of config.locales) {
    if (!variants.has(entry.locale)) {
      throw new Error(
        `rust-email: ${name} has templates for locale "${entry.locale}", which is not in locales (${localeConfig.locales.join(", ")}).`,
      );
    }
    if (entries.has(entry.locale)) {
      throw new Error(
        `rust-email: ${name} has more than one entry for locale "${entry.locale}".`,
      );
    }
    entries.set(entry.locale, entry);
  }
  const missing = localeConfig.locales.filter((tag) => !entries.has(tag));
  if (missing.length > 0) {
    throw new Error(
      `rust-email: ${name} has no templates for locale(s) ${missing.join(", ")}.`,
    );
  }

  const ordered = localeConfig.locales.map((tag) => ({
    variant: variants.get(tag) as string,
    entry: entries.get(tag) as LocalizedCodegenConfig["locales"][number],
  }));

  const hasSubject = allOrNone(name, "subjectTemplate", ordered.map((o) => o.entry.subjectTemplate));
  const hasText = allOrNone(name, "textTemplatePath", ordered.map((o) => o.entry.textTemplatePath));

  const lines: string[] = [];
  if (config.derives && config.derives.length > 0) {
    lines.push(`#[derive(${config.derives.join(", ")})]`);
  }
  lines.push(`pub struct ${name} {`);
  lines.push(...generateFields(schema, numberType));
  lines.push("}");
  lines.push("");
  lines.push(`impl ${name} {`);

  if (hasSubject) {
    lines.push("    /// Returns the subject line in `locale`.");
    lines.push(`    pub fn subject(&self, locale: ${enumName}) -> String {`);
    lines.push("        match locale {");
    for (const { variant, entry } of ordered) {
      const expr = generateSubjectExpr(
        schema,
        entry.subjectTemplate as string,
        entry.subjectProps ?? [],
      );
      lines.push(`            ${enumName}::${variant} => ${expr},`);
    }
    lines.push("        }");
    lines.push("    }");
    lines.push("");
  }

  const renderMethod = (method: string, doc: string, suffix: string) => {
    lines.push(`    /// ${doc}`);
    lines.push(`    pub fn ${method}(&self, locale: ${enumName}) -> askama::Result<String> {`);
    lines.push("        match locale {");
    for (const { variant } of ordered) {
      lines.push(`            ${enumName}::${variant} => ${name}${variant}${suffix}(self).render(),`);
    }
    lines.push("        }");
    lines.push("    }");
  };

  renderMethod("render_html", "Renders the HTML body in `locale`.", "Html");
  if (hasText) {
    lines.push("");
    renderMethod("render_text", "Renders the plain-text body in `locale`.", "Text");
  }
  lines.push("}");

  for (const { variant, entry } of ordered) {
    lines.push("");
    lines.push(...generateTemplateWrapper(`${name}${variant}Html`, name, entry.templatePath));
    if (hasText) {
      lines.push("");
      lines.push(
        ...generateTemplateWrapper(`${name}${variant}Text`, name, entry.textTemplatePath as string),
      );
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Return true when every value is set and false when none is. Throw when
 * only some locales set the option, because the method would miss a locale.
 */
function allOrNone(
  structName: string,
  option: string,
  values: Array<string | undefined>,
): boolean {
  const set = values.filter((v) => v !== undefined && v !== "").length;
  if (set !== 0 && set !== values.length) {
    throw new Error(
      `rust-email: ${structName} sets ${option} for ${set} of ${values.length} locales. ` +
      `Set it for every locale or for none.`,
    );
  }
  return set === values.length;
}

/**
 * Generate a complete Rust module for localized emails: `use askama::Template;`,
 * the locale enum, and one struct per template.
 */
export function generateLocalizedRustModule(
  templates: Array<{
    schema: PropSchema;
    config: LocalizedCodegenConfig;
  }>,
  localeConfig: LocaleEnumConfig,
): string {
  const lines: string[] = [];

  lines.push("use askama::Template;");
  lines.push("");
  lines.push(generateLocaleEnum(localeConfig));

  for (const { schema, config } of templates) {
    lines.push(generateLocalizedRustStruct(schema, config, localeConfig));
  }

  return lines.join("\n");
}
