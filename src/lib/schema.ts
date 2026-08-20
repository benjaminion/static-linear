import { z } from "zod";

const nullableDate = z.string().nullable();
const personSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const statusSchema = z.object({
  name: z.string(),
  type: z.string(),
  color: z.string().nullable(),
});

const statusUpdateSchema = z.object({
  id: z.string(),
  bodyHtml: z.string(),
  createdAt: z.string(),
  health: z.string(),
  user: personSchema,
});

export const commentSchema = z.object({
  id: z.string(),
  bodyHtml: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  user: personSchema.nullable(),
});

const documentResourceSchema = z.object({
  type: z.literal("document"),
  documentId: z.string(),
  sortOrder: z.number(),
});

const externalResourceSchema = z.object({
  type: z.literal("external"),
  id: z.string(),
  label: z.string(),
  url: z.string().url(),
  sortOrder: z.number(),
});

export const resourceSchema = z.discriminatedUnion("type", [documentResourceSchema, externalResourceSchema]);

export const documentSchema = z.object({
  id: z.string(),
  slugId: z.string(),
  title: z.string(),
  url: z.string().url(),
  contentHtml: z.string(),
  updatedAt: z.string(),
  parentRefs: z.array(z.object({
    type: z.enum(["initiative", "project"]),
    id: z.string(),
  })),
});

export const issueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string().url(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()),
  descriptionHtml: z.string(),
  state: statusSchema,
  priority: z.number().int(),
  priorityLabel: z.string(),
  estimate: z.number().nullable(),
  assignee: personSchema.nullable(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })),
  dueDate: nullableDate,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  comments: z.array(commentSchema),
});

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slugId: z.string(),
  url: z.string().url(),
  summary: z.string(),
  descriptionHtml: z.string(),
  status: statusSchema,
  health: z.string().nullable(),
  startDate: nullableDate,
  targetDate: nullableDate,
  completedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  lead: personSchema.nullable(),
  issueIds: z.array(z.string()),
  milestones: z.array(z.object({
    id: z.string(),
    name: z.string(),
    descriptionHtml: z.string(),
    targetDate: nullableDate,
  })),
  latestUpdate: statusUpdateSchema.nullable(),
  resources: z.array(resourceSchema),
});

export const relationSchema = z.object({
  id: z.string(),
  type: z.enum(["blocks", "related", "duplicate"]),
  sourceId: z.string(),
  targetId: z.string(),
  boundaryId: z.string().nullable(),
});

export const publicSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  generatedAt: z.string(),
  source: z.object({
    initiativeId: z.string(),
    workspaceUrl: z.string().url().nullable(),
  }),
  initiative: z.object({
    id: z.string(),
    name: z.string(),
    url: z.string().url(),
    summary: z.string(),
    descriptionHtml: z.string(),
    status: z.string(),
    health: z.string().nullable(),
    targetDate: nullableDate,
    projectIds: z.array(z.string()),
    latestUpdate: statusUpdateSchema.nullable(),
    resources: z.array(resourceSchema),
  }),
  projects: z.record(z.string(), projectSchema),
  issues: z.record(z.string(), issueSchema),
  documents: z.record(z.string(), documentSchema),
  relations: z.array(relationSchema),
  boundaries: z.record(z.string(), z.object({
    id: z.string(),
    label: z.literal("External dependency"),
  })),
});

export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>;
export type PublicProject = z.infer<typeof projectSchema>;
export type PublicIssue = z.infer<typeof issueSchema>;
export type PublicDocument = z.infer<typeof documentSchema>;
export type PublicResource = z.infer<typeof resourceSchema>;
export type PublicRelation = z.infer<typeof relationSchema>;
