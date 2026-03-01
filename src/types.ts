import type React from "react";

/**
 * Metadata for a single prop describing its type, optionality, and default value.
 *
 * - `optional: true` + `fallback` → corresponds to React `{prop ?? fallback}`
 * - `optional: true` + no fallback → corresponds to React `{prop && <JSX/>}`
 */
export interface PropMeta {
  type: "string" | "number" | "boolean" | "string[]" | "object";
  optional: boolean;
  fallback?: string | number | boolean;
}

export type PropSchema = Record<string, PropMeta>;

export interface RenderConfig {
  /** Convert camelCase prop names to snake_case (Rust convention). Default: true */
  useSnakeCase?: boolean;
  /** Add |e filter for HTML escaping on string interpolations. Default: false */
  escapeHtml?: boolean;
  /** Pretty-print the rendered HTML. Default: false */
  pretty?: boolean;
}

export interface CodegenConfig {
  /** Relative path for Askama `#[template(path = "...")]` attribute */
  templatePath: string;
  /** Rust struct name */
  structName: string;
  /** Additional #[derive(...)] entries beyond Template */
  derives?: string[];
  /** Rust numeric type to map TypeScript `number`. Default: "i64" */
  numberType?: "i32" | "i64" | "u32" | "u64" | "f32" | "f64";
  /** Generate a `subject()` method with this format string. Use `{}` for interpolation. */
  subjectTemplate?: string;
  /** Props referenced in the subject template */
  subjectProps?: string[];
}

export interface RenderResult {
  /** The generated Askama HTML template */
  html: string;
  /** Props that were not found in the rendered HTML (possible issues) */
  warnings: string[];
}

/**
 * A React component that exposes PreviewProps as a static property.
 * This is the standard react-email convention.
 */
export type EmailComponent<P = Record<string, unknown>> = React.ComponentType<P> & {
  PreviewProps?: P;
};
