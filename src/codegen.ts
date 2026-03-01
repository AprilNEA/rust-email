import { snakeCase } from "change-case";
import type { CodegenConfig, PropMeta, PropSchema } from "./types";

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
 * Generate a Rust struct definition with `#[derive(Template)]` for Askama.
 *
 * Converts a PropSchema into a Rust struct where:
 * - camelCase keys become snake_case fields
 * - TypeScript types map to Rust types (string → String, number → i64, etc.)
 * - Optional props become Option<T>
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

  for (const [key, meta] of Object.entries(schema)) {
    const rustName = snakeCase(key);
    const rustType = toRustType(meta, numberType);
    lines.push(`    pub ${rustName}: ${rustType},`);
  }

  lines.push("}");

  // Generate subject() method if template provided
  if (config.subjectTemplate) {
    lines.push("");
    lines.push(`impl ${config.structName} {`);
    lines.push(`    pub fn subject(&self) -> String {`);

    const subjectProps = config.subjectProps ?? [];
    if (subjectProps.length === 0) {
      // Static subject
      lines.push(
        `        ${JSON.stringify(config.subjectTemplate)}.to_string()`,
      );
    } else {
      // Dynamic subject with format!
      const formatArgs = subjectProps
        .map((p) => {
          const rustName = snakeCase(p);
          const meta = schema[p];
          if (meta?.optional) {
            return `self.${rustName}.as_deref().unwrap_or("unknown")`;
          }
          return `self.${rustName}`;
        })
        .join(", ");
      lines.push(
        `        format!(${JSON.stringify(config.subjectTemplate)}, ${formatArgs})`,
      );
    }

    lines.push("    }");
    lines.push("}");
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
