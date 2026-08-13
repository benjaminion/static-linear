import { describe, expect, it } from "vitest";
import { dependencyViewKey, filterDependencyView, type DependencyViewNode } from "../src/lib/dependency-view";

const nodes: DependencyViewNode[] = [
  { id: "isolated", projectId: "alpha", statusType: "unstarted" },
  { id: "active", projectId: "alpha", statusType: "started" },
  { id: "done", projectId: "alpha", statusType: "completed" },
  { id: "orphaned-by-done", projectId: "alpha", statusType: "started" },
  { id: "cross-project", projectId: "beta", statusType: "started" },
  { id: "beta-isolated", projectId: "beta", statusType: "unstarted" },
  { id: "boundary", projectId: null, statusType: null },
];
const edges = [
  { source: "active", target: "cross-project" },
  { source: "orphaned-by-done", target: "done" },
  { source: "boundary", target: "active" },
];

describe("filterDependencyView", () => {
  it("uses an unambiguous stable key for precomputed layouts", () => {
    expect(dependencyViewKey("dependent", "alpha:beta")).toBe('["dependent","alpha:beta"]');
  });

  it("shows every issue and referenced boundary in the all view", () => {
    const result = filterDependencyView(nodes, edges, "all");
    expect(result.nodes.map((node) => node.id)).toEqual(nodes.map((node) => node.id));
    expect(result.edges).toEqual(edges);
  });

  it("shows only relationship endpoints in the dependent view", () => {
    const result = filterDependencyView(nodes, edges, "dependent");
    expect(result.nodes.map((node) => node.id)).toEqual([
      "active", "done", "orphaned-by-done", "cross-project", "boundary",
    ]);
  });

  it("removes done endpoints and survivors left without a relationship in inflight", () => {
    const result = filterDependencyView(nodes, edges, "inflight");
    expect(result.nodes.map((node) => node.id)).toEqual(["active", "cross-project", "boundary"]);
    expect(result.edges).toEqual([
      { source: "active", target: "cross-project" },
      { source: "boundary", target: "active" },
    ]);
  });

  it("keeps all selected-project issues plus direct relationship context in all view", () => {
    const result = filterDependencyView(nodes, edges, "all", "alpha");
    expect(result.nodes.map((node) => node.id)).toEqual([
      "isolated", "active", "done", "orphaned-by-done", "cross-project", "boundary",
    ]);
    expect(result.nodes.map((node) => node.id)).not.toContain("beta-isolated");
  });

  it("preserves input node order", () => {
    expect(filterDependencyView(nodes, edges, "dependent").nodes.map((node) => node.id)).toEqual(
      nodes.filter((node) => !["isolated", "beta-isolated"].includes(node.id)).map((node) => node.id),
    );
  });
});
