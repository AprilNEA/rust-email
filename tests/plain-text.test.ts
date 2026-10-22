import { describe, it, expect } from "vitest";
import React from "react";
import { renderTemplate, validateTemplate } from "../src/render";
import type { PropSchema } from "../src/types";

const h = React.createElement;

// ── Plain-text output ────────────────────────────────────────────────

describe("plain text output", () => {
  it("should return no text unless plainText is set", async () => {
    function Email({ name }: { name: string }) {
      return h("p", null, "Hi ", name);
    }
    const schema: PropSchema = { name: { type: "string", optional: false } };

    const result = await renderTemplate(Email as any, { name: "Ada" } as any, schema);

    expect(result.text).toBeUndefined();
    expect(result.html).toContain("{{ name }}");
  });

  it("should print a link once when its text equals its href", async () => {
    function Email({ url }: { url: string }) {
      return h("div", null, h("p", null, "Open this link:"), h("a", { href: url }, url));
    }
    const schema: PropSchema = { url: { type: "string", optional: false } };

    const { html, text } = await renderTemplate(
      Email as any,
      { url: "https://example.com/verify?token=abc" } as any,
      schema,
      { plainText: true },
    );
    // The overload types `text` as string when plainText is set.
    const textTemplate: string = text;

    expect(html).toContain('href="{{ url }}"');
    expect(textTemplate.split("{{ url }}")).toHaveLength(2);
    expect(textTemplate).toContain("Open this link:");
  });

  it("should keep markers inside headings that html-to-text upper-cases", async () => {
    function Email({ name }: { name: string }) {
      return h("div", null, h("h1", null, "Welcome, ", name), h("p", null, "Body"));
    }
    const schema: PropSchema = { name: { type: "string", optional: false } };

    const { text } = await renderTemplate(Email as any, { name: "Ada" } as any, schema, {
      plainText: true,
    });

    expect(text).toContain("WELCOME, {{ name }}");
  });

  it("should add custom selectors to the React Email defaults", async () => {
    function Email({ name, url }: { name: string; url: string }) {
      return h(
        "div",
        null,
        h("h1", null, "Welcome, ", name),
        h("img", { src: "https://example.com/logo.png", alt: "Logo" }),
        h("a", { href: url }, url),
      );
    }
    const schema: PropSchema = {
      name: { type: "string", optional: false },
      url: { type: "string", optional: false },
    };

    const { text } = await renderTemplate(
      Email as any,
      { name: "Ada", url: "https://example.com/verify" } as any,
      schema,
      {
        plainText: {
          htmlToTextOptions: {
            selectors: [{ selector: "h1", options: { uppercase: false } }],
          },
        },
      },
    );

    // The custom selector applies...
    expect(text).toContain("Welcome, {{ name }}");
    // ...and the defaults still skip images and print a link once.
    expect(text).not.toContain("logo.png");
    expect(text.split("{{ url }}")).toHaveLength(2);
  });

  it("should wrap && blocks in the text template", async () => {
    function Email({ code, schoolName }: { code: string; schoolName?: string }) {
      return h(
        "div",
        null,
        h("p", null, "Your code is ", code),
        schoolName && h("p", null, "School: ", schoolName),
        h("p", null, "Thanks"),
      );
    }
    const schema: PropSchema = {
      code: { type: "string", optional: false },
      schoolName: { type: "string", optional: true },
    };

    const { html, text } = await renderTemplate(
      Email as any,
      { code: "123456", schoolName: "MIT" } as any,
      schema,
      { plainText: true },
    );

    for (const output of [html, text]) {
      expect(output).toContain("{% if let Some(school_name) = school_name %}");
      expect(output).toContain("{{ school_name }}");
      expect(output).toContain("{% endif %}");
    }
    // React separates text and values with <!-- --> in HTML, but not in text.
    expect(text).toContain("School: {{ school_name }}");
    expect(text).toContain("Your code is {{ code }}");
    expect(text).toContain("Thanks");
  });

  it("should not add the |e filter to the text template", async () => {
    function Email({ url }: { url: string }) {
      return h("a", { href: url }, "Verify");
    }
    const schema: PropSchema = { url: { type: "string", optional: false } };

    const { html, text } = await renderTemplate(
      Email as any,
      { url: "https://example.com" } as any,
      schema,
      { plainText: true, escapeHtml: true },
    );

    expect(html).toContain("{{ url|e }}");
    expect(text).toContain("{{ url }}");
    expect(text).not.toContain("|e");
  });

  it("should warn instead of throwing when the text does not use a required prop", async () => {
    function Email({ name, avatarUrl }: { name: string; avatarUrl: string }) {
      return h("div", null, h("img", { src: avatarUrl, alt: "" }), h("p", null, "Hi ", name));
    }
    const schema: PropSchema = {
      name: { type: "string", optional: false },
      avatarUrl: { type: "string", optional: false },
    };

    const { html, text, warnings } = await renderTemplate(
      Email as any,
      { name: "Ada", avatarUrl: "https://example.com/a.png" } as any,
      schema,
      { plainText: true },
    );

    expect(html).toContain("{{ avatar_url }}");
    expect(text).not.toContain("avatar_url");
    expect(text).toContain("Hi {{ name }}");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/avatarUrl.*plain text/);
  });
});

// ── Fallback syntax ──────────────────────────────────────────────────

describe("fallback replacement", () => {
  it("should not use ref, which Askama 0.16 rejects", async () => {
    function Email({ nick }: { nick?: string }) {
      return h("p", null, "Hi ", nick ?? "there");
    }
    const schema: PropSchema = {
      nick: { type: "string", optional: true, fallback: "there" },
    };

    const { html, text } = await renderTemplate(
      Email as any,
      { nick: "Ada" } as any,
      schema,
      { plainText: true },
    );

    const expected = "{% if let Some(nick) = nick %}{{ nick }}{% else %}there{% endif %}";
    expect(html).toContain(expected);
    expect(text).toContain(expected);
    expect(html).not.toContain("ref ");
  });
});

// ── Marker format ────────────────────────────────────────────────────

describe("upper-case markers", () => {
  it("should still be caught by validateTemplate", () => {
    expect(() => validateTemplate("Hi __RE_NAME_0_ABC123__", {})).toThrow(/unreplaced/);
  });
});
