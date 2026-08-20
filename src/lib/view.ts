import type { PublicDocument, PublicIssue, PublicProject, PublicSnapshot } from "./schema";

const projectNameCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export interface WorkOwner {
  key: string;
  name: string;
  source: "linear" | "description" | "unassigned";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function issueHref(issue: Pick<PublicIssue, "id">): string {
  return `/issues/${encodeURIComponent(issue.id)}/`;
}

export function projectHref(project: Pick<PublicProject, "id">): string {
  return `/projects/${encodeURIComponent(project.id)}/`;
}

export function documentHref(document: Pick<PublicDocument, "id">): string {
  return `/documents/${encodeURIComponent(document.id)}/`;
}

export function compareProjects(a: PublicProject, b: PublicProject): number {
  return projectNameCollator.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

export function initiativeProjects(snapshot: PublicSnapshot): PublicProject[] {
  return snapshot.initiative.projectIds
    .map((id) => snapshot.projects[id])
    .filter((project): project is PublicProject => Boolean(project))
    .sort(compareProjects);
}

export function statusClass(type: string): string {
  return `status status--${type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function issueRoots(project: PublicProject, snapshot: PublicSnapshot): PublicIssue[] {
  const ids = new Set(project.issueIds);
  return project.issueIds
    .map((id) => snapshot.issues[id])
    .filter((issue) => issue && (!issue.parentId || !ids.has(issue.parentId)))
    .sort(compareIssues);
}

export function compareIssues(a: PublicIssue, b: PublicIssue): number {
  return a.priority - b.priority || a.identifier.localeCompare(b.identifier);
}

export function compareIssuesByDueDate(a: PublicIssue, b: PublicIssue): number {
  return compareNullableDates(a.dueDate, b.dueDate) || compareIssues(a, b);
}

export function projectOwner(project: PublicProject): WorkOwner {
  if (project.lead) return namedOwner(project.lead.name, "linear");
  const summaryOwner = descriptionOwner(project.summary);
  return summaryOwner.source === "description"
    ? summaryOwner
    : descriptionOwner(project.descriptionHtml);
}

export function issueOwner(issue: PublicIssue): WorkOwner {
  if (issue.assignee) return namedOwner(issue.assignee.name, "linear");
  return descriptionOwner(issue.descriptionHtml);
}

export function compareNullableDates(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function descriptionOwner(value: string): WorkOwner {
  const text = htmlToText(value);
  const match = text.match(
    /(?:^|\n)\s*(?:[-+*]\s+)?(?:#{1,6}\s+)?(?:\*\*|__)?(?:lead|owner)(?:\*\*|__)?\s*:\s*([^\n]+)/i,
  );
  const name = match?.[1]
    ?.replace(/^\s*(?:\*\*|__)/, "")
    .replace(/(?:\*\*|__)\s*$/, "")
    .trim();
  return name && name.length <= 120
    ? namedOwner(name, "description")
    : { key: "unassigned", name: "Unassigned", source: "unassigned" };
}

function namedOwner(name: string, source: WorkOwner["source"]): WorkOwner {
  return {
    key: `owner:${name.trim().toLocaleLowerCase("en")}`,
    name: name.trim(),
    source,
  };
}

function htmlToText(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'");
}

export function blockingRelations(snapshot: PublicSnapshot) {
  return snapshot.relations.filter((relation) => relation.type === "blocks");
}

export function dependencyIssueDate(issueId: string, snapshot: PublicSnapshot): string | null {
  const issue = snapshot.issues[issueId];
  if (!issue) return null;
  return issue.dueDate ?? snapshot.projects[issue.projectId]?.targetDate ?? null;
}

export function compareDependencyIssues(aId: string, bId: string, snapshot: PublicSnapshot): number {
  const aDate = dependencyIssueDate(aId, snapshot);
  const bDate = dependencyIssueDate(bId, snapshot);
  if (aDate !== bDate) {
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate.localeCompare(bDate);
  }
  const aLabel = snapshot.issues[aId]?.identifier ?? snapshot.boundaries[aId]?.label ?? aId;
  const bLabel = snapshot.issues[bId]?.identifier ?? snapshot.boundaries[bId]?.label ?? bId;
  return aLabel.localeCompare(bLabel, "en", { numeric: true, sensitivity: "base" });
}

export function dependencyCycles(snapshot: PublicSnapshot): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const issueId of Object.keys(snapshot.issues)) adjacency.set(issueId, []);
  for (const relation of blockingRelations(snapshot)) {
    if (snapshot.issues[relation.sourceId] && snapshot.issues[relation.targetId]) {
      adjacency.get(relation.sourceId)?.push(relation.targetId);
    }
  }

  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  function visit(id: string) {
    state.set(id, 1);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      if ((state.get(next) ?? 0) === 0) visit(next);
      else if (state.get(next) === 1) {
        const start = stack.indexOf(next);
        const cycle = [...stack.slice(start), next];
        const signature = [...new Set(cycle)].sort().join(":");
        if (!cycles.some((existing) => [...new Set(existing)].sort().join(":") === signature)) {
          cycles.push(cycle);
        }
      }
    }
    stack.pop();
    state.set(id, 2);
  }
  for (const id of adjacency.keys()) if ((state.get(id) ?? 0) === 0) visit(id);
  return cycles;
}
