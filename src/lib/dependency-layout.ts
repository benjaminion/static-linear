export interface DependencyLayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface DependencyLayoutInputNode {
  id: string;
  /** ISO date used only to preserve chronological X groups; null sorts last. */
  dateKey: string | null;
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

export interface DependencyGraphLayout extends DependencyLayout, DependencyNodeLayout {}

export interface DependencyNodeLayout {
  nodes: DependencyLayoutNode[];
  width: number;
}

const NODE_RADIUS = 28;
const HORIZONTAL_STEP = 76;
const LANE_GAP = 76;
const LAYOUT_SEEDS = 3;
const IMPROVEMENT_PASSES = 2;
const BARYCENTER_PASSES = 3;
const CLEARANCE = 8;
const SAMPLE_COUNT = 16;
const CORRIDOR_STEP = 4;
const MAX_LANES = 10;
const EXTRA_LANES = 2;
const ROUTE_PAIR_SAMPLE_COUNT = 6;
const routePairSampleCache = new WeakMap<Array<[Point, Point, Point, Point]>, Point[]>();

function rimPoint(node: DependencyLayoutNode, toward: Point, radius: number, perpOffset = 0): Point {
  let dx = toward.x - node.x;
  let dy = toward.y - node.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const px = -dy;
  const py = dx;
  let ox = dx * radius + px * perpOffset;
  let oy = dy * radius + py * perpOffset;
  const offsetLength = Math.hypot(ox, oy) || 1;
  // Keep the contact on the circle (perp offsets otherwise push outside the rim).
  return {
    x: node.x + (ox / offsetLength) * (radius + 1),
    y: node.y + (oy / offsetLength) * (radius + 1),
  };
}

export function cubicPoint(points: [Point, Point, Point, Point], t: number): Point {
  const [start, control1, control2, end] = points;
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * end.y,
  };
}

function sampleSegment(segment: [Point, Point, Point, Point], count = SAMPLE_COUNT): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => cubicPoint(segment, index / count));
}

function sampleSegments(segments: Array<[Point, Point, Point, Point]>, count = SAMPLE_COUNT): Point[] {
  if (!segments.length) return [];
  const points: Point[] = [];
  segments.forEach((segment, segmentIndex) => {
    const samples = sampleSegment(segment, count);
    if (segmentIndex === 0) points.push(...samples);
    else points.push(...samples.slice(1));
  });
  return points;
}

function adaptiveSampleSegments(segments: Array<[Point, Point, Point, Point]>, minimum = SAMPLE_COUNT): Point[] {
  if (!segments.length) return [];
  const points: Point[] = [];
  segments.forEach((segment, segmentIndex) => {
    const controlLength = segment.slice(1).reduce(
      (sum, point, index) => sum + Math.hypot(point.x - segment[index].x, point.y - segment[index].y),
      0,
    );
    const count = Math.max(minimum, Math.min(64, Math.ceil(controlLength / 12)));
    const samples = sampleSegment(segment, count);
    points.push(...(segmentIndex === 0 ? samples : samples.slice(1)));
  });
  return points;
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function properIntersection(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = orient(a, b, c);
  const abD = orient(a, b, d);
  const cdA = orient(c, d, a);
  const cdB = orient(c, d, b);
  const epsilon = 1e-6;
  return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
}

function routePairSamples(segments: Array<[Point, Point, Point, Point]>): Point[] {
  const cached = routePairSampleCache.get(segments);
  if (cached) return cached;
  const samples = sampleSegments(segments, ROUTE_PAIR_SAMPLE_COUNT);
  routePairSampleCache.set(segments, samples);
  return samples;
}

/** Pair cost for non-incident routes: crossings dominate, then near-coincident runs. */
function routePairCost(
  first: Array<[Point, Point, Point, Point]>,
  second: Array<[Point, Point, Point, Point]>,
): number {
  const a = routePairSamples(first);
  const b = routePairSamples(second);
  let crossings = 0;
  let closeSamples = 0;
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (properIntersection(a[i - 1], a[i], b[j - 1], b[j])) crossings += 1;
      const distance = Math.min(
        pointToSegmentDistance(a[i - 1], b[j - 1], b[j]),
        pointToSegmentDistance(a[i], b[j - 1], b[j]),
        pointToSegmentDistance(b[j - 1], a[i - 1], a[i]),
        pointToSegmentDistance(b[j], a[i - 1], a[i]),
      );
      if (distance < 7) closeSamples += (7 - distance) / 7;
    }
  }
  return crossings * 4_000 + closeSamples * 5;
}

/** Minimum distance from path interior samples to any non-endpoint node disc edge (negative = penetration). */
export function routeClearance(
  segments: Array<[Point, Point, Point, Point]>,
  nodes: DependencyLayoutNode[],
  sourceId: string,
  targetId: string,
  radius = NODE_RADIUS,
): number {
  const samples = adaptiveSampleSegments(segments);
  let best = Infinity;
  for (const point of samples.slice(1, -1)) {
    for (const node of nodes) {
      if (node.id === sourceId || node.id === targetId) continue;
      best = Math.min(best, Math.hypot(point.x - node.x, point.y - node.y) - radius);
    }
  }
  return best;
}

function nodesInSpan(
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  nodes: DependencyLayoutNode[],
): DependencyLayoutNode[] {
  const minX = Math.min(source.x, target.x);
  const maxX = Math.max(source.x, target.x);
  return nodes.filter((node) => {
    if (node.id === source.id || node.id === target.id) return false;
    return node.x + NODE_RADIUS > minX && node.x - NODE_RADIUS < maxX;
  });
}

function pathString(segments: Array<[Point, Point, Point, Point]>): string {
  if (!segments.length) return "";
  const [first, ...rest] = segments;
  let d = `M ${first[0].x} ${first[0].y} C ${first[1].x} ${first[1].y}, ${first[2].x} ${first[2].y}, ${first[3].x} ${first[3].y}`;
  for (const segment of rest) {
    d += ` C ${segment[1].x} ${segment[1].y}, ${segment[2].x} ${segment[2].y}, ${segment[3].x} ${segment[3].y}`;
  }
  return d;
}

/** Fan-out offsets by polar angle so multiple edges leave/enter without stacking. */
function angularOffsets(
  edges: DependencyLayoutEdge[],
  nodes: Map<string, DependencyLayoutNode>,
  radius: number,
): Map<string, number> {
  const groups = new Map<string, Array<{ edgeIndex: number; angle: number; key: string }>>();
  edges.forEach((edge, edgeIndex) => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) return;
    const outAngle = Math.atan2(target.y - source.y, target.x - source.x);
    const inAngle = Math.atan2(source.y - target.y, source.x - target.x);
    const sourceKey = `out:${edge.source}`;
    const targetKey = `in:${edge.target}`;
    const edgeKey = `${edge.source}\u0000${edge.target}`;
    groups.set(sourceKey, [...(groups.get(sourceKey) ?? []), { edgeIndex, angle: outAngle, key: edgeKey }]);
    groups.set(targetKey, [...(groups.get(targetKey) ?? []), { edgeIndex, angle: inAngle, key: edgeKey }]);
  });

  const offsets = new Map<string, number>();
  for (const [key, entries] of groups) {
    entries.sort((a, b) => a.angle - b.angle || a.key.localeCompare(b.key) || a.edgeIndex - b.edgeIndex);
    const step = entries.length > 1 ? Math.min(10, radius * 1.15 / (entries.length - 1)) : 0;
    entries.forEach((entry, index) => {
      offsets.set(`${key}:${entry.edgeIndex}`, (index - (entries.length - 1) / 2) * step);
    });
  }
  return offsets;
}

function directCurve(
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  radius: number,
  sourceOffset: number,
  targetOffset: number,
): [Point, Point, Point, Point] {
  const start = rimPoint(source, target, radius, sourceOffset);
  const end = rimPoint(target, source, radius, targetOffset);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  // Exit along the chord so attachments feel continuous (top/side/diagonal as needed).
  const handle = Math.max(12, Math.min(160, distance * .38));
  const ux = dx / distance;
  const uy = dy / distance;
  return [
    start,
    { x: start.x + ux * handle, y: start.y + uy * handle },
    { x: end.x - ux * handle, y: end.y - uy * handle },
    end,
  ];
}

function corridorClear(
  corridorY: number,
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  obstacles: DependencyLayoutNode[],
  radius: number,
  clearance: number,
): boolean {
  const minX = Math.min(source.x, target.x);
  const maxX = Math.max(source.x, target.x);
  for (const node of obstacles) {
    if (node.x < minX - radius || node.x > maxX + radius) continue;
    if (Math.abs(node.y - corridorY) < radius + clearance) return false;
  }
  return true;
}

/** Prefer gaps near the chord over wrapping around the whole obstacle bounding box. */
function findCorridorYs(
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  obstacles: DependencyLayoutNode[],
  radius: number,
  clearance: number,
): number[] {
  const pad = radius + clearance + 4;
  const ys = [source.y, target.y, (source.y + target.y) / 2];
  for (const node of obstacles) {
    ys.push(node.y + pad, node.y - pad, node.y + pad + LANE_GAP / 2, node.y - pad - LANE_GAP / 2);
  }
  if (obstacles.length) {
    const minObs = Math.min(...obstacles.map((node) => node.y));
    const maxObs = Math.max(...obstacles.map((node) => node.y));
    for (let y = minObs - pad * 2; y <= maxObs + pad * 2; y += CORRIDOR_STEP) ys.push(y);
  }

  const chord = (source.y + target.y) / 2;
  const unique = [...new Set(ys.map((y) => Math.round(y * 2) / 2))];
  const scored = unique
    .filter((y) => corridorClear(y, source, target, obstacles, radius, clearance))
    .map((y) => ({
      y,
      cost:
        Math.abs(y - chord) * 1.2
        + (Math.abs(y - source.y) + Math.abs(y - target.y)) * .25,
    }))
    .sort((a, b) => a.cost - b.cost || a.y - b.y);

  return scored.map((entry) => entry.y);
}

function corridorCurve(
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  corridorY: number,
  radius: number,
  sourceOffset: number,
  targetOffset: number,
): [Point, Point, Point, Point] {
  const direction = target.x >= source.x ? 1 : -1;
  const span = Math.abs(target.x - source.x);
  const inset = Math.max(radius + 8, Math.min(span * .22, span / 2 - 4));
  const aimStart: Point = { x: source.x + direction * inset, y: corridorY };
  const aimEnd: Point = { x: target.x - direction * inset, y: corridorY };
  const start = rimPoint(source, aimStart, radius, sourceOffset);
  const end = rimPoint(target, aimEnd, radius, targetOffset);
  const distance = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  // Longer handles at corridor height reach the rail sooner and reduce mid-span sag into nodes.
  const handle = Math.max(28, Math.min(220, distance * .48));

  return [
    start,
    { x: start.x + direction * handle, y: corridorY },
    { x: end.x - direction * handle, y: corridorY },
    end,
  ];
}

function outerRailY(
  obstacles: DependencyLayoutNode[],
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  radius: number,
  side: 1 | -1,
  stagger: number,
): number {
  if (!obstacles.length) {
    return (source.y + target.y) / 2 + side * (radius + CLEARANCE + stagger);
  }
  if (side === 1) return Math.max(...obstacles.map((node) => node.y)) + radius + CLEARANCE + stagger;
  return Math.min(...obstacles.map((node) => node.y)) - radius - CLEARANCE - stagger;
}

/**
 * Multi-segment rail path with G1 joins: climb/descend end with horizontal tangents
 * matching the rail, so joints stay smooth instead of forming corners.
 */
function railDetour(
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  railY: number,
  radius: number,
  sourceOffset: number,
  targetOffset: number,
): Array<[Point, Point, Point, Point]> {
  const direction = target.x >= source.x ? 1 : -1;
  const aimStart: Point = { x: source.x + direction * (radius + 10), y: railY };
  const aimEnd: Point = { x: target.x - direction * (radius + 10), y: railY };
  const start = rimPoint(source, aimStart, radius, sourceOffset);
  const end = rimPoint(target, aimEnd, radius, targetOffset);
  const span = Math.abs(end.x - start.x);
  const rise = Math.abs(railY - start.y);
  const fall = Math.abs(railY - end.y);
  // Reach the rail a short distance from each endpoint, then travel horizontally.
  const joinInset = Math.max(28, Math.min(90, Math.max(rise, fall) * .55 + 16, span * .12));
  const leftRail: Point = { x: start.x + direction * joinInset, y: railY };
  const rightRail: Point = { x: end.x - direction * joinInset, y: railY };
  const travel = Math.abs(rightRail.x - leftRail.x);
  const horiz = Math.max(20, Math.min(70, joinInset * .65));

  if (travel < 16) {
    const apex: Point = { x: (start.x + end.x) / 2, y: railY };
    return [
      [
        start,
        { x: start.x + direction * horiz * .4, y: start.y + (railY - start.y) * .2 },
        { x: apex.x - direction * horiz, y: railY },
        apex,
      ],
      [
        apex,
        { x: apex.x + direction * horiz, y: railY },
        { x: end.x - direction * horiz * .4, y: end.y + (railY - end.y) * .2 },
        end,
      ],
    ];
  }

  // c2 of climb / c1 of travel share the rail y so the join tangent is horizontal.
  const climb: [Point, Point, Point, Point] = [
    start,
    {
      x: start.x + (leftRail.x - start.x) * .3,
      y: start.y + (railY - start.y) * .15,
    },
    { x: leftRail.x - direction * horiz, y: railY },
    leftRail,
  ];
  const across: [Point, Point, Point, Point] = [
    leftRail,
    { x: leftRail.x + direction * travel * .33, y: railY },
    { x: leftRail.x + direction * travel * .66, y: railY },
    rightRail,
  ];
  const descend: [Point, Point, Point, Point] = [
    rightRail,
    { x: rightRail.x + direction * horiz, y: railY },
    {
      x: end.x - (end.x - rightRail.x) * .3,
      y: end.y + (railY - end.y) * .15,
    },
    end,
  ];
  return [climb, across, descend];
}

/** Cosine of the tangent kink at each joint (1 = smooth, lower = corner). */
function jointSmoothness(segments: Array<[Point, Point, Point, Point]>): number {
  if (segments.length < 2) return 1;
  let worst = 1;
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const next = segments[index];
    const out = { x: previous[3].x - previous[2].x, y: previous[3].y - previous[2].y };
    const into = { x: next[1].x - next[0].x, y: next[1].y - next[0].y };
    const outLen = Math.hypot(out.x, out.y) || 1;
    const intoLen = Math.hypot(into.x, into.y) || 1;
    const cos = (out.x * into.x + out.y * into.y) / (outLen * intoLen);
    worst = Math.min(worst, cos);
  }
  return worst;
}

function scoreRoute(
  segments: Array<[Point, Point, Point, Point]>,
  nodes: DependencyLayoutNode[],
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  radius: number,
): number {
  const clearance = routeClearance(segments, nodes, source.id, target.id, radius);
  const samples = sampleSegments(segments, 8);
  let length = 0;
  for (let index = 1; index < samples.length; index += 1) {
    length += Math.hypot(samples[index].x - samples[index - 1].x, samples[index].y - samples[index - 1].y);
  }
  const chord = Math.hypot(target.x - source.x, target.y - source.y);
  const mid = samples[Math.floor(samples.length / 2)];
  const midDrift = mid ? Math.abs(mid.y - (source.y + target.y) / 2) : 0;
  const kink = 1 - Math.min(1, jointSmoothness(segments));
  // Prefer short, near-chord, smooth paths; treat insufficient clearance as disqualifying.
  return (clearance < CLEARANCE ? 50_000 - clearance * 200 : 0)
    + length * .35
    + midDrift * .8
    + Math.max(0, length - chord) * .5
    + Math.max(0, segments.length - 1) * 10
    + kink * 120;
}

function buildEdgeCandidates(
  source: DependencyLayoutNode,
  target: DependencyLayoutNode,
  layoutNodes: DependencyLayoutNode[],
  radius: number,
  sourceOffset: number,
  targetOffset: number,
  edgeKey: string,
): Array<Array<[Point, Point, Point, Point]>> {
  const candidates: Array<[Point, Point, Point, Point][]> = [];

  const direct = directCurve(source, target, radius, sourceOffset, targetOffset);
  candidates.push([direct]);

  const obstacles = nodesInSpan(source, target, layoutNodes);
  const corridors = findCorridorYs(source, target, obstacles, radius, CLEARANCE).slice(0, 12);
  for (const corridorY of corridors) {
    candidates.push([corridorCurve(source, target, corridorY, radius, sourceOffset, targetOffset)]);
  }

  if (obstacles.length) {
    const stagger = (hash(edgeKey) % 3) * 10;
    for (const side of [1, -1] as const) {
      const railY = outerRailY(obstacles, source, target, radius, side, stagger);
      candidates.push([corridorCurve(source, target, railY, radius, sourceOffset, targetOffset)]);
      candidates.push(railDetour(source, target, railY, radius, sourceOffset, targetOffset));
    }

    // Multi-segment rails: try clear corridors plus a denser y-scan. Horizontal
    // corridorClear is stricter than the actual curved path, so we also probe
    // near-chord y values and keep whatever railDetour actually clears.
    const railYs = new Set<number>(corridors.slice(0, 8));
    const chord = (source.y + target.y) / 2;
    const scanMin = Math.min(source.y, target.y, ...obstacles.map((node) => node.y)) - radius - CLEARANCE * 2;
    const scanMax = Math.max(source.y, target.y, ...obstacles.map((node) => node.y)) + radius + CLEARANCE * 2;
    for (let y = scanMin; y <= scanMax; y += CORRIDOR_STEP * 2) railYs.add(Math.round(y));
    railYs.add(Math.round(chord));
    for (const node of obstacles) {
      railYs.add(Math.round(node.y + radius + CLEARANCE + 2));
      railYs.add(Math.round(node.y - radius - CLEARANCE - 2));
    }

    for (const railY of railYs) {
      candidates.push(railDetour(source, target, railY, radius, sourceOffset, targetOffset));
    }
  }

  return candidates
    .map((segments, index) => ({
      segments,
      index,
      score: scoreRoute(segments, layoutNodes, source, target, radius),
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 6)
    .map(({ segments }) => segments);
}

export function routeDependencyEdges(
  layoutNodes: DependencyLayoutNode[],
  layoutEdges: DependencyLayoutEdge[],
  radius = NODE_RADIUS,
): DependencyLayout {
  if (!layoutNodes.length) return { routes: [], minY: 0, maxY: 220 };
  const nodes = new Map(layoutNodes.map((node) => [node.id, node]));
  const edges = layoutEdges.filter((edge) => edge.source !== edge.target && nodes.has(edge.source) && nodes.has(edge.target));
  const offsets = angularOffsets(edges, nodes, radius);

  // Longer spans first so the routes which are hardest to place reserve corridors first.
  const order = edges
    .map((edge, edgeIndex) => {
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
      return { edge, edgeIndex, span: Math.abs(target.x - source.x), key: `${edge.source}\u0000${edge.target}` };
    })
    .sort((a, b) => b.span - a.span || a.key.localeCompare(b.key));

  const routed = new Map<number, RoutedDependencyEdge>();
  const candidatesByIndex = new Map<number, Array<Array<[Point, Point, Point, Point]>>>();
  for (const { edge, edgeIndex, key } of order) {
    const source = nodes.get(edge.source)!;
    const target = nodes.get(edge.target)!;
    const candidates = buildEdgeCandidates(
      source,
      target,
      layoutNodes,
      radius,
      offsets.get(`out:${edge.source}:${edgeIndex}`) ?? 0,
      offsets.get(`in:${edge.target}:${edgeIndex}`) ?? 0,
      key,
    );
    candidatesByIndex.set(edgeIndex, candidates);
    let segments = candidates[0];
    let bestScore = Infinity;
    for (const candidate of candidates) {
      let score = scoreRoute(candidate, layoutNodes, source, target, radius);
      for (const previous of routed.values()) {
        if (
          previous.source === edge.source || previous.source === edge.target
          || previous.target === edge.source || previous.target === edge.target
        ) continue;
        score += routePairCost(candidate, previous.segments);
      }
      if (score < bestScore) {
        bestScore = score;
        segments = candidate;
      }
    }
    routed.set(edgeIndex, {
      ...edge,
      segments,
      d: pathString(segments),
    });
  }

  // Deterministic coordinate descent lets earlier reservations react to later paths.
  for (let pass = 0; pass < 1; pass += 1) {
    for (const { edge, edgeIndex } of order) {
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
      let best = routed.get(edgeIndex)!.segments;
      let bestScore = Infinity;
      for (const candidate of candidatesByIndex.get(edgeIndex)!) {
        let score = scoreRoute(candidate, layoutNodes, source, target, radius);
        for (const [otherIndex, other] of routed) {
          if (otherIndex === edgeIndex) continue;
          if (
            other.source === edge.source || other.source === edge.target
            || other.target === edge.source || other.target === edge.target
          ) continue;
          score += routePairCost(candidate, other.segments);
        }
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      routed.set(edgeIndex, { ...edge, segments: best, d: pathString(best) });
    }
  }

  const routes = edges.map((_, edgeIndex) => routed.get(edgeIndex)!);
  const sampleYs = routes.flatMap((route) => sampleSegments(route.segments, 6).map((point) => point.y));
  const minNodeY = Math.min(...layoutNodes.map((node) => node.y));
  const maxNodeY = Math.max(...layoutNodes.map((node) => node.y));
  const minCurveY = sampleYs.length ? Math.min(...sampleYs) : minNodeY;
  const maxCurveY = sampleYs.length ? Math.max(...sampleYs) : maxNodeY;
  return {
    routes,
    minY: Math.min(0, minNodeY - radius - 16, minCurveY - 12),
    maxY: Math.max(220, maxNodeY + radius + 16, maxCurveY + 12),
  };
}

function neighborsOf(nodeIds: string[], edges: DependencyLayoutEdge[]): Map<string, string[]> {
  const neighbors = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!neighbors.has(edge.source) || !neighbors.has(edge.target) || edge.source === edge.target) continue;
    neighbors.get(edge.source)!.push(edge.target);
    neighbors.get(edge.target)!.push(edge.source);
  }
  return neighbors;
}

/**
 * Placement score: keep related nodes on similar lanes, open chords through gaps,
 * and avoid stacking unrelated nodes on the same lane when they sit close in X.
 */
function layoutScore(nodes: DependencyLayoutNode[], edges: DependencyLayoutEdge[]): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const valid = edges.filter((edge) => edge.source !== edge.target && byId.has(edge.source) && byId.has(edge.target));
  let score = 0;
  const ys = nodes.map((node) => node.y);
  score += (Math.max(...ys) - Math.min(...ys)) * .04;

  for (const edge of valid) {
    const source = byId.get(edge.source)!;
    const target = byId.get(edge.target)!;
    const dy = Math.abs(source.y - target.y);
    // Strong pull: chains should progress level rather than zig-zag.
    score += dy * .55;
    const spanHops = Math.abs(target.x - source.x) / HORIZONTAL_STEP;
    if (spanHops <= 1.5) score += dy * .9;
    else if (spanHops <= 3) score += dy * .35;

    const obstacles = nodesInSpan(source, target, nodes);
    for (const node of obstacles) {
      const t = Math.abs(target.x - source.x) < 1
        ? 0.5
        : (node.x - source.x) / (target.x - source.x);
      const chordY = source.y + (target.y - source.y) * Math.max(0, Math.min(1, t));
      const distance = Math.abs(node.y - chordY);
      if (distance < NODE_RADIUS + CLEARANCE) {
        score += 220 + (NODE_RADIUS + CLEARANCE - distance) * 18;
      }
    }
  }

  // Chord crossings are a cheap proxy during lane search. Exact routed-curve
  // crossings are evaluated for the small set of finalist layouts.
  for (let first = 0; first < valid.length; first += 1) {
    const a = valid[first];
    const aSource = byId.get(a.source)!;
    const aTarget = byId.get(a.target)!;
    for (let second = first + 1; second < valid.length; second += 1) {
      const b = valid[second];
      if (
        a.source === b.source || a.source === b.target
        || a.target === b.source || a.target === b.target
      ) continue;
      if (properIntersection(aSource, aTarget, byId.get(b.source)!, byId.get(b.target)!)) score += 900;
    }
  }

  // Soft separation for nodes that share a lane and are horizontal neighbors.
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (nodes[i].y !== nodes[j].y) continue;
      const dx = Math.abs(nodes[i].x - nodes[j].x);
      if (dx > 0 && dx < HORIZONTAL_STEP * 1.1) score += 12;
    }
  }
  return score;
}

function hash(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Places nodes on a fixed left-to-right order (caller supplies date-sorted ids).
 * Only vertical lanes are optimized; X is strictly monotonic with input order.
 */
export function layoutDependencyNodes(
  nodeIds: string[],
  edges: DependencyLayoutEdge[],
  laneCountOverride?: number,
): DependencyNodeLayout {
  if (!nodeIds.length) return { nodes: [], width: 1000 };
  const edgeCount = edges.filter((edge) => edge.source !== edge.target).length;
  const density = edgeCount / Math.max(1, nodeIds.length);
  const defaultLaneCount = Math.max(1, Math.min(8, Math.ceil(nodeIds.length / 4) + (density > 1 ? 1 : 0)));
  const laneCount = Math.max(1, Math.min(MAX_LANES, laneCountOverride ?? defaultLaneCount));
  const width = Math.max(1000, 100 + Math.max(0, nodeIds.length - 1) * HORIZONTAL_STEP);
  const degrees = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    if (degrees.has(edge.source)) degrees.set(edge.source, degrees.get(edge.source)! + 1);
    if (degrees.has(edge.target)) degrees.set(edge.target, degrees.get(edge.target)! + 1);
  }
  const neighbors = neighborsOf(nodeIds, edges);
  const optimizationOrder = nodeIds.map((_, index) => index)
    .sort((a, b) => degrees.get(nodeIds[b])! - degrees.get(nodeIds[a])! || a - b);

  const makeNodes = (lanes: number[]) => nodeIds.map((id, index) => ({
    id,
    x: nodeIds.length === 1 ? width / 2 : 50 + index * HORIZONTAL_STEP,
    y: 70 + lanes[index] * LANE_GAP,
  }));

  const seeds = Array.from({ length: LAYOUT_SEEDS }, (_, seed) => {
    if (seed === 0) {
      // Barycenter-ish seed: place left-to-right near the median of already placed neighbors.
      const lanes = nodeIds.map(() => 0);
      nodeIds.forEach((id, index) => {
        const placed = neighbors.get(id)!
          .map((other) => nodeIds.indexOf(other))
          .filter((otherIndex) => otherIndex >= 0 && otherIndex < index)
          .map((otherIndex) => lanes[otherIndex]);
        if (placed.length) {
          lanes[index] = Math.max(0, Math.min(laneCount - 1, Math.round(median(placed))));
        } else {
          lanes[index] = index % Math.min(3, laneCount);
        }
      });
      return lanes;
    }
    if (seed === 1) return nodeIds.map((_, index) => index % laneCount);
    return nodeIds.map((id) => hash(id) % laneCount);
  });

  const improve = (initial: number[]) => {
    const lanes = [...initial];
    for (let pass = 0; pass < IMPROVEMENT_PASSES; pass += 1) {
      for (const nodeIndex of optimizationOrder) {
        // Prefer lanes near the barycenter of graph neighbors.
        const neighborLanes = neighbors.get(nodeIds[nodeIndex])!
          .map((id) => lanes[nodeIds.indexOf(id)])
          .filter((lane) => Number.isFinite(lane));
        const focus = neighborLanes.length ? median(neighborLanes) : lanes[nodeIndex];
        const laneOrder = Array.from({ length: laneCount }, (_, lane) => lane)
          .sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus) || a - b);

        let chosenLane = lanes[nodeIndex];
        let chosenScore = Infinity;
        for (const lane of laneOrder) {
          lanes[nodeIndex] = lane;
          const score = layoutScore(makeNodes(lanes), edges);
          // Tiny bias toward the neighbor median when scores tie.
          const biased = score + Math.abs(lane - focus) * .01;
          if (biased < chosenScore) {
            chosenScore = biased;
            chosenLane = lane;
          }
        }
        lanes[nodeIndex] = chosenLane;
      }
    }

    // Explicit barycenter sweeps: snap each node toward the median of its neighbors
    // when that does not worsen the global score (smooths short chains).
    for (let pass = 0; pass < BARYCENTER_PASSES; pass += 1) {
      for (const nodeIndex of optimizationOrder) {
        const neighborLanes = neighbors.get(nodeIds[nodeIndex])!
          .map((id) => lanes[nodeIds.indexOf(id)])
          .filter((lane) => Number.isFinite(lane));
        if (!neighborLanes.length) continue;
        const targetLane = Math.max(0, Math.min(laneCount - 1, Math.round(median(neighborLanes))));
        if (targetLane === lanes[nodeIndex]) continue;
        const before = layoutScore(makeNodes(lanes), edges);
        const previous = lanes[nodeIndex];
        lanes[nodeIndex] = targetLane;
        const after = layoutScore(makeNodes(lanes), edges);
        if (after > before + 1) lanes[nodeIndex] = previous;
      }
    }
    return lanes;
  };

  let bestLanes = seeds[0];
  let bestScore = Infinity;
  for (const seed of seeds) {
    const lanes = improve(seed);
    const score = layoutScore(makeNodes(lanes), edges);
    if (score < bestScore) {
      bestScore = score;
      bestLanes = [...lanes];
    }
  }

  const minLane = Math.min(...bestLanes);
  return { nodes: makeNodes(bestLanes.map((lane) => lane - minLane)), width };
}

function routePairCrosses(
  first: Array<[Point, Point, Point, Point]>,
  second: Array<[Point, Point, Point, Point]>,
): boolean {
  const a = routePairSamples(first);
  const b = routePairSamples(second);
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (properIntersection(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

/** Number of non-incident route pairs with at least one proper crossing. */
export function countRouteCrossings(routes: RoutedDependencyEdge[]): number {
  let crossings = 0;
  for (let first = 0; first < routes.length; first += 1) {
    for (let second = first + 1; second < routes.length; second += 1) {
      const a = routes[first];
      const b = routes[second];
      if (
        a.source === b.source || a.source === b.target
        || a.target === b.source || a.target === b.target
      ) continue;
      if (routePairCrosses(a.segments, b.segments)) crossings += 1;
    }
  }
  return crossings;
}

function dateKeyValue(dateKey: string | null): string {
  return dateKey ?? "\uffff";
}

function sameDateTopologicalRanks(
  inputNodes: DependencyLayoutInputNode[],
  edges: DependencyLayoutEdge[],
): Map<string, number> {
  const dates = new Map(inputNodes.map((node) => [node.id, dateKeyValue(node.dateKey)]));
  const ranks = new Map(inputNodes.map((node) => [node.id, 0]));
  const dateGroups = new Map<string, string[]>();
  for (const node of inputNodes) {
    const date = dates.get(node.id)!;
    dateGroups.set(date, [...(dateGroups.get(date) ?? []), node.id]);
  }

  for (const ids of dateGroups.values()) {
    const inGroup = new Set(ids);
    const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
    const indegree = new Map(ids.map((id) => [id, 0]));
    for (const edge of edges) {
      if (!inGroup.has(edge.source) || !inGroup.has(edge.target) || edge.source === edge.target) continue;
      outgoing.get(edge.source)!.push(edge.target);
      indegree.set(edge.target, indegree.get(edge.target)! + 1);
    }
    for (const targets of outgoing.values()) targets.sort();
    const ready = ids.filter((id) => indegree.get(id) === 0).sort();
    while (ready.length) {
      const id = ready.shift()!;
      for (const target of outgoing.get(id)!) {
        ranks.set(target, Math.max(ranks.get(target)!, ranks.get(id)! + 1));
        indegree.set(target, indegree.get(target)! - 1);
        if (indegree.get(target) === 0) {
          ready.push(target);
          ready.sort();
        }
      }
    }
    // A same-date cycle has no fully rightward ordering. The existing cycle alert
    // remains the user-facing signal; deterministic ID order handles its SCC here.
  }
  return ranks;
}

function sameDateOrders(inputNodes: DependencyLayoutInputNode[], edges: DependencyLayoutEdge[]): string[][] {
  const ranks = sameDateTopologicalRanks(inputNodes, edges);
  const canonical = [...inputNodes]
    .sort((a, b) => dateKeyValue(a.dateKey).localeCompare(dateKeyValue(b.dateKey))
      || ranks.get(a.id)! - ranks.get(b.id)!
      || a.id.localeCompare(b.id))
    .map(({ id }) => id);
  const dates = new Map(inputNodes.map((node) => [node.id, dateKeyValue(node.dateKey)]));
  const neighbors = neighborsOf(canonical, edges);
  const refined = [...canonical];

  // Alternating barycentric sweeps refine only equal-date buckets. Neighbor lists
  // are sorted so relation input order cannot affect tie-breaking.
  for (let pass = 0; pass < 4; pass += 1) {
    const positions = new Map(refined.map((id, index) => [id, index]));
    const groups: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < refined.length;) {
      let end = start + 1;
      while (end < refined.length && dates.get(refined[end]) === dates.get(refined[start])) end += 1;
      groups.push({ start, end });
      start = end;
    }
    if (pass % 2) groups.reverse();
    for (const { start, end } of groups) {
      const ordered = refined.slice(start, end).map((id) => {
        const adjacent = [...(neighbors.get(id) ?? [])]
          .sort()
          .map((neighbor) => positions.get(neighbor))
          .filter((position): position is number => position !== undefined);
        return { id, rank: ranks.get(id)!, focus: adjacent.length ? median(adjacent) : positions.get(id)! };
      });
      ordered.sort((a, b) => a.rank - b.rank || a.focus - b.focus || a.id.localeCompare(b.id));
      refined.splice(start, end - start, ...ordered.map(({ id }) => id));
    }
  }

  return refined.every((id, index) => id === canonical[index]) ? [canonical] : [canonical, refined];
}

function graphLayoutScore(
  nodes: DependencyLayoutNode[],
  edges: DependencyLayoutEdge[],
  routes: RoutedDependencyEdge[],
  radius: number,
): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let score = layoutScore(nodes, edges);
  const ys = nodes.map(({ y }) => y);
  score += (Math.max(...ys) - Math.min(...ys)) * 1.5;

  for (const route of routes) {
    const source = byId.get(route.source)!;
    const target = byId.get(route.target)!;
    score += scoreRoute(route.segments, nodes, source, target, radius);
  }
  for (let first = 0; first < routes.length; first += 1) {
    for (let second = first + 1; second < routes.length; second += 1) {
      const a = routes[first];
      const b = routes[second];
      if (
        a.source === b.source || a.source === b.target
        || a.target === b.source || a.target === b.target
      ) continue;
      score += routePairCost(a.segments, b.segments);
    }
  }
  return score;
}

function refineConflictedNodes(
  original: DependencyLayoutNode[],
  edges: DependencyLayoutEdge[],
  routes: RoutedDependencyEdge[],
  dates: Map<string, string>,
  ranks: Map<string, number>,
  maximumLanes: number,
): DependencyLayoutNode[] | null {
  const conflicted = new Set<string>();
  for (let first = 0; first < routes.length; first += 1) {
    for (let second = first + 1; second < routes.length; second += 1) {
      const a = routes[first];
      const b = routes[second];
      if (
        a.source === b.source || a.source === b.target
        || a.target === b.source || a.target === b.target
      ) continue;
      if (routePairCrosses(a.segments, b.segments)) {
        conflicted.add(a.source); conflicted.add(a.target);
        conflicted.add(b.source); conflicted.add(b.target);
      }
    }
  }
  if (!conflicted.size) return null;

  const nodes = original.map((node) => ({ ...node }));
  let currentScore = layoutScore(nodes, edges);
  let changed = false;
  for (const node of nodes.filter(({ id }) => conflicted.has(id)).sort((a, b) => a.id.localeCompare(b.id))) {
    const originalY = node.y;
    let bestY = originalY;
    let bestScore = currentScore;
    for (const y of [originalY - LANE_GAP, originalY + LANE_GAP]) {
      if (y < 70 || y > 70 + (maximumLanes - 1) * LANE_GAP) continue;
      node.y = y;
      const score = layoutScore(nodes, edges);
      if (score < bestScore - 1) {
        bestScore = score;
        bestY = y;
      }
    }
    node.y = bestY;
    if (bestY !== originalY) changed = true;
    currentScore = bestScore;
  }

  const xOrder = [...nodes].sort((a, b) => a.x - b.x);
  for (let index = 0; index < xOrder.length - 1; index += 1) {
    const first = xOrder[index];
    const second = xOrder[index + 1];
    if (dates.get(first.id) !== dates.get(second.id)) continue;
    if (ranks.get(first.id) !== ranks.get(second.id)) continue;
    if (!conflicted.has(first.id) && !conflicted.has(second.id)) continue;
    [first.x, second.x] = [second.x, first.x];
    const score = layoutScore(nodes, edges);
    if (score < currentScore - 1) {
      currentScore = score;
      changed = true;
      [xOrder[index], xOrder[index + 1]] = [second, first];
    } else {
      [first.x, second.x] = [second.x, first.x];
    }
  }
  return changed ? nodes : null;
}

/**
 * Joint date-aware layout. It explores bounded same-date orders and lane counts,
 * then judges finalists using the actual globally routed curves.
 */
export function layoutDependencyGraph(
  inputNodes: DependencyLayoutInputNode[],
  inputEdges: DependencyLayoutEdge[],
  radius = NODE_RADIUS,
): DependencyGraphLayout {
  if (!inputNodes.length) return { nodes: [], routes: [], width: 1000, minY: 0, maxY: 220 };
  const nodeIds = new Set(inputNodes.map(({ id }) => id));
  const edges = inputEdges.filter((edge) => edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const edgeCount = edges.length;
  const density = edgeCount / Math.max(1, inputNodes.length);
  const baseLanes = Math.max(1, Math.min(8, Math.ceil(inputNodes.length / 4) + (density > 1 ? 1 : 0)));
  const maximumLanes = Math.min(MAX_LANES, baseLanes + EXTRA_LANES);
  const placements: Array<{ layout: DependencyNodeLayout; proxyScore: number; key: string }> = [];

  for (const order of sameDateOrders(inputNodes, edges)) {
    for (let lanes = baseLanes; lanes <= maximumLanes; lanes += 1) {
      const layout = layoutDependencyNodes(order, edges, lanes);
      placements.push({
        layout,
        proxyScore: layoutScore(layout.nodes, edges) + (lanes - baseLanes) * LANE_GAP * 1.5,
        key: `${order.join("\u0000")}\u0001${lanes}`,
      });
    }
  }

  placements.sort((a, b) => a.proxyScore - b.proxyScore || a.key.localeCompare(b.key));
  let best: DependencyGraphLayout | null = null;
  let bestScore = Infinity;
  for (const { layout } of placements.slice(0, 2)) {
    const routed = routeDependencyEdges(layout.nodes, edges, radius);
    const score = graphLayoutScore(layout.nodes, edges, routed.routes, radius);
    if (score < bestScore) {
      bestScore = score;
      best = { ...layout, ...routed };
    }
  }


  const dates = new Map(inputNodes.map((node) => [node.id, dateKeyValue(node.dateKey)]));
  const ranks = sameDateTopologicalRanks(inputNodes, edges);
  const refinedNodes = refineConflictedNodes(best!.nodes, edges, best!.routes, dates, ranks, maximumLanes);
  if (refinedNodes) {
    const routed = routeDependencyEdges(refinedNodes, edges, radius);
    const score = graphLayoutScore(refinedNodes, edges, routed.routes, radius);
    if (score < bestScore) best = { nodes: refinedNodes, width: best!.width, ...routed };
  }
  return best!;
}
