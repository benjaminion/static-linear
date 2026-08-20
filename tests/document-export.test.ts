import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  linearDocumentExportFilename,
  linearDocumentIdentifierFromUrl,
  linearDocumentSlugId,
  parseLinearDocumentReference,
  renderLinearDocumentMarkdown,
  writeLinearDocumentExports,
} from "../src/lib/linear/document-export";

describe("Linear document export", () => {
  it("extracts the document slug and a readable filename from a Linear URL", () => {
    expect(parseLinearDocumentReference(
      "https://linear.app/ef-protocol/document/project-brief-1a92b6cf2b4e",
    )).toEqual({
      identifier: "project-brief-1a92b6cf2b4e",
      outputBasename: "project-brief",
    });
  });

  it("rejects non-Linear URLs", () => {
    expect(() => parseLinearDocumentReference(
      "https://example.com/ef-protocol/document/project-brief-1a92b6cf2b4e",
    )).toThrow("https://linear.app");
  });

  it("recognizes Linear document links and creates unique export filenames", () => {
    const url = "https://linear.app/ef-protocol/document/project-brief-1a92b6cf2b4e#scope";
    expect(linearDocumentIdentifierFromUrl(url)).toBe("project-brief-1a92b6cf2b4e");
    expect(linearDocumentSlugId("project-brief-1a92b6cf2b4e")).toBe("1a92b6cf2b4e");
    expect(linearDocumentExportFilename({ slugId: "1a92b6cf2b4e", url })).toBe("project-brief-1a92b6cf2b4e.md");
  });

  it("preserves the Markdown body while adding the document title", () => {
    const body = [
      "## Scope",
      "",
      "| Item | Owner |",
      "| --- | --- |",
      "| API | Ada |",
      "",
      "- First",
      "  - Nested",
    ].join("\n");

    expect(renderLinearDocumentMarkdown({
      id: "document-1",
      title: "Project *brief*",
      content: body,
      slugId: "1a92b6cf2b4e",
      url: "https://linear.app/example/document/project-brief-1a92b6cf2b4e",
    })).toBe(`# Project \\*brief\\*\n\n${body}\n`);
  });

  it("writes private managed exports and prunes only stale managed files", async () => {
    const directory = await fs.mkdtemp(path.join("/tmp", "linear-document-export-"));
    const document = {
      id: "document-1",
      title: "Project brief",
      content: "## Scope",
      slugId: "1a92b6cf2b4e",
      url: "https://linear.app/example/document/project-brief-1a92b6cf2b4e",
    };
    try {
      await fs.writeFile(path.join(directory, "manual.md"), "keep\n");
      await writeLinearDocumentExports([document], directory);
      const exported = path.join(directory, "project-brief-1a92b6cf2b4e.md");
      expect((await fs.stat(exported)).mode & 0o777).toBe(0o600);
      expect(await fs.readFile(exported, "utf8")).toBe("# Project brief\n\n## Scope\n");

      await writeLinearDocumentExports([], directory);
      await expect(fs.access(exported)).rejects.toThrow();
      expect(await fs.readFile(path.join(directory, "manual.md"), "utf8")).toBe("keep\n");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
