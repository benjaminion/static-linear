import { describe, expect, it } from "vitest";
import {
  countRouteCrossings,
  cubicPoint,
  layoutDependencyGraph,
  layoutDependencyNodes,
  routeClearance,
  routeDependencyEdges,
  type RoutedDependencyEdge,
} from "../src/lib/dependency-layout";
import topology from "./fixtures/dependency-topology.json";

const RADIUS = 28;

// Independent dense sampling guards against optimizing a coarse crossing metric
// while leaving visible crossings in the actual curves.
function sampledCrossings(routes: RoutedDependencyEdge[]): number {
  const paths = routes.map((route) => route.segments.flatMap((segment, i) =>
    Array.from({ length: 81 }, (_, j) => cubicPoint(segment, j / 80)).slice(i ? 1 : 0)));
  const orient = (a: { x: number; y: number }, b: typeof a, c: typeof a) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let crossings = 0;
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      const a = paths[i], b = paths[j];
      let crossed = false;
      for (let k = 1; k < a.length && !crossed; k += 1) {
        for (let l = 1; l < b.length; l += 1) {
          if (orient(a[k - 1], a[k], b[l - 1]) * orient(a[k - 1], a[k], b[l]) < -1e-8
            && orient(b[l - 1], b[l], a[k - 1]) * orient(b[l - 1], b[l], a[k]) < -1e-8) {
            crossed = true;
            break;
          }
        }
      }
      if (crossed) crossings += 1;
    }
  }
  return crossings;
}

function expectSmoothJoins(routes: RoutedDependencyEdge[]) {
  for (const route of routes) {
    for (let i = 1; i < route.segments.length; i += 1) {
      const previous = route.segments[i - 1], next = route.segments[i];
      expect(previous[3]).toEqual(next[0]);
      const out = { x: previous[3].x - previous[2].x, y: previous[3].y - previous[2].y };
      const into = { x: next[1].x - next[0].x, y: next[1].y - next[0].y };
      expect((out.x * into.x + out.y * into.y) / (Math.hypot(out.x, out.y) * Math.hypot(into.x, into.y))).toBeCloseTo(1, 6);
    }
  }
}

function expectSeparateHorizontalRuns(routes: RoutedDependencyEdge[]) {
  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      for (const a of routes[i].segments) {
        if (!a.every((point) => Math.abs(point.y - a[0].y) < .01)) continue;
        for (const b of routes[j].segments) {
          if (!b.every((point) => Math.abs(point.y - b[0].y) < .01)) continue;
          const overlap = Math.min(Math.max(a[0].x, a[3].x), Math.max(b[0].x, b[3].x))
            - Math.max(Math.min(a[0].x, a[3].x), Math.min(b[0].x, b[3].x));
          if (overlap > 30) expect(Math.abs(a[0].y - b[0].y)).toBeGreaterThanOrEqual(8 - 1e-6);
        }
      }
    }
  }
}

describe("countRouteCrossings", () => {
  it("counts crossings away from a shared source or target", () => {
    const routes: RoutedDependencyEdge[] = [
      { source: "hub", target: "a", d: "", segments: [[{ x: 0, y: 0 }, { x: 40, y: 50 }, { x: 80, y: -80 }, { x: 120, y: -10 }]] },
      { source: "hub", target: "b", d: "", segments: [[{ x: 0, y: 0 }, { x: 40, y: 7 }, { x: 80, y: 14 }, { x: 120, y: 21 }]] },
    ];
    expect(sampledCrossings(routes)).toBe(1);
    expect(countRouteCrossings(routes)).toBe(1);
    expect(countRouteCrossings(routes.map((route) => ({
      ...route,
      source: route.target,
      target: route.source,
      segments: route.segments.map(([a, b, c, d]) => [d, c, b, a]),
    })))).toBe(1);
  });
});

describe("routeDependencyEdges", () => {
  it("untangles the published convergence and fan-out without moving nodes", () => {
    // Geometry and topology only, extracted from the published Tasks page; no
    // descriptions, comments, credentials, or raw API responses in the fixture.
    const routes = routeDependencyEdges(topology.positions, topology.edges).routes;
    const id = (label: string) => topology.nodes.find((node) => node.label === label)!.id;
    expect(sampledCrossings(routes.filter((route) => route.target === id("FIN-67")))).toBe(0);
    expect(sampledCrossings(routes.filter((route) => route.source === id("FIN-7")))).toBe(0);
    expect(sampledCrossings(routes)).toBeLessThanOrEqual(4);
    expectSmoothJoins(routes);

    const reversed = routeDependencyEdges([...topology.positions].reverse(), [...topology.edges].reverse()).routes;
    expect(new Map(reversed.map((route) => [`${route.source}:${route.target}`, route.d])))
      .toEqual(new Map(routes.map((route) => [`${route.source}:${route.target}`, route.d])));
  }, 30_000);

  it("uses one smooth cubic when the direct path is clear", () => {
    const nodes = [
      { id: "source", x: 0, y: 70 },
      { id: "target", x: 200, y: 146 },
    ];
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
    const nodes = [
      { id: "source", x: 0, y: 70 },
      { id: "target", x: 100, y: 70 },
    ];
    const [route] = routeDependencyEdges(nodes, [{ source: "source", target: "target" }]).routes;
    const end = route.segments.at(-1)![3];
    const start = route.segments[0][0];

    expect(Math.hypot(end.x - 100, end.y - 70)).toBeCloseTo(29, 0);
    expect(start.x).toBeGreaterThan(0);
    expect(end.x).toBeLessThan(100);
  });

  it("aligns a diagonal route's final tangent with its target", () => {
    const nodes = [
      { id: "source", x: 0, y: 0 },
      { id: "target", x: 100, y: 100 },
    ];
    const [route] = routeDependencyEdges(nodes, [{ source: "source", target: "target" }]).routes;
    const segment = route.segments.at(-1)!;
    const [, , control, end] = segment;
    const tangent = { x: end.x - control.x, y: end.y - control.y };
    const inward = { x: 100 - end.x, y: 100 - end.y };

    expect(tangent.x * inward.y - tangent.y * inward.x).toBeCloseTo(0, 5);
    expect(tangent.x * inward.x + tangent.y * inward.y).toBeGreaterThan(0);
  });

  it("exits toward a higher target instead of only from the side", () => {
    const nodes = [
      { id: "source", x: 0, y: 200 },
      { id: "target", x: 80, y: 40 },
    ];
    const [route] = routeDependencyEdges(nodes, [{ source: "source", target: "target" }]).routes;
    const start = route.segments[0][0];

    // Attachment should sit on the upper half of the source disc.
    expect(start.y).toBeLessThan(200);
  });

  it("threads a near-chord corridor instead of wrapping the whole stack", () => {
    // Two lanes of obstacles with a clear gap between them near the chord.
    const nodes = [
      { id: "a", x: 0, y: 220 },
      { id: "top1", x: 100, y: 70 },
      { id: "top2", x: 200, y: 70 },
      { id: "bot1", x: 100, y: 370 },
      { id: "bot2", x: 200, y: 370 },
      { id: "z", x: 300, y: 220 },
    ];
    const [route] = routeDependencyEdges(nodes, [{ source: "a", target: "z" }]).routes;
    const mid = cubicPoint(route.segments[0], 0.5);

    expect(routeClearance(route.segments, nodes, "a", "z", RADIUS)).toBeGreaterThanOrEqual(6);
    // Midpoint should stay near the middle corridor, not above the top row or below the bottom.
    expect(mid.y).toBeGreaterThan(120);
    expect(mid.y).toBeLessThan(320);
  });

  it("detours so long edges clear intermediate nodes", () => {
    const nodes = [
      { id: "a", x: 0, y: 70 },
      { id: "b", x: 76, y: 70 },
      { id: "c", x: 152, y: 70 },
      { id: "d", x: 228, y: 70 },
      { id: "e", x: 304, y: 70 },
    ];
    const [route] = routeDependencyEdges(nodes, [{ source: "a", target: "e" }]).routes;

    expect(routeClearance(route.segments, nodes, "a", "e", RADIUS)).toBeGreaterThanOrEqual(6);
    // Sample the geometric middle of the path (not the climb segment alone).
    const midSegment = route.segments[Math.floor(route.segments.length / 2)];
    const mid = cubicPoint(midSegment, route.segments.length === 1 ? 0.5 : 0.5);
    expect(Math.abs(mid.y - 70)).toBeGreaterThan(RADIUS * 0.75);
  });

  it("keeps multi-segment detours G1-smooth at joints", () => {
    // Collinear intermediates force a rail detour; joints must not form corners.
    const nodes = [
      { id: "a", x: 0, y: 40 },
      { id: "b", x: 100, y: 40 },
      { id: "c", x: 200, y: 40 },
      { id: "d", x: 300, y: 40 },
      { id: "e", x: 400, y: 200 },
    ];
    const [route] = routeDependencyEdges(nodes, [{ source: "a", target: "e" }]).routes;
    if (route.segments.length < 2) return;

    for (let index = 1; index < route.segments.length; index += 1) {
      const previous = route.segments[index - 1];
      const next = route.segments[index];
      const out = { x: previous[3].x - previous[2].x, y: previous[3].y - previous[2].y };
      const into = { x: next[1].x - next[0].x, y: next[1].y - next[0].y };
      const outLen = Math.hypot(out.x, out.y) || 1;
      const intoLen = Math.hypot(into.x, into.y) || 1;
      const cos = (out.x * into.x + out.y * into.y) / (outLen * intoLen);
      expect(cos).toBeGreaterThan(0.92);
    }
  });

  it("keeps multi-edge dense spines clear of intermediate nodes", () => {
    const nodes = Array.from({ length: 8 }, (_, index) => ({
      id: `n${index}`,
      x: index * 76,
      y: 70 + (index % 3) * 76,
    }));
    const edges = [
      { source: "n0", target: "n7" },
      { source: "n1", target: "n6" },
      { source: "n2", target: "n5" },
      { source: "n0", target: "n3" },
    ];
    const { routes } = routeDependencyEdges(nodes, edges);

    for (const route of routes) {
      expect(routeClearance(route.segments, nodes, route.source, route.target, RADIUS)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("layoutDependencyNodes", () => {
  it("produces a deterministic layout and preserves input X order", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const edges = [
      { source: "a", target: "f" },
      { source: "b", target: "e" },
    ];

    const first = layoutDependencyNodes(ids, edges);
    const second = layoutDependencyNodes(ids, edges);
    expect(second).toEqual(first);

    const xs = first.nodes.map((node) => node.x);
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]).toBeGreaterThan(xs[index - 1]);
    }
    expect(first.nodes.map((node) => node.id)).toEqual(ids);
  });

  it("keeps short dependency chains vertically compact", () => {
    // Isolated path: placement should not zig-zag when nothing blocks a flat layout.
    const ids = ["a", "b", "c", "d"];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ];
    const { nodes } = layoutDependencyNodes(ids, edges);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const span = Math.max(...nodes.map((node) => node.y)) - Math.min(...nodes.map((node) => node.y));

    expect(span).toBeLessThanOrEqual(76);
    expect(Math.abs(byId.get("a")!.y - byId.get("b")!.y)).toBeLessThanOrEqual(76);
    expect(Math.abs(byId.get("b")!.y - byId.get("c")!.y)).toBeLessThanOrEqual(76);
    expect(Math.abs(byId.get("c")!.y - byId.get("d")!.y)).toBeLessThanOrEqual(76);
  });

  it("routes edges clear of intermediate nodes after lane assignment", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const edges = [
      { source: "a", target: "h" },
      { source: "b", target: "g" },
      { source: "c", target: "f" },
      { source: "a", target: "d" },
      { source: "e", target: "h" },
    ];
    const { nodes } = layoutDependencyNodes(ids, edges);
    const { routes } = routeDependencyEdges(nodes, edges);

    for (const route of routes) {
      expect(routeClearance(route.segments, nodes, route.source, route.target, RADIUS)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("layoutDependencyGraph", () => {
  it("reduces published graph crossings while keeping dates, clearance, and smoothness", () => {
    const layout = layoutDependencyGraph(topology.nodes, topology.edges);
    // Includes FIN-19 → FIN-20 / FIN-68 → FIN-23 and the shared FIN-29
    // approach, plus any other long horizontal runs that become coincident.
    expectSeparateHorizontalRuns(layout.routes);
    // The original generated view has 12 crossing pairs (eight involving FIN-7).
    expect(sampledCrossings(layout.routes)).toBeLessThanOrEqual(2);
    const hub = topology.nodes.find((node) => node.label === "FIN-7")!.id;
    expect(sampledCrossings(layout.routes.filter((route) => route.source === hub))).toBe(0);
    const ordered = [...layout.nodes].sort((a, b) => a.x - b.x);
    const dates = new Map(topology.nodes.map((node) => [node.id, node.dateKey]));
    for (let i = 1; i < ordered.length; i += 1) {
      expect(dates.get(ordered[i].id)! >= dates.get(ordered[i - 1].id)!).toBe(true);
      expect(ordered[i].x).toBeGreaterThan(ordered[i - 1].x);
    }
    for (const route of layout.routes) {
      const source = ordered.find((node) => node.id === route.source)!;
      const target = ordered.find((node) => node.id === route.target)!;
      if (dates.get(source.id) === dates.get(target.id)) expect(source.x).toBeLessThan(target.x);
      expect(routeClearance(route.segments, layout.nodes, route.source, route.target)).toBeGreaterThanOrEqual(8);
    }
    expect(Math.max(...layout.nodes.map((node) => node.y)) - Math.min(...layout.nodes.map((node) => node.y))).toBeLessThanOrEqual(9 * 76);
    expectSmoothJoins(layout.routes);
  }, 45_000);

  it("preserves date order while deterministically refining equal-date ties", () => {
    const input = [
      { id: "late", dateKey: "2027-02-01" },
      { id: "same-b", dateKey: "2027-01-01" },
      { id: "undated", dateKey: null },
      { id: "same-a", dateKey: "2027-01-01" },
      { id: "early", dateKey: "2026-12-01" },
    ];
    const edges = [
      { source: "early", target: "same-b" },
      { source: "same-b", target: "same-a" },
      { source: "same-a", target: "late" },
      { source: "late", target: "undated" },
    ];

    const first = layoutDependencyGraph(input, edges);
    const second = layoutDependencyGraph([...input].reverse(), [...edges].reverse());
    const order = [...first.nodes].sort((a, b) => a.x - b.x).map(({ id }) => id);

    expect(order[0]).toBe("early");
    expect(new Set(order.slice(1, 3))).toEqual(new Set(["same-a", "same-b"]));
    expect(order.slice(3)).toEqual(["late", "undated"]);
    const positions = new Map(first.nodes.map((node) => [node.id, node.x]));
    expect(positions.get("same-b")!).toBeLessThan(positions.get("same-a")!);
    expect(second.nodes).toEqual(first.nodes);
    expect(new Map(second.routes.map((route) => [`${route.source}:${route.target}`, route.d])))
      .toEqual(new Map(first.routes.map((route) => [`${route.source}:${route.target}`, route.d])));
  });

  it("uses no more than ten balanced lanes on a dense graph", () => {
    const nodes = Array.from({ length: 48 }, (_, index) => ({
      id: `n${index}`,
      dateKey: `2027-${String(Math.floor(index / 4) + 1).padStart(2, "0")}-01`,
    }));
    const edges = Array.from({ length: 12 }, (_, index) => ({
      source: `n${index}`,
      target: `n${index + 1}`,
    }));
    const layout = layoutDependencyGraph(nodes, edges);

    expect(new Set(layout.nodes.map(({ y }) => y)).size).toBeLessThanOrEqual(10);
  });

  it("globally routes an avoidable crossing pattern without node intersections", () => {
    const nodes = [
      { id: "a", dateKey: "2027-01-01" },
      { id: "b", dateKey: "2027-02-01" },
      { id: "c", dateKey: "2027-03-01" },
      { id: "d", dateKey: "2027-04-01" },
      { id: "e", dateKey: "2027-05-01" },
      { id: "f", dateKey: "2027-06-01" },
    ];
    const edges = [
      { source: "a", target: "e" },
      { source: "b", target: "f" },
      { source: "a", target: "c" },
      { source: "d", target: "f" },
    ];
    const layout = layoutDependencyGraph(nodes, edges);

    expect(countRouteCrossings(layout.routes)).toBe(0);
    for (const route of layout.routes) {
      expect(routeClearance(route.segments, layout.nodes, route.source, route.target, RADIUS)).toBeGreaterThanOrEqual(6);
    }
  });

  it("keeps a representative initiative-scale graph readable", () => {
    const nodes = Array.from({ length: 36 }, (_, index) => ({
      id: `n${index}`,
      dateKey: `2027-${String(Math.floor(index / 6) + 1).padStart(2, "0")}-01`,
    }));
    const edges = [
      ...Array.from({ length: 30 }, (_, index) => ({
        source: `n${index}`,
        target: `n${Math.min(35, index + 5 + index % 5)}`,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        source: `n${index}`,
        target: `n${35 - index}`,
      })),
    ];
    const layout = layoutDependencyGraph(nodes, edges);

    expect(countRouteCrossings(layout.routes)).toBeLessThanOrEqual(12);
    for (const route of layout.routes) {
      expect(routeClearance(route.segments, layout.nodes, route.source, route.target, RADIUS)).toBeGreaterThanOrEqual(6);
    }
  }, 30_000);

  it("handles reverse and cyclic dependencies deterministically", () => {
    const nodes = [
      { id: "a", dateKey: "2027-01-01" },
      { id: "b", dateKey: "2027-02-01" },
      { id: "c", dateKey: "2027-03-01" },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ];
    const first = layoutDependencyGraph(nodes, edges);
    const second = layoutDependencyGraph(nodes, edges);

    expect(second).toEqual(first);
    expect(first.routes).toHaveLength(3);
    expect(first.routes.every((route) => route.segments.length > 0)).toBe(true);
  });
});
