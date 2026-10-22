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
7. With `plainText`, run steps 3–6 again on the plain-text conversion of each render

## Marker Generation

Each prop receives a unique high-entropy marker string in the format:

```
__RE_{KEY}_{COUNTER}_{RANDOM}__
```

This ensures markers cannot collide with real template content. All types (including booleans and numbers) use string markers, since React will render them as text content.

The whole marker is upper case. html-to-text converts headings to upper case in the plain-text output, and an upper-case marker stays the same.

The fallback pattern binds without `ref`: `{% if let Some(name) = name %}`. Askama matches on a reference to the field, and Askama 0.16 rejects `ref` as a binding name.

## Conditional Block Detection

For optional props without a fallback value (the `&&` pattern), the engine:

1. Renders the full template with all props present
2. Renders again with the specific prop removed
3. Uses Longest Common Prefix / Longest Common Suffix (LCP/LCS) to find the contiguous block that differs
4. If the diff is non-contiguous (e.g. ternary `? :` with both branches), throws an error

## Plain-text Output

With `plainText`, `renderTemplate()` converts every render to text with `toPlainText` from `@react-email/render`: the full render and each render without an optional prop. Then it runs the same conditional block detection and marker replacement on the text. The HTML and the text template therefore have the same conditional blocks and fallbacks.

Two rules differ from the HTML output:

- The text template never gets the `|e` filter, because Askama does not escape `.txt` templates and HTML escaping would corrupt the text.
- A required prop or a prop with a fallback can be absent from the text, for example an image URL. This adds a warning instead of an error.

## Localized Code Generation

`generateLocalizedRustModule()` generates one data struct per email and one private template struct per locale and format:

```rust
pub struct VerifyEmail {
    pub url: String,
}

#[derive(Template)]
#[template(path = "mail/verify-email.en.html")]
struct VerifyEmailEnHtml<'a>(&'a VerifyEmail);

impl std::ops::Deref for VerifyEmailEnHtml<'_> {
    type Target = VerifyEmail;

    fn deref(&self) -> &VerifyEmail {
        self.0
    }
}
```

The template struct borrows the data struct, and `Deref` lets the template read its fields. `render_html(locale)` matches on the locale and renders the template struct of that locale. The caller builds the data once and does not copy fields for each template.

## Schema Inference

`inferSchema()` uses `ts-morph` to parse the TypeScript AST:

1. Finds the interface ending with `Props`
2. Extracts property names, types, and optionality
3. Locates the component function body
4. Walks JSX expressions for `{prop ?? fallback}` patterns
5. Only infers fallbacks from string, number, and boolean literals
6. Handles destructured props (`{ name }`) and property access (`props.name`)
7. Detects parameter shadowing in nested functions
