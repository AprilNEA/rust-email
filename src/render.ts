import { snakeCase } from "change-case";
import React from "react";
import type { PropSchema, RenderConfig, RenderResult } from "./types";

/**
 * Find the single contiguous block present in `full` but absent in `without`.
 *
 * Uses longest-common-prefix / longest-common-suffix to isolate the insertion.
 * Returns null when the diff is non-contiguous (e.g. ternary with both branches).
 */
function findConditionalBlock(
  full: string,
  without: string,
): { prefixEnd: number; suffixStart: number; block: string } | null {
  // No difference
  if (full === without) return null;

  // LCP
  let prefixEnd = 0;
  const minLen = Math.min(full.length, without.length);
  while (prefixEnd < minLen && full[prefixEnd] === without[prefixEnd]) {
    prefixEnd++;
  }

  // LCS (from the end, respecting prefix boundary)
  let suffixLen = 0;
  const maxSuffix = Math.min(
    full.length - prefixEnd,
    without.length - prefixEnd,
  );
  while (
    suffixLen < maxSuffix &&
    full[full.length - 1 - suffixLen] ===
      without[without.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const suffixStart = full.length - suffixLen;
  const block = full.slice(prefixEnd, suffixStart);

  // The "without" version should have nothing between prefix and suffix
  const remainder = without.slice(prefixEnd, without.length - suffixLen);
  if (remainder.length > 0) {
    // Non-contiguous diff — skip this prop (needs manual handling)
    return null;
  }

  if (block.length === 0) return null;

  return { prefixEnd, suffixStart, block };
}

/**
 * Generate a unique marker value for a prop based on its type.
 * String props get a distinctive marker string.
 * Number props get a large unique number to avoid collisions.
 */
function generateMarker(
  key: string,
  type: string,
  counter: number,
): string | number | boolean {
  switch (type) {
    case "number":
      return 77700 + counter;
    case "boolean":
      return true;
    default:
      return `__RE_${key}_${counter.toString(36)}__`;
  }
}

interface ConditionalBlock {
  askamaKey: string;
  startIdx: number;
  endIdx: number;
  content: string;
}

/**
 * Render a react-email component into an Askama-compatible HTML template.
 *
 * Strategy (post-render replacement):
 * 1. Render the component with unique marker values for all props
 * 2. For each optional prop without fallback (controls && blocks):
 *    render again without that prop, diff to find the conditional HTML section
 * 3. Wrap conditional sections with {% if let Some(...) %}...{% endif %}
 * 4. Replace remaining markers with {{ var }} or {% if let Some %}...{% else %}...{% endif %}
 */
export async function renderTemplate<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  props: P,
  schema: PropSchema,
  config: RenderConfig = {},
): Promise<RenderResult> {
  let render: (element: React.ReactElement) => Promise<string>;
  try {
    const mod = await import("@react-email/render");
    render = mod.render;
  } catch {
    throw new Error(
      "rust-email: @react-email/render is required. Install it with: pnpm add @react-email/render",
    );
  }

  const useSnakeCase = config.useSnakeCase ?? true;
  const toCase = useSnakeCase ? snakeCase : (s: string) => s;
  const escapeFilter = config.escapeHtml ? "|e" : "";
  const warnings: string[] = [];

  // Step 1: Build marker props — each prop value is a unique identifiable string/number
  const markerProps: Record<string, unknown> = {};
  const markerMap = new Map<string, { marker: string | number | boolean; askamaKey: string }>();
  let counter = 0;

  for (const [key, meta] of Object.entries(schema)) {
    const marker = generateMarker(key, meta.type, counter++);
    const askamaKey = toCase(key);
    markerProps[key] = marker;
    markerMap.set(key, { marker, askamaKey });
  }

  // Step 2: Render full HTML with all markers
  const fullHtml = await render(
    React.createElement(Component, markerProps as P),
  );

  // Step 3: Detect conditional blocks (optional props without fallback → && pattern)
  const conditionalProps = Object.entries(schema).filter(
    ([, meta]) => meta.optional && meta.fallback === undefined,
  );

  const blocks: ConditionalBlock[] = [];

  for (const [key] of conditionalProps) {
    const info = markerMap.get(key);
    if (!info) continue;

    // Render without this prop
    const withoutProps = { ...markerProps };
    delete withoutProps[key];
    const withoutHtml = await render(
      React.createElement(Component, withoutProps as P),
    );

    const diff = findConditionalBlock(fullHtml, withoutHtml);
    if (diff) {
      blocks.push({
        askamaKey: info.askamaKey,
        startIdx: diff.prefixEnd,
        endIdx: diff.suffixStart,
        content: diff.block,
      });
    } else if (fullHtml !== withoutHtml) {
      warnings.push(
        `${key}: conditional block is non-contiguous, needs manual Askama conversion`,
      );
    }
  }

  // Step 4: Apply conditional wrappings (back-to-front to preserve indices)
  blocks.sort((a, b) => b.startIdx - a.startIdx);

  let result = fullHtml;
  for (const block of blocks) {
    const before = result.slice(0, block.startIdx);
    const after = result.slice(block.endIdx);
    const wrapped =
      `{% if let Some(${block.askamaKey}) = ${block.askamaKey} %}` +
      block.content +
      `{% endif %}`;
    result = before + wrapped + after;
  }

  // Step 5: Replace markers with Askama syntax

  // 5a: Optional props with fallback (the ?? pattern)
  const fallbackProps = Object.entries(schema).filter(
    ([, meta]) => meta.optional && meta.fallback !== undefined,
  );
  for (const [key, meta] of fallbackProps) {
    const info = markerMap.get(key);
    if (!info) continue;
    const markerStr = String(info.marker);
    const fallback = String(meta.fallback);
    const replacement =
      `{% if let Some(ref ${info.askamaKey}) = ${info.askamaKey} %}` +
      `{{ ${info.askamaKey}${escapeFilter} }}` +
      `{% else %}${fallback}{% endif %}`;

    if (result.includes(markerStr)) {
      result = replaceAll(result, markerStr, replacement);
    } else {
      warnings.push(`${key}: marker not found in rendered HTML`);
    }
  }

  // 5b: Required props and conditional props (simple {{ var }} replacement)
  const simpleProps = Object.entries(schema).filter(
    ([, meta]) => !meta.optional || meta.fallback === undefined,
  );
  for (const [key, meta] of simpleProps) {
    const info = markerMap.get(key);
    if (!info) continue;
    const markerStr = String(info.marker);

    let replacement: string;
    if (meta.type === "boolean") {
      replacement = `{% if ${info.askamaKey} %}true{% else %}false{% endif %}`;
    } else {
      replacement = `{{ ${info.askamaKey}${escapeFilter} }}`;
    }

    if (result.includes(markerStr)) {
      result = replaceAll(result, markerStr, replacement);
    } else if (!meta.optional) {
      // Required prop not found — warning
      warnings.push(`${key}: required prop marker not found in rendered HTML`);
    }
    // Optional without fallback: marker might only appear inside conditional block
    // which is fine — it was already handled in step 4 content
  }

  // Step 6: Replace markers that appear inside conditional blocks
  // (they were captured in block.content before step 5, so re-scan)
  for (const [key] of Object.entries(schema)) {
    const info = markerMap.get(key);
    if (!info) continue;
    const markerStr = String(info.marker);
    if (result.includes(markerStr)) {
      result = replaceAll(
        result,
        markerStr,
        `{{ ${info.askamaKey}${escapeFilter} }}`,
      );
    }
  }

  return { html: result, warnings };
}

function replaceAll(str: string, search: string, replacement: string): string {
  return str.split(search).join(replacement);
}

/**
 * Validate that no marker values remain in the template output.
 * Also checks that no raw prop values from the original props leak through.
 *
 * Pass the schema to skip false positives where a prop's preview value
 * matches its fallback (e.g. currency: "US$" with fallback "US$").
 */
export function validateTemplate(
  template: string,
  props: Record<string, unknown>,
  schema?: PropSchema,
): { valid: boolean; unreplaced: string[] } {
  const unreplaced: string[] = [];

  // Check for leftover markers
  const markerPattern = /__RE_\w+_\w+__/g;
  const leftoverMarkers = template.match(markerPattern);
  if (leftoverMarkers) {
    for (const m of new Set(leftoverMarkers)) {
      unreplaced.push(`marker: ${m}`);
    }
  }

  // Check that original prop values don't appear literally
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    const str = String(value);
    // Skip very short values (1-2 chars) — too many false positives
    if (str.length <= 2) continue;

    // Skip if prop value matches its schema fallback (it's expected to appear)
    if (schema?.[key]?.fallback !== undefined) {
      if (String(schema[key].fallback) === str) continue;
    }

    if (template.includes(str)) {
      unreplaced.push(key);
    }
  }

  return { valid: unreplaced.length === 0, unreplaced };
}
