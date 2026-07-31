import { describe, expect, it } from "vitest";
import { readLocalMarkdown } from "../src/lib/local-content";

describe("readLocalMarkdown", () => {
  it("renders the local initiative overview", async () => {
    const html = await readLocalMarkdown("tests/fixtures/local-content.md");
    expect(html).toContain("<strong>overview</strong>");
    expect(html).toContain("public footnote*");
    expect(html).toContain('href="https://example.com"');
  });

  it("reports a useful error for a missing file", async () => {
    await expect(readLocalMarkdown("content/not-present.md")).rejects.toThrow(
      "Local Markdown file not found",
    );
  });
});
