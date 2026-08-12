import { describe, expect, it } from "vitest";
import { normalizeSnapshot, type RawIssue, type RawProject } from "../src/lib/linear/normalize";
import { dependencyCycles } from "../src/lib/view";

const pageInfo = { hasNextPage: false, endCursor: null };
const status = { name: "In Progress", type: "started", color: "#123456" };

function rawProject(): RawProject {
  return {
    id: "project-1", name: "Project", slugId: "project", url: "https://linear.app/acme/project/project",
    description: "Summary", content: "# Project", status, projectMilestones: { nodes: [], pageInfo },
  };
}

function rawIssue(id: string, identifier: string, parentId: string | null = null): RawIssue {
  return {
    id, identifier, title: identifier, url: `https://linear.app/acme/issue/${identifier}`,
    description: "Description", priority: 2, priorityLabel: "High", createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z", project: { id: "project-1" }, parent: parentId ? { id: parentId } : null,
    state: status, labels: { nodes: [], pageInfo }, comments: { nodes: [], pageInfo },
    relations: { nodes: [], pageInfo }, inverseRelations: { nodes: [], pageInfo },
  };
}

function normalize(issues: RawIssue[]) {
  return normalizeSnapshot({
    initiativeId: "initiative-1", generatedAt: "2026-01-03T00:00:00Z",
    initiative: { id: "initiative-1", name: "Initiative", url: "https://linear.app/acme/initiative/one", status: "Active" },
    projects: [rawProject()], issues,
  });
}

describe("normalizeSnapshot", () => {
  it("constructs child references from parent IDs", () => {
    const snapshot = normalize([rawIssue("one", "ACME-1"), rawIssue("two", "ACME-2", "one")]);
    expect(snapshot.issues.one.childIds).toEqual(["two"]);
    expect(snapshot.issues.two.parentId).toBe("one");
  });

  it("anonymizes issue relations that leave the initiative", () => {
    const issue = rawIssue("inside", "ACME-1");
    issue.inverseRelations.nodes.push({ id: "relation-1", type: "blocks", issue: { id: "secret-external-id" }, relatedIssue: { id: "inside" } });
    const serialized = JSON.stringify(normalize([issue]));
    expect(serialized).not.toContain("secret-external-id");
    expect(serialized).toContain("External dependency");
  });

  it("deduplicates relations returned on both endpoints", () => {
    const one = rawIssue("one", "ACME-1");
    const two = rawIssue("two", "ACME-2");
    const relation = { id: "relation-1", type: "blocks", issue: { id: "one" }, relatedIssue: { id: "two" } };
    one.relations.nodes.push(relation);
    two.inverseRelations.nodes.push(relation);
    expect(normalize([one, two]).relations).toHaveLength(1);
  });

  it("detects blocking cycles", () => {
    const one = rawIssue("one", "ACME-1");
    const two = rawIssue("two", "ACME-2");
    one.relations.nodes.push({ id: "r1", type: "blocks", issue: { id: "one" }, relatedIssue: { id: "two" } });
    two.relations.nodes.push({ id: "r2", type: "blocks", issue: { id: "two" }, relatedIssue: { id: "one" } });
    expect(dependencyCycles(normalize([one, two]))).toHaveLength(1);
  });

  it("renders the initiative body into descriptionHtml and strips starred links", () => {
    const snapshot = normalizeSnapshot({
      initiativeId: "initiative-1",
      generatedAt: "2026-01-03T00:00:00Z",
      initiative: {
        id: "initiative-1",
        name: "Initiative",
        url: "https://linear.app/acme/initiative/one",
        status: "Active",
        description: "Short summary",
        content: "Full about. See [private notes*](https://example.com/secret).",
      },
      projects: [rawProject()],
      issues: [rawIssue("one", "ACME-1")],
    });
    expect(snapshot.initiative.summary).toBe("Short summary");
    expect(snapshot.initiative.descriptionHtml).toContain("Full about.");
    expect(snapshot.initiative.descriptionHtml).toContain("private notes");
    expect(snapshot.initiative.descriptionHtml).not.toContain("private notes*");
    expect(snapshot.initiative.descriptionHtml).not.toContain("https://example.com/secret");
  });
});

