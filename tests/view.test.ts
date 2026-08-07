import { describe, expect, it } from "vitest";
import { compareProjects, serializeForScript } from "../src/lib/view";
import type { PublicProject } from "../src/lib/schema";

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

describe("serializeForScript", () => {
  it("cannot terminate its containing script element", () => {
    const serialized = serializeForScript({ title: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized).title).toBe("</script><script>alert(1)</script>");
  });
});
