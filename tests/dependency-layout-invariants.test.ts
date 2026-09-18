import { describe, expect, it } from "vitest";
import { countRouteCrossings, cubicPoint, layoutDependencyGraph, type DependencyGraphLayout, type RoutedDependencyEdge } from "../src/lib/dependency-layout";
import { filterDependencyView } from "../src/lib/dependency-view";
import fixture from "./fixtures/dependency-views.json";

function expectRadialMonotoneRoutes(layout: DependencyGraphLayout) {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const route of layout.routes) {
    const source = nodes.get(route.source)!, target = nodes.get(route.target)!;
    const direction = Math.sign(target.x - source.x);
    const start = route.segments[0][0], firstControl = route.segments[0][1];
    const last = route.segments.at(-1)!, end = last[3], lastControl = last[2];
    expect(Math.hypot(start.x - source.x, start.y - source.y)).toBeCloseTo(29, 6);
    expect(Math.hypot(end.x - target.x, end.y - target.y)).toBeCloseTo(29, 6);
    for (const [radial, tangent] of [
      [{ x: start.x - source.x, y: start.y - source.y }, { x: firstControl.x - start.x, y: firstControl.y - start.y }],
      [{ x: target.x - end.x, y: target.y - end.y }, { x: end.x - lastControl.x, y: end.y - lastControl.y }],
    ]) {
      expect(radial.x * tangent.y - radial.y * tangent.x).toBeCloseTo(0, 6);
      expect(radial.x * tangent.x + radial.y * tangent.y).toBeGreaterThan(0);
    }
    if (direction) for (const segment of route.segments) for (let i = 1; i < segment.length; i++) {
      // Ordered Bézier control points imply an everywhere-monotone derivative,
      // including the arrowhead, not just correctly ordered task centers.
      expect((segment[i].x - segment[i - 1].x) * direction).toBeGreaterThanOrEqual(-1e-8);
    }
    let clearance = Infinity, inBounds = true;
    for (const segment of route.segments) for (let t = 0; t <= 80; t++) {
      const p = cubicPoint(segment, t / 80);
      for (const n of layout.nodes) if (n.id !== route.source && n.id !== route.target) {
        clearance = Math.min(clearance, Math.hypot(p.x - n.x, p.y - n.y));
      }
      inBounds &&= p.y >= layout.minY && p.y <= layout.maxY && p.x >= 0 && p.x <= layout.width;
    }
    expect(clearance).toBeGreaterThanOrEqual(36);
    expect(inBounds).toBe(true);
  }
}

// Independent sampling in screen space catches coincident *curves*, rather than
// merely matching horizontal control points or ignoring routes sharing a task.
function sampleByX(route: RoutedDependencyEdge) {
  const values = new Map<number, { y: number; slope: number }>();
  for (const segment of route.segments) {
    if (segment[0].x >= segment[3].x) continue;
    for (let x = Math.ceil(segment[0].x / 2) * 2; x <= segment[3].x; x += 2) {
      let low = 0, high = 1;
      for (let i = 0; i < 22; i++) {
        const middle = (low + high) / 2;
        if (cubicPoint(segment, middle).x < x) low = middle; else high = middle;
      }
      const t = (low + high) / 2, p = cubicPoint(segment, t);
      const before = cubicPoint(segment, Math.max(0, t - .0001));
      const after = cubicPoint(segment, Math.min(1, t + .0001));
      values.set(x, { y: p.y, slope: Math.atan2(after.y - before.y, after.x - before.x) });
    }
  }
  return values;
}

function expectNoCoincidentCurves(routes: RoutedDependencyEdge[]) {
  const paths = routes.map(sampleByX);
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    let run = 0, longest = 0;
    for (const [x, a] of paths[i]) {
      const b = paths[j].get(x);
      run = b && Math.abs(a.y - b.y) < 2 && Math.abs(a.slope - b.slope) < .08 ? run + 2 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest, `Coincident routes ${routes[i].source}→${routes[i].target} and ${routes[j].source}→${routes[j].target}`).toBeLessThanOrEqual(12);
  }
}

describe("calendar layout invariants", () => {
  it("generates the three representative task modes within the build budget", () => {
    const start = performance.now();
    const layouts = (["all", "dependent", "inflight"] as const).map((mode) => {
      const view = filterDependencyView(fixture.nodes, fixture.edges, mode);
      return { view, layout: layoutDependencyGraph(view.nodes, view.edges) };
    });
    expect(performance.now() - start).toBeLessThan(30_000);
    for (const { view, layout } of layouts) {
      expect(layout.nodes).toHaveLength(view.nodes.length);
      expect(layout.routes).toHaveLength(view.edges.length);
      const positions = new Map(layout.nodes.map((n) => [n.id, n]));
      for (const a of view.nodes) for (const b of view.nodes) {
        if (a.dateKey !== b.dateKey && (a.dateKey ?? "9999") < (b.dateKey ?? "9999")) {
          expect(positions.get(a.id)!.x).toBeLessThan(positions.get(b.id)!.x);
        }
      }
      expect(countRouteCrossings(layout.routes)).toBeLessThanOrEqual(2);
      expectRadialMonotoneRoutes(layout);
      expectNoCoincidentCurves(layout.routes);
      // A gentle curve must not buy smoothness by towering over the tasks it
      // passes. Check every edge in every mode, including FIN-7 → FIN-25.
      for (const route of layout.routes) {
        const a = positions.get(route.source)!, b = positions.get(route.target)!;
        const local = layout.nodes.filter((n) => n.x >= Math.min(a.x, b.x) && n.x <= Math.max(a.x, b.x));
        const high = Math.min(...local.map((n) => n.y)), low = Math.max(...local.map((n) => n.y));
        const ys = route.segments.flatMap((segment) => Array.from({ length: 101 }, (_, i) => cubicPoint(segment, i / 100).y));
        expect(Math.max(high - Math.min(...ys), Math.max(...ys) - low)).toBeLessThanOrEqual(80);
      }
    }
  }, 30_000);

  it("is independent of node and relation input permutations", () => {
    const view = filterDependencyView(fixture.nodes, fixture.edges, "dependent");
    expect(layoutDependencyGraph([...view.nodes].reverse(), [...view.edges].reverse()))
      .toEqual(layoutDependencyGraph(view.nodes, view.edges));
  });

  it("stacks parallel same-date tasks, orders their blockers, and keeps undated tasks last", () => {
    const input = ["a", "b", "c", "d"].map((id) => ({ id, dateKey: "2027-01-01" }));
    const layout = layoutDependencyGraph([...input, { id: "unknown", dateKey: null }], [
      { source: "a", target: "b" }, { source: "a", target: "c" },
      { source: "b", target: "d" }, { source: "c", target: "d" }, { source: "d", target: "unknown" },
    ]);
    const n = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));
    expect(n.b.x).toBe(n.c.x);
    expect(Math.abs(n.b.y - n.c.y)).toBeGreaterThanOrEqual(76);
    expect(n.a.x).toBeLessThan(n.b.x);
    expect(n.b.x).toBeLessThan(n.d.x);
    expect(n.d.x).toBeLessThan(n.unknown.x);
    expectRadialMonotoneRoutes(layout);
  });

  it("does not invent left-pointing arrows for a same-date cycle", () => {
    const layout = layoutDependencyGraph(["a", "b", "c"].map((id) => ({ id, dateKey: "2027-01-01" })), [
      { source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "a" },
    ]);
    expect(new Set(layout.nodes.map((n) => n.x)).size).toBe(1);
    for (const route of layout.routes) {
      const last = route.segments.at(-1)!;
      expect(last[3].x - last[2].x).toBeCloseTo(0, 6);
    }
    expectRadialMonotoneRoutes(layout);
  });

  it("keeps self-cycle curves clear and inside the camera bounds", () => {
    const layout = layoutDependencyGraph([
      { id: "a", dateKey: "2027-01-01" }, { id: "b", dateKey: "2027-01-01" },
    ], [{ source: "a", target: "a" }]);
    expect(layout.routes).toHaveLength(1);
    expectRadialMonotoneRoutes(layout);
  });

  it("shows a dependency on a later task as a consistently left-pointing curve", () => {
    const layout = layoutDependencyGraph([
      { id: "earlier", dateKey: "2027-01-01" }, { id: "later", dateKey: "2027-02-01" },
    ], [{ source: "later", target: "earlier" }]);
    const last = layout.routes[0].segments.at(-1)!;
    expect(last[3].x).toBeLessThan(last[2].x);
    expectRadialMonotoneRoutes(layout);
  });

  it("handles empty graphs, isolated tasks, duplicate relations, and missing endpoints", () => {
    expect(layoutDependencyGraph([], []).routes).toEqual([]);
    const input = ["a", "b", "isolated"].map((id) => ({ id, dateKey: null }));
    const edge = { source: "a", target: "b" };
    const layout = layoutDependencyGraph(input, [edge, edge, { source: "missing", target: "a" }]);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.routes).toHaveLength(1);
    expectRadialMonotoneRoutes(layout);
  });
});
