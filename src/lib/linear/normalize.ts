import { createHash } from "node:crypto";
import { PRIORITY_LABELS, SCHEMA_VERSION } from "../constants";
import { renderPublicMarkdown } from "../markdown";
import { publicSnapshotSchema, type PublicSnapshot } from "../schema";

export interface RawConnection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface RawPerson { id: string; name: string }
interface RawStatus { name: string; type: string; color?: string | null }
interface RawStatusUpdate { id: string; body: string; createdAt: string; health: string; user: RawPerson }
export interface RawMilestone { id: string; name: string; description?: string | null; targetDate?: string | null }
export interface RawProject {
  id: string; name: string; slugId: string; url: string;
  description?: string | null; content?: string | null; health?: string | null;
  startDate?: string | null; targetDate?: string | null;
  completedAt?: string | null; canceledAt?: string | null;
  lead?: RawPerson | null; status: RawStatus;
  lastUpdate?: RawStatusUpdate | null;
  projectMilestones: RawConnection<RawMilestone>;
}
export interface RawComment {
  id: string; body: string; createdAt: string; updatedAt: string; user?: RawPerson | null;
}
export interface RawRelation {
  id: string; type: string; issue: { id: string }; relatedIssue: { id: string };
}
export interface RawIssue {
  id: string; identifier: string; title: string; url: string; description?: string | null;
  priority: number; priorityLabel?: string | null; estimate?: number | null;
  dueDate?: string | null; createdAt: string; updatedAt: string;
  completedAt?: string | null; canceledAt?: string | null; archivedAt?: string | null;
  project: { id: string }; parent?: { id: string } | null; state: RawStatus;
  assignee?: RawPerson | null;
  labels: RawConnection<{ id: string; name: string; color?: string | null }>;
  comments: RawConnection<RawComment>;
  relations: RawConnection<RawRelation>;
  inverseRelations: RawConnection<RawRelation>;
}
export interface RawInitiative {
  id: string; name: string; url: string; description?: string | null; content?: string | null;
  status: string; health?: string | null;
  targetDate?: string | null; organization?: { urlKey: string } | null;
  lastUpdate?: RawStatusUpdate | null;
}

export function normalizeSnapshot(input: {
  initiative: RawInitiative;
  projects: RawProject[];
  issues: RawIssue[];
  initiativeId: string;
  generatedAt?: string;
}): PublicSnapshot {
  const publicIssues = input.issues.filter((issue) => !issue.archivedAt);
  const includedIssueIds = new Set(publicIssues.map((issue) => issue.id));
  const boundaries: PublicSnapshot["boundaries"] = {};
  const relationsById = new Map<string, PublicSnapshot["relations"][number]>();

  for (const issue of publicIssues) {
    for (const relation of [...issue.relations.nodes, ...issue.inverseRelations.nodes]) {
      if (relationsById.has(relation.id)) continue;
      const sourceId = publicEndpoint(relation.issue.id, includedIssueIds, boundaries);
      const targetId = publicEndpoint(relation.relatedIssue.id, includedIssueIds, boundaries);
      if (!includedIssueIds.has(relation.issue.id) && !includedIssueIds.has(relation.relatedIssue.id)) continue;
      relationsById.set(relation.id, {
        id: relation.id,
        type: normalizeRelationType(relation.type),
        sourceId,
        targetId,
        boundaryId: sourceId.startsWith("boundary:")
          ? sourceId
          : targetId.startsWith("boundary:") ? targetId : null,
      });
    }
  }

  const issues: PublicSnapshot["issues"] = {};
  for (const issue of publicIssues) {
    issues[issue.id] = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      projectId: issue.project.id,
      parentId: issue.parent && includedIssueIds.has(issue.parent.id) ? issue.parent.id : null,
      childIds: [],
      descriptionHtml: renderPublicMarkdown(issue.description),
      state: normalizeStatus(issue.state),
      priority: Math.trunc(issue.priority),
      priorityLabel: issue.priorityLabel || PRIORITY_LABELS[issue.priority] || "Unknown",
      estimate: issue.estimate ?? null,
      assignee: normalizePerson(issue.assignee),
      labels: issue.labels.nodes.map((label) => ({ ...label, color: label.color ?? null })),
      dueDate: issue.dueDate ?? null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      completedAt: issue.completedAt ?? null,
      canceledAt: issue.canceledAt ?? null,
      archivedAt: issue.archivedAt ?? null,
      comments: issue.comments.nodes.map((comment) => ({
        id: comment.id,
        bodyHtml: renderPublicMarkdown(comment.body),
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        user: normalizePerson(comment.user),
      })),
    };
  }

  for (const issue of Object.values(issues)) {
    if (issue.parentId && issues[issue.parentId]) issues[issue.parentId].childIds.push(issue.id);
  }

  const projects: PublicSnapshot["projects"] = {};
  for (const project of input.projects) {
    projects[project.id] = {
      id: project.id,
      name: project.name,
      slugId: project.slugId,
      url: project.url,
      summary: project.description ?? "",
      descriptionHtml: renderPublicMarkdown(project.content || project.description),
      status: normalizeStatus(project.status),
      health: project.health ?? null,
      startDate: project.startDate ?? null,
      targetDate: project.targetDate ?? null,
      completedAt: project.completedAt ?? null,
      canceledAt: project.canceledAt ?? null,
      lead: normalizePerson(project.lead),
      issueIds: publicIssues.filter((issue) => issue.project.id === project.id).map((issue) => issue.id),
      milestones: project.projectMilestones.nodes.map((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        descriptionHtml: renderPublicMarkdown(milestone.description),
        targetDate: milestone.targetDate ?? null,
      })),
      latestUpdate: normalizeStatusUpdate(project.lastUpdate),
    };
  }

  const snapshot: PublicSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: {
      initiativeId: input.initiativeId,
      workspaceUrl: input.initiative.organization?.urlKey
        ? `https://linear.app/${input.initiative.organization.urlKey}`
        : null,
    },
    initiative: {
      id: input.initiative.id,
      name: input.initiative.name,
      url: input.initiative.url,
      summary: input.initiative.description ?? "",
      // Same pipeline as other Linear Markdown: sanitize + strip links whose text ends in `*`.
      descriptionHtml: renderPublicMarkdown(input.initiative.content || input.initiative.description),
      status: input.initiative.status,
      health: input.initiative.health ?? null,
      targetDate: input.initiative.targetDate ?? null,
      projectIds: input.projects.map((project) => project.id),
      latestUpdate: normalizeStatusUpdate(input.initiative.lastUpdate),
    },
    projects,
    issues,
    relations: [...relationsById.values()],
    boundaries,
  };

  assertIntegrity(snapshot);
  return publicSnapshotSchema.parse(snapshot);
}

function normalizePerson(person: RawPerson | null | undefined) {
  return person ? { id: person.id, name: person.name } : null;
}

function normalizeStatus(status: RawStatus) {
  return { name: status.name, type: status.type, color: status.color ?? null };
}

function normalizeStatusUpdate(update: RawStatusUpdate | null | undefined) {
  return update ? {
    id: update.id,
    bodyHtml: renderPublicMarkdown(update.body),
    createdAt: update.createdAt,
    health: update.health,
    user: { id: update.user.id, name: update.user.name },
  } : null;
}

function normalizeRelationType(type: string): "blocks" | "related" | "duplicate" {
  return type === "blocks" || type === "duplicate" ? type : "related";
}

function publicEndpoint(
  id: string,
  includedIds: Set<string>,
  boundaries: PublicSnapshot["boundaries"],
): string {
  if (includedIds.has(id)) return id;
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 12);
  const publicId = `boundary:${digest}`;
  boundaries[publicId] = { id: publicId, label: "External dependency" };
  return publicId;
}

export function assertIntegrity(snapshot: PublicSnapshot): void {
  for (const projectId of snapshot.initiative.projectIds) {
    if (!snapshot.projects[projectId]) throw new Error(`Initiative references missing project ${projectId}.`);
  }
  for (const issue of Object.values(snapshot.issues)) {
    if (!snapshot.projects[issue.projectId]) throw new Error(`Issue ${issue.identifier} has an unknown project.`);
    if (issue.parentId && !snapshot.issues[issue.parentId]) throw new Error(`Issue ${issue.identifier} has an unknown parent.`);
  }
  for (const relation of snapshot.relations) {
    for (const endpoint of [relation.sourceId, relation.targetId]) {
      if (!snapshot.issues[endpoint] && !snapshot.boundaries[endpoint]) {
        throw new Error(`Relation ${relation.id} has an unknown endpoint.`);
      }
    }
  }
}
