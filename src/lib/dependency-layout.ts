export interface DependencyLayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface DependencyLayoutEdge {
  source: string;
  target: string;
}

interface Point {
  x: number;
  y: number;
}

export interface RoutedDependencyEdge extends DependencyLayoutEdge {
  d: string;
  segments: Array<[Point, Point, Point, Point]>;
}

export interface DependencyLayout {
  routes: RoutedDependencyEdge[];
  minY: number;
  maxY: number;
}

export interface DependencyNodeLayout {
  nodes: DependencyLayoutNode[];
  width: number;
}

const NODE_RADIUS = 28;
const HORIZONTAL_STEP = 76;
const LANE_GAP = 76;
const LAYOUT_SEEDS = 3;
const IMPROVEMENT_PASSES = 1;

function boundaryPoint(node: DependencyLayoutNode, side: "left" | "right", yOffset: number, radius: number): Point {
  const direction = side === "left" ? -1 : 1;
  const xOffset = Math.sqrt(Math.max(0, radius ** 2 - yOffset ** 2));
  return { x: node.x + direction * xOffset, y: node.y + yOffset };
}

export function cubicPoint(points: [Point, Point, Point, Point], t: number): Point {
  const [start, control1, control2, end] = points;
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * end.y,
  };
}

function attachmentOffsets(edges: DependencyLayoutEdge[], nodes: Map<string, DependencyLayoutNode>, radius: number) {
  const attachments = new Map<string, Array<{ edgeIndex: number; otherY: number }>>();
  edges.forEach((edge, edgeIndex) => {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) return;
    const direction = target.x >= source.x ? 1 : -1;
    const sourceKey = `${edge.source}:${direction === 1 ? "right" : "left"}`;
    const targetKey = `${edge.target}:${direction === 1 ? "left" : "right"}`;
    attachments.set(sourceKey, [...(attachments.get(sourceKey) ?? []), { edgeIndex, otherY: target.y }]);
    attachments.set(targetKey, [...(attachments.get(targetKey) ?? []), { edgeIndex, otherY: source.y }]);
  });

  const offsets = new Map<string, number>();
  for (const [key, entries] of attachments) {
    entries.sort((a, b) => a.otherY - b.otherY || a.edgeIndex - b.edgeIndex);
    const step = entries.length > 1 ? Math.min(8, radius * 1.1 / (entries.length - 1)) : 0;
    entries.forEach((entry, index) => {
      offsets.set(`${key}:${entry.edgeIndex}`, (index - (entries.length - 1) / 2) * step);
    });
  }
  return offsets;
}

function curveForEdge(
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  radius: number,
  sourceOffset = 0,
  targetOffset = 0,
): [Point, Point, Point, Point] {
  const direction = target.x >= source.x ? 1 : -1;
  const start = boundaryPoint(source, direction === 1 ? "right" : "left", sourceOffset, radius);
  const centerDx = target.x - source.x, centerDy = target.y - source.y;
  const centerDistance = Math.max(1, Math.hypot(centerDx, centerDy));
  const rawHorizontal = Math.abs(centerDx / centerDistance);
  const incomingX = direction * Math.max(.45, rawHorizontal);
  const incomingY = centerDy === 0 ? 0 : Math.sign(centerDy) * Math.sqrt(1 - incomingX ** 2);
  const outward = { x: -incomingX, y: -incomingY };
  const perpendicular = { x: -outward.y, y: outward.x };
  const offsetX = outward.x * (radius + 1) + perpendicular.x * targetOffset;
  const offsetY = outward.y * (radius + 1) + perpendicular.y * targetOffset;
  const offsetLength = Math.max(1, Math.hypot(offsetX, offsetY));
  const adjustedOutward = { x: offsetX / offsetLength, y: offsetY / offsetLength };
  const adjustedIncoming = { x: -adjustedOutward.x, y: -adjustedOutward.y };
  const end = {
    x: target.x + adjustedOutward.x * (radius + 1),
    y: target.y + adjustedOutward.y * (radius + 1),
  };
  const handle = Math.max(4, Math.min(180, Math.abs(end.x - start.x) * .42));
  return [
    start,
    { x: start.x + direction * handle, y: start.y },
    { x: end.x - adjustedIncoming.x * handle, y: end.y - adjustedIncoming.y * handle },
    end,
  ];
}

export function routeDependencyEdges(
  layoutNodes: DependencyLayoutNode[],
  layoutEdges: DependencyLayoutEdge[],
  radius = NODE_RADIUS,
): DependencyLayout {
  if (!layoutNodes.length) return { routes: [], minY: 0, maxY: 220 };
  const nodes = new Map(layoutNodes.map((node) => [node.id, node]));
  const edges = layoutEdges.filter((edge) => edge.source !== edge.target && nodes.has(edge.source) && nodes.has(edge.target));
  const offsets = attachmentOffsets(edges, nodes, radius);
  const routes = edges.map((edge, edgeIndex) => {
    const source = nodes.get(edge.source)!, target = nodes.get(edge.target)!;
    const direction = target.x >= source.x ? 1 : -1;
    const sourceSide = direction === 1 ? "right" : "left";
    const targetSide = direction === 1 ? "left" : "right";
    const segment = curveForEdge(
      source,
      target,
      radius,
      offsets.get(`${edge.source}:${sourceSide}:${edgeIndex}`) ?? 0,
      offsets.get(`${edge.target}:${targetSide}:${edgeIndex}`) ?? 0,
    );
    const [start, control1, control2, end] = segment;
    return {
      ...edge,
      segments: [segment],
      d: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`,
    };
  });
  const minNodeY = Math.min(...layoutNodes.map((node) => node.y));
  const maxNodeY = Math.max(...layoutNodes.map((node) => node.y));
  return {
    routes,
    minY: Math.min(0, minNodeY - radius - 16),
    maxY: Math.max(220, maxNodeY + radius + 16),
  };
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx ** 2 + dy ** 2;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function sampleRoute(route: RoutedDependencyEdge, count = 8): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => cubicPoint(route.segments[0], index / count));
}

function layoutScore(nodes: DependencyLayoutNode[], edges: DependencyLayoutEdge[]): number {
  const layout = routeDependencyEdges(nodes, edges);
  const samples = layout.routes.map((route) => sampleRoute(route));
  let score = 0;

  layout.routes.forEach((route, routeIndex) => {
    const source = nodes.find((node) => node.id === route.source)!;
    const target = nodes.find((node) => node.id === route.target)!;
    score += Math.abs(source.y - target.y) * .035;
    for (const point of samples[routeIndex].slice(1, -1)) {
      for (const node of nodes) {
        if (node.id === route.source || node.id === route.target) continue;
        const distance = Math.hypot(point.x - node.x, point.y - node.y);
        if (distance < NODE_RADIUS + 5) score += 500 + (NODE_RADIUS + 5 - distance) * 40;
      }
    }
  });

  for (let first = 0; first < samples.length; first += 1) {
    for (let second = first + 1; second < samples.length; second += 1) {
      const firstInterior = samples[first].slice(1, -1);
      const secondInterior = samples[second].slice(1, -1);
      let closest = Infinity;
      for (const point of firstInterior) {
        for (let index = 1; index < secondInterior.length; index += 1) {
          closest = Math.min(closest, pointToSegmentDistance(point, secondInterior[index - 1], secondInterior[index]));
        }
      }
      if (closest < 6) score += (6 - closest) * 18;
    }
  }
  return score;
}

function hash(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

export function layoutDependencyNodes(nodeIds: string[], edges: DependencyLayoutEdge[]): DependencyNodeLayout {
  if (!nodeIds.length) return { nodes: [], width: 1000 };
  const laneCount = Math.max(1, Math.min(6, Math.ceil(nodeIds.length / 5)));
  const width = Math.max(1000, 100 + Math.max(0, nodeIds.length - 1) * HORIZONTAL_STEP);
  const degrees = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    if (degrees.has(edge.source)) degrees.set(edge.source, degrees.get(edge.source)! + 1);
    if (degrees.has(edge.target)) degrees.set(edge.target, degrees.get(edge.target)! + 1);
  }
  const optimizationOrder = nodeIds.map((_, index) => index)
    .sort((a, b) => degrees.get(nodeIds[b])! - degrees.get(nodeIds[a])! || a - b);
  const makeNodes = (lanes: number[]) => nodeIds.map((id, index) => ({
    id,
    x: nodeIds.length === 1 ? width / 2 : 50 + index * HORIZONTAL_STEP,
    y: 70 + lanes[index] * LANE_GAP,
  }));
  const seeds = Array.from({ length: LAYOUT_SEEDS }, (_, seed) => nodeIds.map((id, index) => {
    if (seed === 0) return index % laneCount;
    if (seed === 1) return (laneCount - 1 - index % laneCount + laneCount) % laneCount;
    return hash(id) % laneCount;
  }));

  let bestLanes = seeds[0], bestScore = Infinity;
  for (const seed of seeds) {
    const lanes = [...seed];
    for (let pass = 0; pass < IMPROVEMENT_PASSES; pass += 1) {
      for (const nodeIndex of optimizationOrder) {
        let chosenLane = lanes[nodeIndex], chosenScore = Infinity;
        for (let lane = 0; lane < laneCount; lane += 1) {
          lanes[nodeIndex] = lane;
          const score = layoutScore(makeNodes(lanes), edges);
          if (score < chosenScore) { chosenScore = score; chosenLane = lane; }
        }
        lanes[nodeIndex] = chosenLane;
      }
    }
    const score = layoutScore(makeNodes(lanes), edges);
    if (score < bestScore) { bestScore = score; bestLanes = [...lanes]; }
  }

  const minLane = Math.min(...bestLanes);
  return { nodes: makeNodes(bestLanes.map((lane) => lane - minLane)), width };
}
