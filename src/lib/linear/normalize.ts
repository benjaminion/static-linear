import { createHash } from "node:crypto";
import { PRIORITY_LABELS, SCHEMA_VERSION } from "../constants";
import { renderPublicMarkdown } from "../markdown";
import { publicSnapshotSchema, type PublicSnapshot } from "../schema";
import { linearDocumentIdentifierFromUrl, linearDocumentSlugId } from "./document-export";

export interface RawConnection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface RawPerson { id: string; name: string }
interface RawStatus { name: string; type: string; color?: string | null }
interface RawStatusUpdate { id: string; body: string; createdAt: string; health: string; user: RawPerson }
export interface RawMilestone { id: string; name: string; description?: string | null; targetDate?: string | null }
export interface RawDocument {
  id: string; title: string; content: string | null; slugId: string; url: string;
  archivedAt?: string | null; updatedAt: string; sortOrder: number;
}
export interface RawExternalResource {
  id: string; label: string; url: string; archivedAt?: string | null; sortOrder: number;
  document?: RawDocument | null;
}
export interface RawProject {
  id: string; name: string; slugId: string; url: string;
  description?: string | null; content?: string | null; health?: string | null;
  startDate?: string | null; targetDate?: string | null;
  completedAt?: string | null; canceledAt?: string | null;
  lead?: RawPerson | null; status: RawStatus;
  lastUpdate?: RawStatusUpdate | null;
  projectMilestones: RawConnection<RawMilestone>;
  documents?: RawConnection<RawDocument>;
  externalLinks?: RawConnection<RawExternalResource>;
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
  documents?: RawConnection<RawDocument>;
  links?: RawConnection<RawExternalResource>;
}

export function normalizeSnapshot(input: {
  initiative: RawInitiative;
  projects: RawProject[];
  issues: RawIssue[];
  initiativeId: string;
  generatedAt?: string;
}): PublicSnapshot {
  const publicIssues = input.issues.filter((issue) => !issue.archivedAt);
  const rawDocuments = new Map<string, RawDocument>();
  const documentParentRefs = new Map<string, Map<string, { type: "initiative" | "project"; id: string }>>();
  const initiativeResources = normalizeResources(
    input.initiative.documents?.nodes ?? [],
    input.initiative.links?.nodes ?? [],
    { type: "initiative", id: input.initiative.id },
    rawDocuments,
    documentParentRefs,
  );
  const projectResources = new Map<string, PublicSnapshot["projects"][string]["resources"]>();
  for (const project of input.projects) {
    projectResources.set(project.id, normalizeResources(
      project.documents?.nodes ?? [],
      project.externalLinks?.nodes ?? [],
      { type: "project", id: project.id },
      rawDocuments,
      documentParentRefs,
    ));
  }
  const documentIdsBySlug = new Map(
    [...rawDocuments.values()].map((document) => [document.slugId.toLowerCase(), document.id]),
  );
  const markdownOptions = {
    rewriteHref: (href: string) => rewriteDocumentHref(href, documentIdsBySlug),
  };
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
      descriptionHtml: renderPublicMarkdown(issue.description, markdownOptions),
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
        bodyHtml: renderPublicMarkdown(comment.body, markdownOptions),
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
      descriptionHtml: renderPublicMarkdown(project.content || project.description, markdownOptions),
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
        descriptionHtml: renderPublicMarkdown(milestone.description, markdownOptions),
        targetDate: milestone.targetDate ?? null,
      })),
      latestUpdate: normalizeStatusUpdate(project.lastUpdate, markdownOptions),
      resources: projectResources.get(project.id) ?? [],
    };
  }

  const documents: PublicSnapshot["documents"] = {};
  for (const document of rawDocuments.values()) {
    documents[document.id] = {
      id: document.id,
      slugId: document.slugId,
      title: document.title,
      url: document.url,
      contentHtml: renderPublicMarkdown(document.content, markdownOptions),
      updatedAt: document.updatedAt,
      parentRefs: [...(documentParentRefs.get(document.id)?.values() ?? [])],
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
      descriptionHtml: renderPublicMarkdown(input.initiative.content || input.initiative.description, markdownOptions),
      status: input.initiative.status,
      health: input.initiative.health ?? null,
      targetDate: input.initiative.targetDate ?? null,
      projectIds: input.projects.map((project) => project.id),
      latestUpdate: normalizeStatusUpdate(input.initiative.lastUpdate, markdownOptions),
      resources: initiativeResources,
    },
    projects,
    issues,
    documents,
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

function normalizeStatusUpdate(
  update: RawStatusUpdate | null | undefined,
  markdownOptions: Parameters<typeof renderPublicMarkdown>[1],
) {
  return update ? {
    id: update.id,
    bodyHtml: renderPublicMarkdown(update.body, markdownOptions),
    createdAt: update.createdAt,
    health: update.health,
    user: { id: update.user.id, name: update.user.name },
  } : null;
}

function normalizeRelationType(type: string): "blocks" | "related" | "duplicate" {
  return type === "blocks" || type === "duplicate" ? type : "related";
}

function normalizeResources(
  documents: RawDocument[],
  externalResources: RawExternalResource[],
  parent: { type: "initiative" | "project"; id: string },
  documentsById: Map<string, RawDocument>,
  parentRefsByDocument: Map<string, Map<string, { type: "initiative" | "project"; id: string }>>,
): PublicSnapshot["initiative"]["resources"] {
  const candidates: Array<PublicSnapshot["initiative"]["resources"][number]> = [];

  for (const document of documents) {
    if (document.archivedAt) continue;
    registerDocument(document, parent, documentsById, parentRefsByDocument);
    candidates.push({ type: "document", documentId: document.id, sortOrder: document.sortOrder });
  }
  for (const resource of externalResources) {
    if (resource.archivedAt) continue;
    if (resource.document) {
      if (resource.document.archivedAt) continue;
      registerDocument(resource.document, parent, documentsById, parentRefsByDocument);
      candidates.push({ type: "document", documentId: resource.document.id, sortOrder: resource.sortOrder });
    } else {
      candidates.push({
        type: "external",
        id: resource.id,
        label: resource.label,
        url: resource.url,
        sortOrder: resource.sortOrder,
      });
    }
  }

  candidates.sort((a, b) => a.sortOrder - b.sortOrder || resourceKey(a).localeCompare(resourceKey(b)));
  const seen = new Set<string>();
  return candidates.filter((resource) => {
    const key = resourceKey(resource);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function registerDocument(
  document: RawDocument,
  parent: { type: "initiative" | "project"; id: string },
  documentsById: Map<string, RawDocument>,
  parentRefsByDocument: Map<string, Map<string, { type: "initiative" | "project"; id: string }>>,
): void {
  documentsById.set(document.id, document);
  const refs = parentRefsByDocument.get(document.id) ?? new Map();
  refs.set(`${parent.type}:${parent.id}`, parent);
  parentRefsByDocument.set(document.id, refs);
}

function resourceKey(resource: PublicSnapshot["initiative"]["resources"][number]): string {
  return resource.type === "document" ? `document:${resource.documentId}` : `external:${resource.id}`;
}

function rewriteDocumentHref(href: string, documentIdsBySlug: Map<string, string>): string {
  const identifier = linearDocumentIdentifierFromUrl(href);
  const slugId = identifier ? linearDocumentSlugId(identifier) : null;
  const documentId = slugId ? documentIdsBySlug.get(slugId) : null;
  if (!documentId) return href;
  const hash = new URL(href).hash;
  return `/documents/${encodeURIComponent(documentId)}/${hash}`;
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
  for (const [parentLabel, resources] of [
    ["initiative", snapshot.initiative.resources],
    ...Object.values(snapshot.projects).map((project) => [`project ${project.id}`, project.resources] as const),
  ] as const) {
    for (const resource of resources) {
      if (resource.type === "document" && !snapshot.documents[resource.documentId]) {
        throw new Error(`${parentLabel} references missing document ${resource.documentId}.`);
      }
    }
  }
  for (const document of Object.values(snapshot.documents)) {
    for (const parent of document.parentRefs) {
      if (parent.type === "initiative" && parent.id !== snapshot.initiative.id) {
        throw new Error(`Document ${document.id} references unknown initiative ${parent.id}.`);
      }
      if (parent.type === "project" && !snapshot.projects[parent.id]) {
        throw new Error(`Document ${document.id} references unknown project ${parent.id}.`);
      }
    }
  }
  for (const relation of snapshot.relations) {
    for (const endpoint of [relation.sourceId, relation.targetId]) {
      if (!snapshot.issues[endpoint] && !snapshot.boundaries[endpoint]) {
        throw new Error(`Relation ${relation.id} has an unknown endpoint.`);
      }
    }
  }
}
