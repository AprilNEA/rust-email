# How It Works

## Post-render Replacement Strategy

Traditional approach (`AskamaWrapper`, v0.1) replaces prop values **before** React renders — this breaks `&&` conditionals and `??` fallbacks because the placeholder string is always truthy.

`renderTemplate()` (v0.2+) uses **post-render replacement**:

1. Render the component with high-entropy marker strings for all prop types (no more `true`/`77700+N` — avoids collisions with real content)
2. Merge `{ ...props, ...markerProps }` so non-schema fields (e.g. `className`, `style`) survive
3. For `&&` conditional blocks: render again without the prop, diff the two HTML outputs (LCP/LCS) to locate the conditional section
4. Wrap detected sections with `{% if let Some(...) %}`
5. Replace markers with `{{ variable }}` or `{% if let Some %}...{% else %}fallback{% endif %}`
6. Final residual-marker check — any leftover markers are a hard error

## Marker Generation

Each prop receives a unique high-entropy marker string in the format:

```
__RE_{key}_{counter}_{random}__
```

This ensures markers cannot collide with real template content. All types (including booleans and numbers) use string markers, since React will render them as text content.

## Conditional Block Detection

For optional props without a fallback value (the `&&` pattern), the engine:

1. Renders the full template with all props present
2. Renders again with the specific prop removed
3. Uses Longest Common Prefix / Longest Common Suffix (LCP/LCS) to find the contiguous block that differs
4. If the diff is non-contiguous (e.g. ternary `? :` with both branches), throws an error

## Schema Inference

`inferSchema()` uses `ts-morph` to parse the TypeScript AST:

1. Finds the interface ending with `Props`
2. Extracts property names, types, and optionality
3. Locates the component function body
4. Walks JSX expressions for `{prop ?? fallback}` patterns
5. Only infers fallbacks from string, number, and boolean literals
6. Handles destructured props (`{ name }`) and property access (`props.name`)
7. Detects parameter shadowing in nested functions
