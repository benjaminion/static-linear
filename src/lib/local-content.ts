import fs from "node:fs/promises";
import path from "node:path";
import { renderPublicMarkdown } from "./markdown";

export async function readLocalMarkdown(relativePath: string): Promise<string> {
  const absolutePath = path.resolve(relativePath);
  try {
    return renderPublicMarkdown(await fs.readFile(absolutePath, "utf8"), {
      stripStarredLinks: false,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Local Markdown file not found: ${absolutePath}`);
    }
    throw error;
  }
}
