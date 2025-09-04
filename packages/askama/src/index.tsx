import React from "react";

/**
 * Convert props to Askama template syntax
 */
function convertToAskamaPlaceholders<T extends Record<string, any>>(
  props: T,
  prefix = ""
): Record<string, any> {
  const converted: Record<string, any> = {};

  for (const [key, value] of Object.entries(props)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      converted[key] = `{{ ${fullPath} }}`;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Processing Nested Objects
      converted[key] = convertToAskamaPlaceholders(value, fullPath);
    } else if (Array.isArray(value)) {
      // Processing Arrays - Askama Loop Syntax
      converted[key] = `{% for item in ${fullPath} %}{{ item }}{% endfor %}`;
    } else if (typeof value === "boolean") {
      // Processing Boolean Values - Askama Conditional Syntax
      converted[key] = `{% if ${fullPath} %}true{% else %}false{% endif %}`;
    } else {
      // Basic types
      converted[key] = `{{ ${fullPath} }}`;
    }
  }

  return converted;
}

/**
 * Askama template configuration
 */
export interface AskamaConfig {
  // Is snake_case (Rust style) used
  useSnakeCase?: boolean;
  // Custom filters
  filters?: Record<string, string>;
  // Escape HTML
  escapeHtml?: boolean;
}

/**
 * AskamaWrapper HOC
 * Convert React Email component to Askama compatible template
 */
export function AskamaWrapper<P extends Record<string, any>>(
  Component: React.ComponentType<P>,
  defaultProps: P,
  config: AskamaConfig = {}
): React.ComponentType {
  // Convert prop names to snake_case
  const toSnakeCase = (str: string): string => {
    if (!config.useSnakeCase) return str;
    return str
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      .slice(1);
  };

  // Generate Askama placeholders
  const generateAskamaProps = (): Record<string, any> => {
    const askamaProps: Record<string, any> = {};

    for (const [key, value] of Object.entries(defaultProps)) {
      const snakeKey = toSnakeCase(key);

      if (typeof value === "string") {
        askamaProps[key] = config.escapeHtml
          ? `{{ ${snakeKey}|e }}`
          : `{{ ${snakeKey} }}`;
      } else if (typeof value === "number") {
        askamaProps[key] = `{{ ${snakeKey} }}`;
      } else if (typeof value === "boolean") {
        askamaProps[key] = `{% if ${snakeKey} %}true{% else %}false{% endif %}`;
      } else if (Array.isArray(value)) {
        // Array processing - assume simple array
        askamaProps[
          key
        ] = `{% for item in ${snakeKey} %}{{ item }}{% endfor %}`;
      } else if (typeof value === "object" && value !== null) {
        // Object processing
        askamaProps[key] = convertToAskamaPlaceholders(value, snakeKey);
      }
    }

    // Apply custom filters
    if (config.filters) {
      for (const [key, filter] of Object.entries(config.filters)) {
        if (askamaProps[key]) {
          const snakeKey = toSnakeCase(key);
          askamaProps[key] = `{{ ${snakeKey}|${filter} }}`;
        }
      }
    }

    return askamaProps;
  };

  // Wrapped component
  const Template: React.ComponentType = () => {
    const mergedProps = generateAskamaProps() as P;
    return <Component {...mergedProps} />;
  };

  return Template;
}
