import type { PublicIssue, PublicProject, PublicSnapshot } from "./schema";

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

export function blockingRelations(snapshot: PublicSnapshot) {
  return snapshot.relations.filter((relation) => relation.type === "blocks");
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
