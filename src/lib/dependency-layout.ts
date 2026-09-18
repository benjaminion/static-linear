/**
 * Calendar-constrained layered drawing. Long edges participate in placement as
 * virtual vertices, so ordering reserves their corridors before curves are drawn.
 * All routes use the same monotone cubic Hermite spline; there are no rail paths.
 * Nothing in this module is needed in the browser.
 */
export interface DependencyLayoutNode { id: string; x: number; y: number }
export interface DependencyLayoutInputNode { id: string; dateKey: string | null }
export interface DependencyLayoutEdge { source: string; target: string }
interface Point { x: number; y: number }
type Cubic = [Point, Point, Point, Point];
export interface RoutedDependencyEdge extends DependencyLayoutEdge { d: string; segments: Cubic[] }
export interface DependencyLayout { routes: RoutedDependencyEdge[]; minY: number; maxY: number }
export interface DependencyNodeLayout { nodes: DependencyLayoutNode[]; width: number }
export interface DependencyGraphLayout extends DependencyLayout, DependencyNodeLayout {}

const RADIUS = 28;
const CLEARANCE = 10;
const COLUMN = 150;
const PAD = 70;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const edgeKey = (e: DependencyLayoutEdge) => JSON.stringify([e.source, e.target]);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function cubicPoint([a, b, c, d]: Cubic, t: number): Point {
  const s = 1 - t;
  return { x: s ** 3 * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t ** 3 * d.x,
    y: s ** 3 * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t ** 3 * d.y };
}

function pointSegment(p: Point, a: Point, b: Point): number {
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length)) : 0;
  return distance(p, mix(a, b, t));
}

/** Adaptive subdivision bounds the error even on long, sharply bending curves. */
function flatten(segments: Cubic[], tolerance = 0.3): Point[] {
  const points: Point[] = [];
  function visit(s: Cubic, depth: number) {
    const [a, b, c, d] = s;
    if (depth >= 14 || Math.max(pointSegment(b, a, d), pointSegment(c, a, d)) <= tolerance) { points.push(d); return; }
    const ab = mix(a, b, .5), bc = mix(b, c, .5), cd = mix(c, d, .5);
    const abc = mix(ab, bc, .5), bcd = mix(bc, cd, .5), middle = mix(abc, bcd, .5);
    visit([a, ab, abc, middle], depth + 1);
    visit([middle, bcd, cd, d], depth + 1);
  }
  if (segments.length) points.push(segments[0][0]);
  segments.forEach((s) => visit(s, 0));
  return points;
}

export function routeClearance(segments: Cubic[], nodes: DependencyLayoutNode[], source: string, target: string, radius = RADIUS): number {
  const path = flatten(segments, .15);
  let clearance = Infinity;
  for (const node of nodes) {
    if (node.id === source || node.id === target) continue;
    for (let i = 1; i < path.length; i++) clearance = Math.min(clearance, pointSegment(node, path[i - 1], path[i]) - radius);
  }
  return clearance;
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
    || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  return cross(a, b, c) * cross(a, b, d) < -1e-8 && cross(c, d, a) * cross(c, d, b) < -1e-8;
}

function pathsCross(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (intersects(a[i - 1], a[i], b[j - 1], b[j])) return true;
  }
  return false;
}

export function countRouteCrossings(routes: RoutedDependencyEdge[]): number {
  const paths = routes.map((r) => flatten(r.segments, .15));
  let count = 0;
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) if (pathsCross(paths[i], paths[j])) count++;
  return count;
}

function cleanEdges(ids: Set<string>, edges: DependencyLayoutEdge[]): DependencyLayoutEdge[] {
  return [...new Map(edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => [edgeKey(e), e])).values()]
    .sort((a, b) => compare(edgeKey(a), edgeKey(b)));
}

/** Tarjan components keep same-date cycles in a single column, never an arbitrary backwards ordering. */
function components(ids: string[], edges: DependencyLayoutEdge[]): string[][] {
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) adjacency.get(e.source)?.push(e.target);
  let next = 0;
  const index = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), result: string[][] = [];
  function visit(id: string) {
    index.set(id, next); low.set(id, next++); stack.push(id); active.add(id);
    for (const other of adjacency.get(id) ?? []) {
      if (!index.has(other)) { visit(other); low.set(id, Math.min(low.get(id)!, low.get(other)!)); }
      else if (active.has(other)) low.set(id, Math.min(low.get(id)!, index.get(other)!));
    }
    if (index.get(id) === low.get(id)) {
      const group: string[] = [];
      let other: string;
      do { other = stack.pop()!; active.delete(other); group.push(other); } while (other !== id);
      result.push(group.sort(compare));
    }
  }
  ids.forEach((id) => { if (!index.has(id)) visit(id); });
  return result;
}

function calendarColumns(input: DependencyLayoutInputNode[], edges: DependencyLayoutEdge[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const n of [...input].sort((a, b) => compare(a.id, b.id))) {
    const key = n.dateKey ?? '\uffff';
    groups.set(key, [...(groups.get(key) ?? []), n.id]);
  }
  const columns = new Map<string, number>();
  let offset = 0;
  for (const date of [...groups.keys()].sort(compare)) {
    const ids = groups.get(date)!, set = new Set(ids);
    const local = edges.filter((e) => set.has(e.source) && set.has(e.target));
    const scc = components(ids, local), membership = new Map(scc.flatMap((g, i) => g.map((id) => [id, i] as const)));
    const ranks = scc.map(() => 0);
    // Condensation is acyclic; bounded relaxation computes its longest paths.
    for (let pass = 0; pass < scc.length; pass++) {
      let changed = false;
      for (const e of local) {
        const a = membership.get(e.source)!, b = membership.get(e.target)!;
        if (a !== b && ranks[b] <= ranks[a]) { ranks[b] = ranks[a] + 1; changed = true; }
      }
      if (!changed) break;
    }
    scc.forEach((g, i) => g.forEach((id) => columns.set(id, offset + ranks[i])));
    offset += Math.max(...ranks) + 1;
  }
  return columns;
}

interface Vertex extends Point { id: string; real: boolean; column: number; neighbors: Vertex[] }
interface Placement extends DependencyNodeLayout { guides: Map<string, Point[]> }

function place(input: DependencyLayoutInputNode[], edges: DependencyLayoutEdge[], fixedColumns?: Map<string, number>): Placement {
  if (!input.length) return { nodes: [], width: 140, guides: new Map() };
  const columns = fixedColumns ?? calendarColumns(input, edges);
  const layers: Vertex[][] = Array.from({ length: Math.max(...columns.values()) + 1 }, () => []);
  const vertices = new Map<string, Vertex>();
  for (const n of [...input].sort((a, b) => compare(a.id, b.id))) {
    const column = columns.get(n.id)!;
    const v: Vertex = { id: n.id, real: true, column, x: PAD + column * COLUMN, y: 0, neighbors: [] };
    vertices.set(n.id, v); layers[column].push(v);
  }
  const chains = new Map<string, Vertex[]>();
  for (const e of edges) {
    const a = vertices.get(e.source)!, b = vertices.get(e.target)!;
    const left = a.column <= b.column ? a : b, right = left === a ? b : a;
    const chain = [left];
    for (let column = left.column + 1; column < right.column; column++) {
      const v: Vertex = { id: `edge:${edgeKey(e)}:${column}`, real: false, column, x: PAD + column * COLUMN, y: 0, neighbors: [] };
      layers[column].push(v); chain.push(v);
    }
    chain.push(right);
    for (let i = 1; i < chain.length; i++) { chain[i - 1].neighbors.push(chain[i]); chain[i].neighbors.push(chain[i - 1]); }
    chains.set(edgeKey(e), a === left ? chain : [...chain].reverse());
  }
  // Weak components start together so unrelated chains don't interleave.
  const group = new Map<Vertex, number>();
  let groupId = 0;
  for (const v of vertices.values()) {
    if (group.has(v)) continue;
    const queue = [v]; group.set(v, groupId++);
    for (let i = 0; i < queue.length; i++) for (const n of queue[i].neighbors) {
      if (!group.has(n)) { group.set(n, group.get(v)!); queue.push(n); }
    }
  }
  layers.forEach((layer) => layer.sort((a, b) => group.get(a)! - group.get(b)! || compare(a.id, b.id)));
  const orders = () => new Map(layers.flatMap((layer) => layer.map((v, i) => [v, i] as const)));
  function crossingScore(): number {
    const rank = orders();
    let score = 0;
    for (let c = 0; c < layers.length - 1; c++) {
      const links = layers[c].flatMap((a) => a.neighbors.filter((b) => b.column === c + 1).map((b) => [a, b]));
      for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
        if ((rank.get(links[i][0])! - rank.get(links[j][0])!) * (rank.get(links[i][1])! - rank.get(links[j][1])!) < 0) score++;
      }
    }
    return score;
  }
  let best = layers.map((l) => [...l]), bestScore = crossingScore();
  const initial = layers.map((layer) => [...layer]);
  for (let seed = 0; seed < 8; seed++) {
    initial.forEach((layer, c) => {
      const shift = seed < 4 ? Math.floor(layer.length * seed / 4) : 0;
      layers[c] = [...layer.slice(shift), ...layer.slice(0, shift)];
      if (seed >= 4 && c % 4 === seed - 4) layers[c].reverse();
    });
    for (let sweep = 0; sweep < 12; sweep++) {
      const direction = sweep % 2 ? -1 : 1;
      const sequence = direction === 1 ? layers : [...layers].reverse();
      for (const layer of sequence) {
        const ranks = orders();
        const center = (v: Vertex) => {
          const adjacent = v.neighbors.filter((n) => n.column === v.column - direction);
          return adjacent.length ? adjacent.reduce((sum, n) => sum + ranks.get(n)!, 0) / adjacent.length : ranks.get(v)!;
        };
        layer.sort((a, b) => center(a) - center(b) || ranks.get(a)! - ranks.get(b)!);
      }
      // Adjacent transposition considers both sides, unlike a one-sided sweep.
      for (const layer of layers) for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (let i = 1; i < layer.length; i++) {
          const ranks = orders(), a = layer[i - 1], b = layer[i];
          let delta = 0;
          for (const na of a.neighbors) for (const nb of b.neighbors) {
            if (na.column !== nb.column || na === nb || na.column === a.column) continue;
            delta += ranks.get(na)! < ranks.get(nb)! ? 1 : -1;
          }
          if (delta < 0) { [layer[i - 1], layer[i]] = [b, a]; changed = true; }
        }
        if (!changed) break;
      }
      const score = crossingScore();
      if (score < bestScore) { bestScore = score; best = layers.map((l) => [...l]); }
    }
  }

  best.forEach((layer, c) => { layers[c] = layer; });
  const gap = (a: Vertex, b: Vertex) => (a.real ? 55 : 18) + (b.real ? 55 : 18);
  layers.forEach((layer) => {
    let y = 0;
    layer.forEach((v, i) => { if (i) y += gap(layer[i - 1], v); v.y = y; });
    layer.forEach((v) => { v.y -= y / 2; });
  });
  // Isotonic projection: align neighbors while preserving the chosen order and
  // actual node/edge widths. Virtual vertices need less space than task circles.
  for (let pass = 0; pass < 80; pass++) for (const layer of pass % 2 ? [...layers].reverse() : layers) {
    const offsets = [0];
    for (let i = 1; i < layer.length; i++) offsets[i] = offsets[i - 1] + gap(layer[i - 1], layer[i]);
    const blocks: { start: number; end: number; sum: number; weight: number }[] = [];
    layer.forEach((v, i) => {
      const target = v.neighbors.length ? v.neighbors.reduce((sum, n) => sum + n.y, 0) / v.neighbors.length : v.y;
      const weight = v.real ? 2 : 1;
      blocks.push({ start: i, end: i, sum: ((v.y + target * 3) / 4 - offsets[i]) * weight, weight });
      while (blocks.length > 1) {
        const b = blocks.at(-1)!, a = blocks.at(-2)!;
        if (a.sum / a.weight <= b.sum / b.weight) break;
        blocks.pop(); a.end = b.end; a.sum += b.sum; a.weight += b.weight;
      }
    });
    for (const b of blocks) for (let i = b.start; i <= b.end; i++) layer[i].y = b.sum / b.weight + offsets[i];
  }
  const min = Math.min(...layers.flat().map((v) => v.y));
  layers.flat().forEach((v) => { v.y = Math.round((v.y - min + PAD) * 1000) / 1000; });
  const nodes = [...vertices.values()].map(({ id, x, y }) => ({ id, x, y })).sort((a, b) => a.x - b.x || a.y - b.y || compare(a.id, b.id));
  return { nodes, width: PAD * 2 + (layers.length - 1) * COLUMN,
    guides: new Map([...chains].map(([key, chain]) => [key, chain.map(({ x, y }) => ({ x, y }))])) };
}

/** A single spline family, including detours. Every segment is monotone in X.
 * End tangents define radial ports; incoming arrows cannot reverse direction.
 */
function spline(points: Point[], portOffset = 0, verticalPorts = false, arrivalOffset = -portOffset): Cubic[] {
  const p = points.map((v) => ({ ...v }));
  const slopes = p.slice(1).map((v, i) => (v.y - p[i].y) / (v.x - p[i].x));
  const tangents = p.map((_, i) => i === 0 ? slopes[0] : i === p.length - 1 ? slopes.at(-1)! :
    slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
  tangents[0] += portOffset; tangents[tangents.length - 1] += arrivalOffset;
  if (verticalPorts) { tangents[0] = 0; tangents[tangents.length - 1] = 0; }
  for (const i of [0, p.length - 1]) {
    const sign = i === 0 ? 1 : -1, dx = (RADIUS + 1) / Math.hypot(1, tangents[i]);
    p[i].x += sign * dx; p[i].y += sign * dx * tangents[i];
  }
  return p.slice(1).map((b, i) => {
    const a = p[i], h = (b.x - a.x) / 3;
    return [a, { x: a.x + h, y: a.y + h * tangents[i] }, { x: b.x - h, y: b.y - h * tangents[i + 1] }, b];
  });
}

function route(edge: DependencyLayoutEdge, segments: Cubic[]): RoutedDependencyEdge {
  const number = (v: number) => String(Math.round(v * 1000) / 1000);
  const point = (p: Point) => `${number(p.x)},${number(p.y)}`;
  return { ...edge, segments, d: `M ${point(segments[0][0])}` + segments.map((s) => ` C ${s.slice(1).map(point).join(' ')}`).join('') };
}

interface Candidate { route: RoutedDependencyEdge; path: Point[]; cost: number; guided?: boolean }

function candidates(nodes: DependencyLayoutNode[], edge: DependencyLayoutEdge, guide?: Point[]): Candidate[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
  // Vertical edges (including same-date SCCs) use the identical spline in a
  // rotated coordinate frame. Self loops are isolated smooth cubic loops.
  if (source.id === target.id) {
    const x = source.x, y = source.y;
    const loops: Candidate[] = [];
    for (const size of [64, 96, 144, 216]) for (const side of [1, -1]) {
      const outer = x + side * size;
      const segments: Cubic[] = [
        [{ x, y: y - 29 }, { x, y: y - size }, { x: outer, y: y - size }, { x: outer, y }],
        [{ x: outer, y }, { x: outer, y: y + size }, { x, y: y + size }, { x, y: y + 29 }],
      ];
      if (routeClearance(segments, nodes, edge.source, edge.target) >= CLEARANCE) {
        loops.push({ route: route(edge, segments), path: flatten(segments), cost: size * 4 });
      }
    }
    if (!loops.length) throw new Error('Unable to find a clear dependency loop');
    return loops;
  }
  const vertical = source.x === target.x;
  const transform = (p: Point): Point => vertical ? { x: p.y, y: -p.x } : { x: p.x, y: p.y };
  const restore = (p: Point): Point => vertical ? { x: -p.y, y: p.x } : p;
  const transformed = nodes.map((n) => ({ ...n, ...transform(n) }));
  const a = transform(source), b = transform(target), reverse = a.x > b.x;
  const left = reverse ? b : a, right = reverse ? a : b;
  const span = right.x - left.x;
  const obstacles = transformed.filter((n) => n.id !== source.id && n.id !== target.id && n.x > left.x && n.x < right.x);
  const chord = (x: number) => left.y + (right.y - left.y) * (x - left.x) / span;
  const options: Point[][] = [[left, right]];
  const broadArches = new Set<Point[]>();
  let primaryGuide: Point[] | undefined;
  if (guide && guide.length > 2 && !vertical) {
    const ordered = (reverse ? [...guide].reverse() : guide).map(transform);
    primaryGuide = ordered; options.unshift(ordered);
    for (const shift of [-18, 18, -36, 36]) options.unshift(ordered.map((p, i) =>
      i === 0 || i === ordered.length - 1 ? p : { x: p.x, y: p.y + shift }));
  }
  // Obstacle-column corridors, selected by dynamic programming. Penalties for
  // height and bending favor local deviations, not excursions around the graph.
  const xs = [...new Set(obstacles.map((n) => n.x))].sort((a, b) => a - b);
  for (const bias of [0, -1, 1, -2, 2]) {
    type Step = { p: Point; cost: number; previous?: Step };
    let previous: Step[] = [{ p: left, cost: 0 }];
    for (const x of xs) {
      const at = obstacles.filter((n) => Math.abs(n.x - x) < 1);
      const values = [chord(x), ...at.flatMap((n) => [n.y - 54 - Math.abs(bias) * 12, n.y + 54 + Math.abs(bias) * 12])];
      const ys = [...new Set(values)].filter((y) => at.every((n) => Math.abs(y - n.y) >= 48));
      previous = ys.map((y) => {
        const p = { x, y };
        let best: Step | undefined, cost = Infinity;
        for (const step of previous) {
          const next = step.cost + distance(step.p, p) + Math.abs(y - chord(x)) * .15 + bias * (y - chord(x)) * .12;
          if (next < cost) { cost = next; best = step; }
        }
        return { p, cost, previous: best };
      });
    }
    const last = previous.sort((a, b) => a.cost + distance(a.p, right) - b.cost - distance(b.p, right))[0];
    const points = [right];
    for (let step: Step | undefined = last; step; step = step.previous) points.push(step.p);
    options.push(points.reverse());
  }
  // Smooth arch candidates give competing edges independent corridors. The
  // quarter-span knots let dense spines clear obstacles close to either end.
  const high = Math.min(left.y, right.y, ...obstacles.map((n) => n.y));
  const low = Math.max(left.y, right.y, ...obstacles.map((n) => n.y));
  for (const side of [-1, 1]) for (const height of [48, 80, 120, 180, 260]) {
    const y = side < 0 ? high - height : low + height;
    // Include broad shoulders so a compact detour can still turn gently.
    for (const inset of new Set([Math.min(120, span / 3), Math.min(RADIUS * 8, span / 3)])) {
      const arch = [left, { x: left.x + inset, y }, { x: (left.x + right.x) / 2, y: y + side * height * .15 }, { x: right.x - inset, y }, right];
      options.push(arch);
      if (inset > 120) broadArches.add(arch);
    }
  }
  const result: Candidate[] = [];
  for (const points of options) {
    const ports = (points.length === 2 ? [0, -.3, .3, -.7, .7, -1.2, 1.2, -2, 2, -4, 4] : [0, -.3, .3]).map((v) => [v, -v]);
    if (broadArches.has(points)) ports.push([-1, 1], [1, -1]);
    if (points.length === 2) ports.push(...[-4, -2, -1, 1, 2, 4].flatMap((v) => [[v, 0], [0, v]]));
    for (const [offset, arrival] of ports) {
      let segments = spline(points, offset, vertical, arrival).map((s) => s.map(restore) as Cubic);
      if (reverse) segments = segments.reverse().map(([a, b, c, d]) => [d, c, b, a]);
      const clearance = routeClearance(segments, nodes, edge.source, edge.target);
      if (clearance < CLEARANCE) continue;
      const path = flatten(segments);
      let length = 0, drift = 0, bending = 0;
      for (let i = 1; i < path.length; i++) { length += distance(path[i - 1], path[i]); drift += pointSegment(path[i], source, target); }
      for (let i = 1; i + 1 < path.length; i++) {
        const a = path[i - 1], b = path[i], c = path[i + 1];
        const first = distance(a, b), second = distance(b, c);
        if (first * second > 0) {
          const cosine = Math.max(-1, Math.min(1, ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (first * second)));
          bending += Math.acos(cosine) ** 2 / (first + second);
        }
      }
      // Curvature alone rewards a huge, gentle bow. Charge for its peak
      // excursion beyond the local obstacle envelope as well as mean drift.
      // This is measured in graph units, independent of the edge's X span.
      const localY = path.map((p) => transform(p).y);
      const excursion = Math.max(0, high - CLEARANCE - Math.min(...localY), Math.max(...localY) - low - CLEARANCE);
      result.push({ route: route(edge, segments), path,
        cost: length + drift / path.length * .8 + bending * 16000 + Math.abs(offset) * 8 + excursion ** 2 * .12,
        guided: points === primaryGuide && offset === 0 });
    }
  }
  result.sort((a, b) => a.cost - b.cost);
  if (!result.length) throw new Error('Unable to find a clear dependency route');
  return [...new Map([...result.filter((c) => c.guided), ...result].map((c) => [c.route.d, c])).values()];
}

/** Length of two nearly parallel polylines occupying the same visible corridor. */
function parallelOverlap(a: Point[], b: Point[], threshold: number): number {
  let overlap = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1], q = a[i], length = distance(p, q);
    if (!length) continue;
    const ux = (q.x - p.x) / length, uy = (q.y - p.y) / length;
    for (let j = 1; j < b.length; j++) {
      const r = b[j - 1], s = b[j], otherLength = distance(r, s);
      if (!otherLength) continue;
      const alignment = Math.abs(ux * (s.x - r.x) + uy * (s.y - r.y)) / otherLength;
      if (alignment < .985) continue;
      const rAlong = (r.x - p.x) * ux + (r.y - p.y) * uy;
      const sAlong = (s.x - p.x) * ux + (s.y - p.y) * uy;
      let lo = Math.max(0, Math.min(rAlong, sAlong)), hi = Math.min(length, Math.max(rAlong, sAlong));
      if (hi <= lo) continue;
      const rAway = (r.x - p.x) * uy - (r.y - p.y) * ux;
      const sAway = (s.x - p.x) * uy - (s.y - p.y) * ux;
      const slope = (sAway - rAway) / (sAlong - rAlong);
      if (Math.abs(slope) < 1e-8) { if (Math.abs(rAway) >= threshold) continue; }
      else {
        const first = rAlong + (-threshold - rAway) / slope;
        const last = rAlong + (threshold - rAway) / slope;
        lo = Math.max(lo, Math.min(first, last)); hi = Math.min(hi, Math.max(first, last));
      }
      overlap += Math.max(0, hi - lo);
    }
  }
  return overlap;
}

function pairCost(a: Candidate, b: Candidate): number {
  const overlap = parallelOverlap(a.path, b.path, 8);
  const coincident = overlap > 12 ? parallelOverlap(a.path, b.path, 2) : 0;
  const incident = a.route.source === b.route.source || a.route.target === b.route.target
    || a.route.source === b.route.target || a.route.target === b.route.source;
  return (pathsCross(a.path, b.path) ? (incident ? 400000 : 100000) : 0)
    + overlap * 200 + Math.max(0, coincident - 12) * 100000;
}

function routed(nodes: DependencyLayoutNode[], edges: DependencyLayoutEdge[], guides?: Map<string, Point[]>): DependencyLayout {
  const options = edges.map((e) => candidates(nodes, e, guides?.get(edgeKey(e))));
  let selection = options.map(() => 0);
  const pairCache = new Map<string, number>();
  const pair = (i: number, a: number, j: number, b: number) => {
    if (i > j) return pair(j, b, i, a);
    const key = `${i}:${a}:${j}:${b}`;
    let value = pairCache.get(key);
    if (value === undefined) { value = pairCost(options[i][a], options[j][b]); pairCache.set(key, value); }
    return value;
  };
  let bestSelection = [...selection], bestTotal = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    selection = options.map(() => 0);
    const order = edges.map((_, i) => i);
    if (attempt === 1) order.reverse();
    if (attempt === 2) order.sort((a, b) => options[b][0].cost - options[a][0].cost || a - b);
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let k = 0; k < edges.length; k++) {
        const i = order[pass % 2 ? edges.length - k - 1 : k];
        let best = selection[i], bestCost = Infinity;
        for (let c = 0; c < options[i].length; c++) {
          let cost = options[i][c].cost;
          for (let j = 0; j < edges.length && cost < bestCost; j++) if (i !== j) cost += pair(i, c, j, selection[j]);
          if (cost < bestCost - 1e-6) { best = c; bestCost = cost; }
        }
        if (best !== selection[i]) { selection[i] = best; changed = true; }
      }
      if (!changed) break;
    }
    // A fan-out can be trapped if moving either route alone adds a crossing.
    // Jointly reconsider only conflicting pairs, with a fixed two-pass budget.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
        if (pair(i, selection[i], j, selection[j]) < 10000) continue;
        const external = (index: number, option: number, other: number) => {
          let cost = options[index][option].cost;
          for (let k = 0; k < edges.length; k++) if (k !== index && k !== other) cost += pair(index, option, k, selection[k]);
          return cost;
        };
        const aCosts = options[i].map((_, c) => external(i, c, j));
        const bCosts = options[j].map((_, c) => external(j, c, i));
        let best = aCosts[selection[i]] + bCosts[selection[j]] + pair(i, selection[i], j, selection[j]);
        let aBest = selection[i], bBest = selection[j];
        for (let a = 0; a < aCosts.length; a++) for (let b = 0; b < bCosts.length; b++) {
          if (aCosts[a] + bCosts[b] >= best) continue;
          const cost = aCosts[a] + bCosts[b] + pair(i, a, j, b);
          if (cost < best - 1e-6) { best = cost; aBest = a; bBest = b; }
        }
        selection[i] = aBest; selection[j] = bBest;
      }
    }
    let total = options.reduce((sum, c, i) => sum + c[selection[i]].cost, 0);
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) total += pair(i, selection[i], j, selection[j]);
    if (total < bestTotal) { bestTotal = total; bestSelection = [...selection]; }
  }
  selection = bestSelection;
  const routes = options.map((c, i) => c[selection[i]].route);
  const points = [...nodes, ...routes.flatMap((r) => flatten(r.segments))];
  return { routes, minY: Math.min(0, ...points.map((p) => p.y - PAD)), maxY: Math.max(140, ...points.map((p) => p.y + PAD)) };
}

export function routeDependencyEdges(nodes: DependencyLayoutNode[], edges: DependencyLayoutEdge[]): DependencyLayout {
  return routed(nodes, cleanEdges(new Set(nodes.map((n) => n.id)), edges));
}

/** Legacy entry point: callers supplying just IDs explicitly prescribe X order. */
export function layoutDependencyNodes(ids: string[], edges: DependencyLayoutEdge[]): DependencyNodeLayout {
  const valid = cleanEdges(new Set(ids), edges);
  const { nodes, width } = place(ids.map((id) => ({ id, dateKey: null })), valid, new Map(ids.map((id, i) => [id, i])));
  return { nodes, width };
}

export function layoutDependencyGraph(input: DependencyLayoutInputNode[], edges: DependencyLayoutEdge[]): DependencyGraphLayout {
  const unique = [...new Map(input.map((n) => [n.id, n])).values()];
  const valid = cleanEdges(new Set(unique.map((n) => n.id)), edges);
  const { nodes, width, guides } = place(unique, valid);
  const layout = routed(nodes, valid, guides);
  const points = [...nodes, ...layout.routes.flatMap((r) => flatten(r.segments))];
  const minX = Math.min(PAD, ...points.map((p) => p.x));
  const shift = Math.max(0, PAD - minX);
  const maxX = Math.max(width - PAD, ...points.map((p) => p.x));
  if (shift) {
    nodes.forEach((n) => { n.x += shift; });
    layout.routes = layout.routes.map((r) => route(r, r.segments.map((s) => s.map((p) => ({ x: p.x + shift, y: p.y })) as Cubic)));
  }
  return { nodes, width: maxX + shift + PAD, ...layout };
}
