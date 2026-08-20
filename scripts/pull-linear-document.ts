import fs from "node:fs/promises";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { LinearGraphQLClient } from "../src/lib/linear/client";
import {
  parseLinearDocumentReference,
  renderLinearDocumentMarkdown,
  type LinearDocumentExport,
} from "../src/lib/linear/document-export";
import { DOCUMENT_EXPORT_QUERY } from "../src/lib/linear/queries";

const DEFAULT_DOCUMENT_URL = "https://linear.app/ef-protocol/document/project-brief-1a92b6cf2b4e";

async function main(): Promise<void> {
  loadDotEnv({ path: ".env.local", quiet: true });

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("LINEAR_API_KEY is required in .env.local.");

  const reference = parseLinearDocumentReference(process.argv[2] ?? DEFAULT_DOCUMENT_URL);
  const outputPath = path.resolve(
    process.argv[3] ?? path.join(".cache", "linear-documents", `${reference.outputBasename}.md`),
  );

  const client = new LinearGraphQLClient(apiKey);
  const data = await client.request<{ document: LinearDocumentExport }>(
    DOCUMENT_EXPORT_QUERY,
    { id: reference.identifier },
    "ExportLinearDocument",
  );
  const markdown = renderLinearDocumentMarkdown(data.document);

  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(temporaryPath, markdown, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, outputPath);

  console.log(`Wrote Linear document “${data.document.title}” to ${path.relative(process.cwd(), outputPath)}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
