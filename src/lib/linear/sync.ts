import { config as loadDotEnv } from "dotenv";
import { LinearGraphQLClient } from "./client";
import {
  DOCUMENT_EXPORT_QUERY,
  INITIATIVE_DOCUMENTS_QUERY,
  INITIATIVE_LINKS_QUERY,
  INITIATIVE_QUERY,
  INITIATIVE_RESOURCES_QUERY,
  ISSUE_DETAIL_PAGE_QUERY,
  ISSUES_QUERY,
  PROJECT_DOCUMENTS_QUERY,
  PROJECT_LINKS_QUERY,
  PROJECT_MILESTONES_QUERY,
  PROJECT_RESOURCES_QUERY,
} from "./queries";
import {
  normalizeSnapshot,
  type RawComment,
  type RawConnection,
  type RawDocument,
  type RawExternalResource,
  type RawInitiative,
  type RawIssue,
  type RawMilestone,
  type RawProject,
  type RawRelation,
} from "./normalize";
import {
  linearDocumentIdentifierFromUrl,
  linearDocumentSlugId,
  writeLinearDocumentExports,
} from "./document-export";
import { writeSnapshotAtomic } from "../snapshot";
import type { PublicSnapshot } from "../schema";

interface InitiativeResponse {
  initiative: (RawInitiative & { projects: RawConnection<RawProject> }) | null;
}
interface IssuesResponse { issues: RawConnection<RawIssue> }

export async function syncLinearSnapshot(options: {
  apiKey?: string;
  initiativeId?: string;
  endpoint?: string;
  client?: LinearGraphQLClient;
  write?: boolean;
} = {}): Promise<PublicSnapshot> {
  loadDotEnv({ path: ".env.local", quiet: true });
  const apiKey = options.apiKey ?? process.env.LINEAR_API_KEY;
  const initiativeId = options.initiativeId ?? process.env.LINEAR_INITIATIVE_ID;
  if (!apiKey) throw new Error("LINEAR_API_KEY is required. Add it to .env.local.");
  if (!initiativeId) throw new Error("LINEAR_INITIATIVE_ID is required. Add it to .env.local.");

  const client = options.client ?? new LinearGraphQLClient(apiKey, options.endpoint);
  const { initiative, projects } = await fetchInitiativeAndProjects(client, initiativeId);
  const issues = projects.length ? await fetchIssues(client, projects.map((project) => project.id)) : [];
  await fillOverflowConnections(client, issues);
  await fillMilestoneOverflow(client, projects);
  await fillResourceOverflow(client, initiative, projects);
  await resolveLinearDocumentResources(client, initiative, projects);

  const snapshot = normalizeSnapshot({ initiative, projects, issues, initiativeId });
  if (options.write !== false) {
    await writeSnapshotAtomic(snapshot);
    await writeLinearDocumentExports(collectDocuments(initiative, projects));
  }
  return snapshot;
}

async function fetchInitiativeAndProjects(client: LinearGraphQLClient, id: string) {
  let cursor: string | null = null;
  let initiative: RawInitiative | null = null;
  const projects: RawProject[] = [];

  do {
    const data: InitiativeResponse = await client.request(INITIATIVE_QUERY, { id, after: cursor }, "PublicInitiative");
    if (!data.initiative) throw new Error(`Linear initiative ${id} was not found or is inaccessible.`);
    initiative ??= data.initiative;
    projects.push(...data.initiative.projects.nodes);
    cursor = data.initiative.projects.pageInfo.hasNextPage
      ? requireCursor(data.initiative.projects.pageInfo.endCursor, "initiative projects")
      : null;
  } while (cursor);

  return { initiative, projects } as { initiative: RawInitiative; projects: RawProject[] };
}

async function fetchIssues(client: LinearGraphQLClient, projectIds: string[]): Promise<RawIssue[]> {
  let cursor: string | null = null;
  const issues: RawIssue[] = [];
  do {
    const data: IssuesResponse = await client.request(
      ISSUES_QUERY,
      { projectIds, after: cursor },
      "PublicIssues",
    );
    issues.push(...data.issues.nodes);
    cursor = data.issues.pageInfo.hasNextPage
      ? requireCursor(data.issues.pageInfo.endCursor, "issues")
      : null;
  } while (cursor);
  return issues;
}

async function fillOverflowConnections(client: LinearGraphQLClient, issues: RawIssue[]): Promise<void> {
  const work = issues.filter((issue) =>
    issue.comments.pageInfo.hasNextPage ||
    issue.relations.pageInfo.hasNextPage ||
    issue.inverseRelations.pageInfo.hasNextPage ||
    issue.labels.pageInfo.hasNextPage,
  );

  await mapWithConcurrency(work, 4, async (issue) => {
    await Promise.all([
      fetchIssueConnectionPages(client, issue, "comments"),
      fetchIssueConnectionPages(client, issue, "relations"),
      fetchIssueConnectionPages(client, issue, "inverseRelations"),
      fetchIssueConnectionPages(client, issue, "labels"),
    ]);
  });
}

type OverflowKey = "comments" | "relations" | "inverseRelations" | "labels";

async function fetchIssueConnectionPages(
  client: LinearGraphQLClient,
  issue: RawIssue,
  key: OverflowKey,
): Promise<void> {
  const connection = issue[key] as RawConnection<RawComment | RawRelation | { id: string; name: string }>;
  let cursor = connection.pageInfo.hasNextPage ? requireCursor(connection.pageInfo.endCursor, key) : null;
  while (cursor) {
    const variables = {
      id: issue.id,
      commentsAfter: key === "comments" ? cursor : null,
      relationsAfter: key === "relations" ? cursor : null,
      inverseAfter: key === "inverseRelations" ? cursor : null,
      labelsAfter: key === "labels" ? cursor : null,
    };
    const data = await client.request<{ issue: Record<OverflowKey, RawConnection<never>> }>(
      ISSUE_DETAIL_PAGE_QUERY,
      variables,
      "PublicIssueDetailPage",
    );
    const next = data.issue[key];
    connection.nodes.push(...next.nodes);
    cursor = next.pageInfo.hasNextPage ? requireCursor(next.pageInfo.endCursor, key) : null;
  }
  connection.pageInfo = { hasNextPage: false, endCursor: connection.pageInfo.endCursor };
}

async function fillMilestoneOverflow(client: LinearGraphQLClient, projects: RawProject[]): Promise<void> {
  await mapWithConcurrency(
    projects.filter((project) => project.projectMilestones.pageInfo.hasNextPage),
    4,
    async (project) => {
      let cursor: string | null = requireCursor(
        project.projectMilestones.pageInfo.endCursor,
        `milestones for ${project.name}`,
      );
      while (cursor) {
        const data: { project: { projectMilestones: RawConnection<RawMilestone> } } = await client.request<{
          project: { projectMilestones: RawConnection<RawMilestone> };
        }>(PROJECT_MILESTONES_QUERY, { id: project.id, after: cursor }, "PublicProjectMilestones");
        const milestonePage: RawConnection<RawMilestone> = data.project.projectMilestones;
        project.projectMilestones.nodes.push(...milestonePage.nodes);
        cursor = milestonePage.pageInfo.hasNextPage
          ? requireCursor(milestonePage.pageInfo.endCursor, "milestones")
          : null;
      }
      project.projectMilestones.pageInfo.hasNextPage = false;
    },
  );
}

async function fillResourceOverflow(
  client: LinearGraphQLClient,
  initiative: RawInitiative,
  projects: RawProject[],
): Promise<void> {
  const initiativeData = await client.request<{
    initiative: { documents: RawConnection<RawDocument>; links: RawConnection<RawExternalResource> };
  }>(INITIATIVE_RESOURCES_QUERY, { id: initiative.id }, "PublicInitiativeResources");
  initiative.documents = initiativeData.initiative.documents;
  initiative.links = initiativeData.initiative.links;
  await Promise.all([
    fillConnectionPages(initiative.documents, "initiative documents", async (after) => {
      const data = await client.request<{ initiative: { documents: RawConnection<RawDocument> } }>(
        INITIATIVE_DOCUMENTS_QUERY, { id: initiative.id, after }, "PublicInitiativeDocuments",
      );
      return data.initiative.documents;
    }),
    fillConnectionPages(initiative.links, "initiative links", async (after) => {
      const data = await client.request<{ initiative: { links: RawConnection<RawExternalResource> } }>(
        INITIATIVE_LINKS_QUERY, { id: initiative.id, after }, "PublicInitiativeLinks",
      );
      return data.initiative.links;
    }),
  ]);

  await mapWithConcurrency(projects, 4, async (project) => {
    const data = await client.request<{
      project: { documents: RawConnection<RawDocument>; externalLinks: RawConnection<RawExternalResource> };
    }>(PROJECT_RESOURCES_QUERY, { id: project.id }, "PublicProjectResources");
    project.documents = data.project.documents;
    project.externalLinks = data.project.externalLinks;
    await Promise.all([
      fillConnectionPages(project.documents, `documents for ${project.name}`, async (after) => {
        const data = await client.request<{ project: { documents: RawConnection<RawDocument> } }>(
          PROJECT_DOCUMENTS_QUERY, { id: project.id, after }, "PublicProjectDocuments",
        );
        return data.project.documents;
      }),
      fillConnectionPages(project.externalLinks, `links for ${project.name}`, async (after) => {
        const data = await client.request<{ project: { externalLinks: RawConnection<RawExternalResource> } }>(
          PROJECT_LINKS_QUERY, { id: project.id, after }, "PublicProjectLinks",
        );
        return data.project.externalLinks;
      }),
    ]);
  });
}

async function fillConnectionPages<T>(
  connection: RawConnection<T>,
  resource: string,
  fetchPage: (after: string) => Promise<RawConnection<T>>,
): Promise<void> {
  let cursor = connection.pageInfo.hasNextPage ? requireCursor(connection.pageInfo.endCursor, resource) : null;
  while (cursor) {
    const page = await fetchPage(cursor);
    connection.nodes.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? requireCursor(page.pageInfo.endCursor, resource) : null;
  }
  connection.pageInfo = { hasNextPage: false, endCursor: connection.pageInfo.endCursor };
}

async function resolveLinearDocumentResources(
  client: LinearGraphQLClient,
  initiative: RawInitiative,
  projects: RawProject[],
): Promise<void> {
  const knownDocuments = collectDocuments(initiative, projects);
  const documentsBySlugId = new Map(knownDocuments.map((document) => [document.slugId.toLowerCase(), document]));
  const resources = [
    ...(initiative.links?.nodes ?? []),
    ...projects.flatMap((project) => project.externalLinks?.nodes ?? []),
  ];
  const pending = new Map<string, { identifier: string; resources: RawExternalResource[] }>();

  for (const resource of resources) {
    const identifier = linearDocumentIdentifierFromUrl(resource.url);
    const slugId = identifier ? linearDocumentSlugId(identifier) : null;
    if (!identifier || !slugId) continue;
    const known = documentsBySlugId.get(slugId);
    if (known) {
      resource.document = known;
      continue;
    }
    const entry = pending.get(slugId) ?? { identifier, resources: [] };
    entry.resources.push(resource);
    pending.set(slugId, entry);
  }

  await mapWithConcurrency([...pending.entries()], 4, async ([slugId, entry]) => {
    const data = await client.request<{ document: RawDocument }>(
      DOCUMENT_EXPORT_QUERY,
      { id: entry.identifier },
      "ExportLinearDocument",
    );
    documentsBySlugId.set(slugId, data.document);
    for (const resource of entry.resources) resource.document = data.document;
  });
}

function collectDocuments(initiative: RawInitiative, projects: RawProject[]): RawDocument[] {
  const documents = [
    ...(initiative.documents?.nodes ?? []),
    ...projects.flatMap((project) => project.documents?.nodes ?? []),
    ...(initiative.links?.nodes ?? []).flatMap((resource) => resource.document ? [resource.document] : []),
    ...projects.flatMap((project) =>
      (project.externalLinks?.nodes ?? []).flatMap((resource) => resource.document ? [resource.document] : [])),
  ];
  return [...new Map(documents.map((document) => [document.id, document])).values()];
}

function requireCursor(cursor: string | null, resource: string): string {
  if (!cursor) throw new Error(`Linear reported another page of ${resource} without a cursor.`);
  return cursor;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await operation(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
