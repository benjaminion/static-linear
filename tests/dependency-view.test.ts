import { describe, expect, it } from "vitest";
import {
  dependencyEdgeCrossesProject,
  dependencyEdgeTouchesProject,
  dependencyNodeMatchesProject,
  dependencyViewKey,
  filterDependencyView,
  type DependencyViewNode,
} from "../src/lib/dependency-view";

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
  it("keys the three precomputed layouts by issue mode", () => {
    expect(dependencyViewKey("dependent")).toBe("dependent");
  });

  it("treats only selected-project issues as active when focusing a project", () => {
    expect(dependencyNodeMatchesProject(nodes[1], "alpha")).toBe(true);
    expect(dependencyNodeMatchesProject(nodes[4], "alpha")).toBe(false);
    expect(dependencyNodeMatchesProject(nodes[6], "alpha")).toBe(false);
    expect(nodes.every((node) => dependencyNodeMatchesProject(node))).toBe(true);
  });

  it("keeps only internal and boundary-crossing project edges undimmed", () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(dependencyEdgeTouchesProject({ source: "active", target: "done" }, byId, "alpha")).toBe(true);
    expect(dependencyEdgeTouchesProject({ source: "active", target: "cross-project" }, byId, "alpha")).toBe(true);
    expect(dependencyEdgeTouchesProject({ source: "boundary", target: "active" }, byId, "alpha")).toBe(true);
    expect(dependencyEdgeTouchesProject({ source: "cross-project", target: "boundary" }, byId, "alpha")).toBe(false);
    expect(edges.every((edge) => dependencyEdgeTouchesProject(edge, byId))).toBe(true);
  });

  it("identifies edges with exactly one selected-project endpoint", () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(dependencyEdgeCrossesProject({ source: "active", target: "done" }, byId, "alpha")).toBe(false);
    expect(dependencyEdgeCrossesProject({ source: "active", target: "cross-project" }, byId, "alpha")).toBe(true);
    expect(dependencyEdgeCrossesProject({ source: "boundary", target: "active" }, byId, "alpha")).toBe(true);
    expect(dependencyEdgeCrossesProject({ source: "cross-project", target: "boundary" }, byId, "alpha")).toBe(false);
    expect(edges.some((edge) => dependencyEdgeCrossesProject(edge, byId))).toBe(false);
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
