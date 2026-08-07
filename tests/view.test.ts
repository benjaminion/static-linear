import { describe, expect, it } from "vitest";
import { compareDependencyIssues, compareProjects, dependencyIssueDate, serializeForScript } from "../src/lib/view";
import type { PublicProject, PublicSnapshot } from "../src/lib/schema";

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
