import { describe, expect, it } from "vitest";
import { renderPublicMarkdown } from "../src/lib/markdown";

describe("renderPublicMarkdown", () => {
  it("removes executable HTML and unsafe protocols", () => {
    const html = renderPublicMarkdown(
      '<script>alert(1)</script> [bad](javascript:alert(1)) <img src="https://evil.test/x" onerror="alert(1)">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("turns authenticated Linear files into a notice", () => {
    const html = renderPublicMarkdown("[design](https://uploads.linear.app/private/file.png)");
    expect(html).toContain("Attachment available in Linear");
    expect(html).not.toContain("uploads.linear.app");
  });

  it("turns embedded Linear images into the same public notice", () => {
    const html = renderPublicMarkdown("![private design](https://uploads.linear.app/private/design.png)");
    expect(html).toContain("Attachment available in Linear");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("uploads.linear.app");
  });

  it("hardens ordinary external links", () => {
    const html = renderPublicMarkdown("[documentation](https://example.com/docs)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("rewrites selected links as same-tab local links", () => {
    const html = renderPublicMarkdown(
      "[brief](https://linear.app/acme/document/brief-aaaaaaaaaaaa) and [other](https://example.com)",
      { rewriteHref: (href) => href.includes("brief-aaaaaaaaaaaa") ? "/documents/doc-1/" : href },
    );
    expect(html).toContain('<a href="/documents/doc-1/">brief</a>');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">other</a>');
  });

  it("renders a star-suffixed Linear link as plain text", () => {
    const html = renderPublicMarkdown("Read [internal planning*](https://example.com/private).");
    expect(html).toContain("Read internal planning.");
    expect(html).not.toContain("internal planning*");
    expect(html).not.toContain("https://example.com/private");
  });

  it("preserves formatting inside a star-suffixed link", () => {
    const html = renderPublicMarkdown('<a href="https://example.com"><strong>Internal*</strong></a>');
    expect(html).toContain("<strong>Internal</strong>");
    expect(html).not.toContain("<a");
  });

  it("can retain star-suffixed links for local Markdown", () => {
    const html = renderPublicMarkdown("[public footnote*](https://example.com)", {
      stripStarredLinks: false,
    });
    expect(html).toContain("public footnote*");
    expect(html).toContain('href="https://example.com"');
  });

  it("redacts email addresses from public prose", () => {
    const html = renderPublicMarkdown("Contact private.person@example.com for access.");
    expect(html).toContain("[redacted email]");
    expect(html).not.toContain("private.person@example.com");
  });
});
