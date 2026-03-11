import { describe, it, expect } from "vitest";
import React from "react";
import { renderTemplate, validateTemplate } from "../src/render";
import type { PropSchema } from "../src/types";

// ── Helpers ──────────────────────────────────────────────────────────

/** Minimal component: renders each prop as a <span> */
function SimpleEmail(props: Record<string, unknown>) {
  const children: React.ReactNode[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined && v !== null) {
      children.push(React.createElement("span", { key: k }, String(v)));
    }
  }
  return React.createElement("div", null, ...children);
}

// ── 1. Boolean / number static-text collision ────────────────────────

describe("marker collision safety", () => {
  it("should NOT replace static 'true' text with Askama boolean syntax", async () => {
    // Component that has both a boolean prop AND literal "true" in the text
    function BoolEmail({ isActive }: { isActive: boolean }) {
      return React.createElement(
        "div",
        null,
        React.createElement("p", null, "Status: ", String(isActive)),
        React.createElement("p", null, "This is true and correct"),
      );
    }

    const schema: PropSchema = {
      isActive: { type: "boolean", optional: false },
    };

    const { html } = await renderTemplate(
      BoolEmail as any,
      { isActive: true } as any,
      schema,
    );

    // The static "true" in "This is true and correct" must survive
    expect(html).toContain("This is true and correct");
    // The prop should be wrapped in Askama syntax
    expect(html).toContain("{% if is_active %}true{% else %}false{% endif %}");
  });

  it("should NOT replace static number text with Askama number syntax", async () => {
    function NumEmail({ count }: { count: number }) {
      return React.createElement(
        "div",
        null,
        React.createElement("span", null, String(count)),
        React.createElement("p", null, "We have 77700 items in stock"),
      );
    }

    const schema: PropSchema = {
      count: { type: "number", optional: false },
    };

    const { html } = await renderTemplate(
      NumEmail as any,
      { count: 42 } as any,
      schema,
    );

    // The static "77700" in the template content must survive untouched
    expect(html).toContain("We have 77700 items in stock");
    // The count prop should be replaced with Askama syntax, not a colliding number
    expect(html).toContain("{{ count }}");
  });
});

// ── 2. Props pass-through (non-schema fields survive) ────────────────

describe("props pass-through", () => {
  it("should preserve non-schema props from the original props object", async () => {
    function StyledEmail({ name, className }: { name: string; className?: string }) {
      return React.createElement(
        "div",
        { className },
        React.createElement("p", null, name),
      );
    }

    const schema: PropSchema = {
      name: { type: "string", optional: false },
    };

    const { html } = await renderTemplate(
      StyledEmail as any,
      { name: "Alice", className: "email-wrapper" } as any,
      schema,
    );

    // className is not in schema, but should pass through from props
    expect(html).toContain("email-wrapper");
    // name should be replaced
    expect(html).toContain("{{ name }}");
  });
});

// ── 3. Non-contiguous diff must fail-fast ────────────────────────────

describe("non-contiguous conditional block", () => {
  it("should throw with prop name on non-contiguous diff", async () => {
    // Ternary: produces different text in both branches → non-contiguous diff
    function TernaryEmail({ status }: { status?: string }) {
      return React.createElement(
        "div",
        null,
        status
          ? React.createElement("p", null, "Active: ", status)
          : React.createElement("p", null, "Inactive"),
      );
    }

    const schema: PropSchema = {
      status: { type: "string", optional: true },
    };

    await expect(
      renderTemplate(
        TernaryEmail as any,
        { status: "online" } as any,
        schema,
      ),
    ).rejects.toThrow(/status/);
    await expect(
      renderTemplate(
        TernaryEmail as any,
        { status: "online" } as any,
        schema,
      ),
    ).rejects.toThrow(/non-contiguous/);
  });
});

// ── 4. validateTemplate strict mode ──────────────────────────────────

describe("validateTemplate strict", () => {
  it("should throw when residual markers are found", () => {
    const bad = `<div>Hello __RE_name_0_abc123__</div>`;
    expect(() => validateTemplate(bad, { name: "Alice" })).toThrow(
      /unreplaced/,
    );
  });

  it("should pass for clean template", () => {
    const good = `<div>Hello {{ name }}</div>`;
    const result = validateTemplate(good, { name: "Al" }); // short value skipped
    expect(result.valid).toBe(true);
  });
});
