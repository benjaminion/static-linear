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

  it("redacts email addresses from public prose", () => {
    const html = renderPublicMarkdown("Contact private.person@example.com for access.");
    expect(html).toContain("[redacted email]");
    expect(html).not.toContain("private.person@example.com");
  });
});
