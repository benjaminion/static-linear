import { config as loadDotEnv } from "dotenv";
import { LinearGraphQLClient } from "./client";
import {
  INITIATIVE_QUERY,
  ISSUE_DETAIL_PAGE_QUERY,
  ISSUES_QUERY,
  PROJECT_MILESTONES_QUERY,
} from "./queries";
import {
  normalizeSnapshot,
  type RawComment,
  type RawConnection,
  type RawInitiative,
  type RawIssue,
  type RawMilestone,
  type RawProject,
  type RawRelation,
} from "./normalize";
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

  const snapshot = normalizeSnapshot({ initiative, projects, issues, initiativeId });
  if (options.write !== false) await writeSnapshotAtomic(snapshot);
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
