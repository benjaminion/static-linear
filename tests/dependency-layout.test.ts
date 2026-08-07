import { describe, expect, it } from "vitest";
import { layoutDependencyNodes, routeDependencyEdges } from "../src/lib/dependency-layout";

describe("routeDependencyEdges", () => {
  it("uses one smooth cubic segment per dependency", () => {
    const nodes = [{ id: "source", x: 0, y: 70 }, { id: "target", x: 200, y: 146 }];
    const [route] = routeDependencyEdges(nodes, [{ source: "source", target: "target" }]).routes;

    expect(route.segments).toHaveLength(1);
    expect(route.d.match(/ C /g)).toHaveLength(1);
  });

  it("gives overlapping dependencies distinct curved paths", () => {
    const nodes = [
      { id: "source", x: 0, y: 70 },
      { id: "middle", x: 50, y: 70 },
      { id: "target", x: 100, y: 70 },
    ];
    const routes = routeDependencyEdges(nodes, [
      { source: "source", target: "target" },
      { source: "middle", target: "target" },
    ]).routes;

    expect(routes).toHaveLength(2);
    expect(routes[0].d).not.toBe(routes[1].d);
    expect(routes.every((route) => route.d.includes(" C "))).toBe(true);
  });

  it("ends each route just outside its target node", () => {
    const nodes = [{ id: "source", x: 0, y: 70 }, { id: "target", x: 100, y: 70 }];
    const [route] = routeDependencyEdges(nodes, [{ source: "source", target: "target" }]).routes;
    const end = route.segments.at(-1)![3];
    const start = route.segments[0][0];

    expect(Math.hypot(end.x - 100, end.y - 70)).toBeCloseTo(29);
    expect(start.x).toBeGreaterThan(0);
    expect(end.x).toBeLessThan(100);
    expect(end.y).toBe(70);
  });

  it("aligns a diagonal route's final tangent with its target", () => {
    const nodes = [{ id: "source", x: 0, y: 0 }, { id: "target", x: 100, y: 100 }];
    const [route] = routeDependencyEdges(nodes, [{ source: "source", target: "target" }]).routes;
    const [, , control, end] = route.segments[0];
    const tangent = { x: end.x - control.x, y: end.y - control.y };
    const inward = { x: 100 - end.x, y: 100 - end.y };

    expect(tangent.x * inward.y - tangent.y * inward.x).toBeCloseTo(0);
    expect(tangent.x * inward.x + tangent.y * inward.y).toBeGreaterThan(0);
  });
});

describe("layoutDependencyNodes", () => {
  it("produces a deterministic, vertically compact layout", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const edges = [{ source: "a", target: "f" }, { source: "b", target: "e" }];

    const first = layoutDependencyNodes(ids, edges);
    const second = layoutDependencyNodes(ids, edges);
    expect(second).toEqual(first);
    expect(Math.max(...first.nodes.map(({ y }) => y)) - Math.min(...first.nodes.map(({ y }) => y))).toBeLessThanOrEqual(76);
  });
});
