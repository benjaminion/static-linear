import { describe, expect, it } from "vitest";
import {
  compareDependencyIssues,
  compareNullableDates,
  compareProjects,
  dependencyIssueDate,
  issueOwner,
  projectOwner,
  serializeForScript,
} from "../src/lib/view";
import type { PublicIssue, PublicProject, PublicSnapshot } from "../src/lib/schema";

function project(name: string): PublicProject {
  return { name, id: name } as PublicProject;
}

describe("compareProjects", () => {
  it("sorts project names alphabetically with numeric prefixes in numeric order", () => {
    const projects = [project("10 Launch"), project("Beta"), project("2 Build"), project("Alpha")];

    expect(projects.sort(compareProjects).map(({ name }) => name)).toEqual([
      "2 Build",
      "10 Launch",
      "Alpha",
      "Beta",
    ]);
  });
});

describe("dependency issue ordering", () => {
  const snapshot = {
    projects: {
      alpha: { targetDate: "2026-08-20" },
      beta: { targetDate: null },
    },
    issues: {
      explicit: { identifier: "ISS-3", projectId: "alpha", dueDate: "2026-08-10" },
      fallback: { identifier: "ISS-2", projectId: "alpha", dueDate: null },
      undated: { identifier: "ISS-1", projectId: "beta", dueDate: null },
    },
    boundaries: {},
  } as unknown as PublicSnapshot;

  it("uses the project target when an issue has no due date", () => {
    expect(dependencyIssueDate("explicit", snapshot)).toBe("2026-08-10");
    expect(dependencyIssueDate("fallback", snapshot)).toBe("2026-08-20");
  });

  it("sorts dated issues chronologically and puts fully undated issues last", () => {
    expect(["undated", "fallback", "explicit"].sort((a, b) => compareDependencyIssues(a, b, snapshot))).toEqual([
      "explicit",
      "fallback",
      "undated",
    ]);
  });
});

describe("serializeForScript", () => {
  it("cannot terminate its containing script element", () => {
    const serialized = serializeForScript({ title: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized).title).toBe("</script><script>alert(1)</script>");
  });
});

describe("work ownership", () => {
  it("prefers Linear project leads and issue assignees", () => {
    expect(projectOwner({
      lead: { id: "ada", name: "Ada Lovelace" },
      summary: "Owner: Someone else",
      descriptionHtml: "",
    } as PublicProject)).toMatchObject({ name: "Ada Lovelace", source: "linear" });
    expect(issueOwner({
      assignee: { id: "grace", name: "Grace Hopper" },
      descriptionHtml: "<p>Lead: Someone else</p>",
    } as PublicIssue)).toMatchObject({ name: "Grace Hopper", source: "linear" });
  });

  it("reads line-based owner markers from sanitized descriptions", () => {
    expect(projectOwner({
      lead: null,
      summary: "Delivery stream\nOwner: Lin Chen",
      descriptionHtml: "",
    } as PublicProject)).toMatchObject({ name: "Lin Chen", source: "description" });
    expect(issueOwner({
      assignee: null,
      descriptionHtml: "<p>Context</p><p><strong>Lead:</strong> Sam Taylor</p>",
    } as PublicIssue)).toMatchObject({ name: "Sam Taylor", source: "description" });
    expect(projectOwner({
      lead: null,
      summary: "A short summary without an owner",
      descriptionHtml: "<p><strong>Lead:</strong> Priya Shah</p>",
    } as PublicProject)).toMatchObject({ name: "Priya Shah", source: "description" });
  });

  it("does not treat inline prose as an ownership marker", () => {
    expect(issueOwner({
      assignee: null,
      descriptionHtml: "<p>Ask the Owner: team before publishing.</p>",
    } as PublicIssue)).toEqual({ key: "unassigned", name: "Unassigned", source: "unassigned" });
  });

  it("sorts dates chronologically with unset dates last", () => {
    const dates = [null, "2026-09-01", "2026-08-01"];
    expect(dates.sort(compareNullableDates)).toEqual(["2026-08-01", "2026-09-01", null]);
  });
});
