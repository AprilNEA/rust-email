export { AskamaWrapper, type AskamaConfig } from "./askama";
export { renderTemplate, validateTemplate } from "./render";
export { inferSchema, schemaToSnakeCase } from "./schema";
export { generateRustStruct, generateRustModule } from "./codegen";
export type {
  PropMeta,
  PropSchema,
  RenderConfig,
  RenderResult,
  CodegenConfig,
  EmailComponent,
} from "./types";
