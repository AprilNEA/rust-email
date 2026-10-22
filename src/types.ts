import type React from "react";
import type { toPlainText } from "@react-email/render";

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

/** Options for html-to-text, as accepted by `toPlainText` from `@react-email/render`. */
export type HtmlToTextOptions = NonNullable<Parameters<typeof toPlainText>[1]>;

export interface PlainTextConfig {
  /**
   * Options for html-to-text. `selectors` extend React Email's plain-text
   * selectors: a selector with the same `selector` value overrides the
   * default one. Other keys replace the React Email default for that key.
   */
  htmlToTextOptions?: HtmlToTextOptions;
}

export interface RenderConfig {
  /** Convert camelCase prop names to snake_case (Rust convention). Default: true */
  useSnakeCase?: boolean;
  /** Add |e filter for HTML escaping on string interpolations. Default: false */
  escapeHtml?: boolean;
  /** Pretty-print the rendered HTML. Default: false */
  pretty?: boolean;
  /**
   * Also generate a plain-text Askama template from the same component.
   * Pass `true` to use React Email's plain-text conversion, or an object to
   * customise it. The text template never gets the `|e` filter. Default: false
   */
  plainText?: boolean | PlainTextConfig;
}

export interface CodegenConfig {
  /** Relative path for Askama `#[template(path = "...")]` attribute */
  templatePath: string;
  /**
   * Relative path of the plain-text Askama template. When set, the struct
   * gets a `render_text()` method that renders this template.
   */
  textTemplatePath?: string;
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

/** The templates of one locale in a localized email. */
export interface LocaleTemplateConfig {
  /** Locale tag, such as `"zh-Hans"`. It must be one of the module locales. */
  locale: string;
  /** Relative path of the HTML Askama template for this locale */
  templatePath: string;
  /** Relative path of the plain-text Askama template for this locale */
  textTemplatePath?: string;
  /** Subject format string for this locale. Use `{}` for interpolation. */
  subjectTemplate?: string;
  /** Props referenced in the subject template of this locale */
  subjectProps?: string[];
}

export interface LocalizedCodegenConfig {
  /** Rust struct name. The struct holds the props and has no `Template` derive. */
  structName: string;
  /** `#[derive(...)]` entries for the struct, such as `["Debug", "Clone"]` */
  derives?: string[];
  /** Rust numeric type to map TypeScript `number`. Default: "i64" */
  numberType?: "i32" | "i64" | "u32" | "u64" | "f32" | "f64";
  /**
   * One entry for each module locale. Either every entry sets
   * `textTemplatePath` or none does. The same rule applies to `subjectTemplate`.
   */
  locales: LocaleTemplateConfig[];
}

export interface LocaleEnumConfig {
  /**
   * Locale tags in declaration order, such as `["zh-Hans", "en"]`.
   * Each tag becomes an enum variant in PascalCase, such as `ZhHans`.
   */
  locales: string[];
  /** Name of the generated locale enum. Default: "Locale" */
  localeEnum?: string;
}

export interface RenderResult {
  /** The generated Askama HTML template */
  html: string;
  /**
   * The generated Askama plain-text template. It is present only when
   * `RenderConfig.plainText` is set.
   */
  text?: string;
  /** Non-fatal issues, such as props that the plain-text output does not use */
  warnings: string[];
}

/**
 * A React component that exposes PreviewProps as a static property.
 * This is the standard react-email convention.
 */
export type EmailComponent<P = Record<string, unknown>> = React.ComponentType<P> & {
  PreviewProps?: P;
};
