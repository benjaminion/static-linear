import fs from "node:fs/promises";
import path from "node:path";

export interface LinearDocumentExport {
  id: string;
  title: string;
  content: string | null;
  slugId: string;
  url: string;
  archivedAt?: string | null;
  updatedAt?: string;
}

export interface LinearDocumentReference {
  identifier: string;
  outputBasename: string;
}

export function parseLinearDocumentReference(value: string): LinearDocumentReference {
  const input = value.trim();
  if (!input) throw new Error("A Linear document URL, slug, or ID is required.");

  let identifier = input;
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (url.protocol !== "https:" || !["linear.app", "www.linear.app"].includes(url.hostname)) {
      throw new Error("The document URL must be an https://linear.app URL.");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const documentIndex = segments.indexOf("document");
    identifier = documentIndex >= 0 ? decodeURIComponent(segments[documentIndex + 1] ?? "") : "";
    if (!identifier) throw new Error("The Linear URL does not contain a document slug.");
  } else if (input.includes("/")) {
    throw new Error("Pass a complete Linear document URL, slug, or UUID.");
  }

  const readableSlug = identifier.replace(/-[0-9a-f]{12}$/i, "");
  const safeName = readableSlug
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    identifier,
    outputBasename: safeName || `linear-document-${identifier.slice(0, 8)}`,
  };
}

export function linearDocumentIdentifierFromUrl(value: string): string | null {
  try {
    if (!/^https?:\/\//i.test(value)) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || !["linear.app", "www.linear.app"].includes(url.hostname)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const documentIndex = segments.indexOf("document");
    return documentIndex >= 0 ? decodeURIComponent(segments[documentIndex + 1] ?? "") || null : null;
  } catch {
    return null;
  }
}

export function linearDocumentSlugId(value: string): string | null {
  return value.match(/(?:^|-)([0-9a-f]{12})$/i)?.[1]?.toLowerCase() ?? null;
}

export function linearDocumentExportFilename(document: Pick<LinearDocumentExport, "slugId" | "url">): string {
  const identifier = linearDocumentIdentifierFromUrl(document.url) ?? document.slugId;
  const safeName = identifier
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${safeName || `linear-document-${document.slugId}`}.md`;
}

export function renderLinearDocumentMarkdown(document: LinearDocumentExport): string {
  const title = document.title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/([\\`*_[\]<>#])/g, "\\$1");
  if (!title) throw new Error("Linear returned a document without a title.");

  const markdown = `# ${title}${document.content ? `\n\n${document.content}` : ""}`;
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

export async function writeLinearDocumentExports(
  documents: LinearDocumentExport[],
  outputDirectory = ".cache/linear-documents",
): Promise<void> {
  const absoluteDirectory = path.resolve(outputDirectory);
  const manifestPath = path.join(absoluteDirectory, ".managed.json");
  const uniqueDocuments = [...new Map(
    documents.filter((document) => !document.archivedAt).map((document) => [document.id, document]),
  ).values()];
  const nextFiles = new Set(uniqueDocuments.map(linearDocumentExportFilename));

  await fs.mkdir(absoluteDirectory, { recursive: true });
  for (const document of uniqueDocuments) {
    const filename = linearDocumentExportFilename(document);
    const destination = path.join(absoluteDirectory, filename);
    const temporaryPath = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, renderLinearDocumentMarkdown(document), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, destination);
  }

  for (const filename of await readManagedFilenames(manifestPath)) {
    if (!nextFiles.has(filename) && path.basename(filename) === filename) {
      await fs.rm(path.join(absoluteDirectory, filename), { force: true });
    }
  }

  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryManifest, `${JSON.stringify([...nextFiles].sort(), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporaryManifest, manifestPath);
}

async function readManagedFilenames(manifestPath: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
