import fs from "node:fs/promises";
import { buildSchema, parse, validate } from "graphql";
import {
  DOCUMENT_EXPORT_QUERY,
  INITIATIVE_DOCUMENTS_QUERY,
  INITIATIVE_LINKS_QUERY,
  INITIATIVE_BODY_QUERY,
  INITIATIVE_QUERY,
  INITIATIVE_RESOURCES_QUERY,
  ISSUE_DETAIL_PAGE_QUERY,
  ISSUES_QUERY,
  PROJECT_MILESTONES_QUERY,
  PROJECT_DOCUMENTS_QUERY,
  PROJECT_LINKS_QUERY,
  PROJECT_RESOURCES_QUERY,
} from "../src/lib/linear/queries";

const schemaPath = process.argv[2];
if (!schemaPath) {
  throw new Error("Usage: npx tsx scripts/validate-queries.ts /path/to/schema.graphql");
}

const schema = buildSchema(await fs.readFile(schemaPath, "utf8"));
const documents = {
  DOCUMENT_EXPORT_QUERY,
  INITIATIVE_DOCUMENTS_QUERY,
  INITIATIVE_LINKS_QUERY,
  INITIATIVE_BODY_QUERY,
  INITIATIVE_QUERY,
  INITIATIVE_RESOURCES_QUERY,
  PROJECT_MILESTONES_QUERY,
  PROJECT_DOCUMENTS_QUERY,
  PROJECT_LINKS_QUERY,
  PROJECT_RESOURCES_QUERY,
  ISSUES_QUERY,
  ISSUE_DETAIL_PAGE_QUERY,
};

let failed = false;
for (const [name, document] of Object.entries(documents)) {
  const errors = validate(schema, parse(document));
  if (errors.length) {
    failed = true;
    console.error(`${name}:`);
    for (const error of errors) console.error(`  - ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
else console.log(`Validated ${Object.keys(documents).length} GraphQL documents.`);
