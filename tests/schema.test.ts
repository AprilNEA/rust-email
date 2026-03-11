import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { inferSchema } from "../src/schema";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

describe("schema fallback scoping", () => {
  it("should only infer fallbacks from the component function, not helpers", async () => {
    const { schema } = await inferSchema(path.join(FIXTURES, "scope-test.tsx"));

    // The component has `name ?? "friend"` and `count ?? 42`
    expect(schema.name.fallback).toBe("friend");
    expect(schema.count.fallback).toBe(42);

    // The helper `formatLabel` has `name ?? "default-label"` — must NOT override
    expect(schema.name.fallback).not.toBe("default-label");
    // The helper `computeTotal` has `count ?? 0` — must NOT override
    expect(schema.count.fallback).not.toBe(0);
  });

  it("should only infer fallbacks from props.xxx, not arbitrary obj.xxx", async () => {
    const { schema } = await inferSchema(
      path.join(FIXTURES, "prop-access-test.tsx"),
    );

    // The component has `props.currency ?? "US$"` and `props.greeting ?? "Hello"`
    expect(schema.currency.fallback).toBe("US$");
    expect(schema.greeting.fallback).toBe("Hello");

    // The helper `getDefaults()` has `defaults.currency ?? "GBP"` — must NOT pollute
    expect(schema.currency.fallback).not.toBe("GBP");
  });
});

describe("schema anonymous/wrapped component exports", () => {
  it("should infer fallbacks from anonymous default export arrow", async () => {
    const { schema } = await inferSchema(path.join(FIXTURES, "anon-export.tsx"));

    expect(schema.name.fallback).toBe("world");
    expect(schema.greeting.fallback).toBe("Hi");
  });

  it("should infer fallbacks from memo-wrapped component", async () => {
    const { schema } = await inferSchema(path.join(FIXTURES, "memo-wrapped.tsx"));

    expect(schema.title.fallback).toBe("Untitled");
    expect(schema.count.fallback).toBe(0);
  });
});

describe("schema destructured rename", () => {
  it("should infer fallbacks when props are renamed in destructuring", async () => {
    const { schema } = await inferSchema(path.join(FIXTURES, "destructured-rename.tsx"));

    // `{ name: displayName }` — `displayName ?? "friend"` should set fallback on `name`
    expect(schema.name.fallback).toBe("friend");
    // `{ emailAddress: addr }` — `addr ?? "no-reply@example.com"` should set fallback on `emailAddress`
    expect(schema.emailAddress.fallback).toBe("no-reply@example.com");
  });
});

describe("schema inline helper shadowing (identifier path)", () => {
  it("should not pick up fallbacks from nested functions with same-named params", async () => {
    const { schema } = await inferSchema(path.join(FIXTURES, "inline-helper.tsx"));

    // Component body has `name ?? "FROM_COMPONENT"` and `count ?? 42`
    expect(schema.name.fallback).toBe("FROM_COMPONENT");
    expect(schema.count.fallback).toBe(42);

    // Inline helper has `name ?? "FROM_HELPER_PARAM"` — must NOT win
    expect(schema.name.fallback).not.toBe("FROM_HELPER_PARAM");
    // Arrow helper has `count ?? 999` — must NOT win
    expect(schema.count.fallback).not.toBe(999);
  });
});

describe("schema inline helper shadowing (props.xxx path)", () => {
  it("should not pick up fallbacks from nested functions with props parameter", async () => {
    const { schema } = await inferSchema(path.join(FIXTURES, "inline-props-helper.tsx"));

    // Component body has `props.name ?? "FROM_COMPONENT_PROPS"` and `props.age ?? 25`
    expect(schema.name.fallback).toBe("FROM_COMPONENT_PROPS");
    expect(schema.age.fallback).toBe(25);

    // Nested helper has `props.name ?? "FROM_NESTED_PROPS"` — must NOT pollute
    expect(schema.name.fallback).not.toBe("FROM_NESTED_PROPS");
    // Arrow helper has `props.age ?? 999` — must NOT pollute
    expect(schema.age.fallback).not.toBe(999);
  });
});

describe("schema callback closures (no shadowing)", () => {
  it("should infer fallbacks from ?? inside callbacks that don't shadow the prop", async () => {
    const { schema } = await inferSchema(path.join(FIXTURES, "callback-fallback.tsx"));

    // `name ?? "fallback-in-callback"` inside .map(() => ...) — no param shadows `name`
    expect(schema.name.fallback).toBe("fallback-in-callback");
    // `label ?? "direct-fallback"` in the component body directly
    expect(schema.label.fallback).toBe("direct-fallback");
  });
});

describe("schema callback closures with destructured rename params", () => {
  it("should not treat destructured property names as shadowing locals", async () => {
    const { schema } = await inferSchema(
      path.join(FIXTURES, "callback-destructure-rename.tsx"),
    );

    // Callback param is `({ name: n })` — only `n` is local, `name` is not shadowed.
    expect(schema.name.fallback).toBe("fallback-from-callback");
  });

  it("should not treat destructured property names as shadowing props object names", async () => {
    const { schema } = await inferSchema(
      path.join(FIXTURES, "callback-props-destructure-rename.tsx"),
    );

    // Callback param is `({ props: p })` — only `p` is local, `props` is not shadowed.
    expect(schema.name.fallback).toBe("fallback-from-props-callback");
  });
});
