# Supported Syntax

## Conversion Matrix

| React pattern | Askama output | Notes |
|---|---|---|
| `{userName ?? 'there'}` | `{% if let Some(ref user_name) = user_name %}{{ user_name }}{% else %}there{% endif %}` | `??` with string/number/boolean literal fallback |
| `{props.currency ?? 'US$'}` | Same as above | Property access on LHS supported |
| `{(name) ?? 'anon'}` | Same as above | Parenthesized LHS supported |
| `{deploymentId && <Muted>...</Muted>}` | `{% if let Some(deployment_id) = deployment_id %}...{% endif %}` | Contiguous `&&` blocks only |
| `{serviceName}` (required) | `{{ service_name }}` | Direct interpolation |
| `{isActive}` (boolean) | `{% if is_active %}true{% else %}false{% endif %}` | Boolean rendering |

## Unsupported Patterns

These patterns produce a hard error — no implicit degradation:

| Pattern | Error |
|---|---|
| `{status ? <A/> : <B/>}` | **Non-contiguous conditional block** — ternary produces diff in both branches |
| Dynamic `??` RHS (e.g. `x ?? getDefault()`) | No fallback inferred (not an error, but fallback is `undefined`) |

## Type Mapping

TypeScript types are mapped to Rust types as follows:

| TypeScript | Rust (required) | Rust (optional) |
|---|---|---|
| `string` | `String` | `Option<String>` |
| `number` | `i64` (configurable) | `Option<i64>` |
| `boolean` | `bool` | `Option<bool>` |
| `string[]` | `Vec<String>` | `Option<Vec<String>>` |
| `object` (and other) | `String` | `Option<String>` |

The numeric type can be configured via `numberType` in `CodegenConfig` to any of: `i32`, `i64`, `u32`, `u64`, `f32`, `f64`.
