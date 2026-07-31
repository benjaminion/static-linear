import fs from "node:fs/promises";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { LinearGraphQLClient } from "../src/lib/linear/client";
import { INITIATIVE_BODY_QUERY } from "../src/lib/linear/queries";

const OUTPUT_PATH = "content/initiative-overview.md";

async function main(): Promise<void> {
  loadDotEnv({ path: ".env.local", quiet: true });

  const apiKey = process.env.LINEAR_API_KEY;
  const initiativeId = process.env.LINEAR_INITIATIVE_ID;
  if (!apiKey) throw new Error("LINEAR_API_KEY is required in .env.local.");
  if (!initiativeId) throw new Error("LINEAR_INITIATIVE_ID is required in .env.local.");

  const client = new LinearGraphQLClient(apiKey);
  const data = await client.request<{
    initiative: {
      id: string;
      name: string;
      description: string | null;
      content: string | null;
    } | null;
  }>(INITIATIVE_BODY_QUERY, { id: initiativeId }, "InitiativeBody");

  if (!data.initiative) {
    throw new Error(`Linear initiative ${initiativeId} was not found or is inaccessible.`);
  }

  const markdown = data.initiative.content?.trim() || data.initiative.description?.trim();
  if (!markdown) {
    throw new Error(`Initiative “${data.initiative.name}” has no description content.`);
  }

  const outputPath = path.resolve(OUTPUT_PATH);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(temporaryPath, `${markdown}\n`, { encoding: "utf8", mode: 0o644 });
  await fs.rename(temporaryPath, outputPath);

  console.log(`Wrote Linear description for “${data.initiative.name}” to ${OUTPUT_PATH}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

