export type DependencyViewMode = "all" | "dependent" | "inflight";

export function dependencyViewKey(mode: DependencyViewMode): string {
  return mode;
}

export interface DependencyViewNode {
  id: string;
  projectId: string | null;
  statusType: string | null;
}

export interface DependencyViewEdge {
  source: string;
  target: string;
}

export function dependencyNodeMatchesProject(node: DependencyViewNode, projectId = ""): boolean {
  return !projectId || node.projectId === projectId;
}

export function dependencyEdgeTouchesProject(
  edge: DependencyViewEdge,
  nodes: Map<string, DependencyViewNode>,
  projectId = "",
): boolean {
  if (!projectId) return true;
  return nodes.get(edge.source)?.projectId === projectId || nodes.get(edge.target)?.projectId === projectId;
}

export function dependencyEdgeCrossesProject(
  edge: DependencyViewEdge,
  nodes: Map<string, DependencyViewNode>,
  projectId = "",
): boolean {
  if (!projectId) return false;
  const sourceMatches = nodes.get(edge.source)?.projectId === projectId;
  const targetMatches = nodes.get(edge.target)?.projectId === projectId;
  return sourceMatches !== targetMatches;
}

export function filterDependencyView<
  Node extends DependencyViewNode,
  Edge extends DependencyViewEdge,
>(
  allNodes: Node[],
  allEdges: Edge[],
  mode: DependencyViewMode,
  projectId = "",
): { nodes: Node[]; edges: Edge[] } {
  const issueIds = new Set(allNodes.filter((node) => node.projectId !== null).map((node) => node.id));
  const relationIds = new Set(allEdges.flatMap((edge) => [edge.source, edge.target]));
  const selectedProjectIds = new Set(
    allNodes
      .filter((node) => node.projectId !== null && (!projectId || node.projectId === projectId))
      .map((node) => node.id),
  );

  let visibleIds = mode === "all"
    ? new Set(selectedProjectIds)
    : new Set([...selectedProjectIds].filter((id) => relationIds.has(id)));

  const projectEdges = projectId
    ? allEdges.filter((edge) => selectedProjectIds.has(edge.source) || selectedProjectIds.has(edge.target))
    : allEdges;
  for (const edge of projectEdges) {
    visibleIds.add(edge.source);
    visibleIds.add(edge.target);
  }

  if (!projectId && mode === "all") {
    for (const node of allNodes) {
      if (issueIds.has(node.id) || relationIds.has(node.id)) visibleIds.add(node.id);
    }
  }

  if (mode === "inflight") {
    for (const node of allNodes) {
      if (isDone(node.statusType)) visibleIds.delete(node.id);
    }
  }

  const edges = projectEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  if (mode === "inflight") {
    const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    visibleIds = new Set([...visibleIds].filter((id) => connectedIds.has(id)));
  }

  return {
    nodes: allNodes.filter((node) => visibleIds.has(node.id)),
    edges,
  };
}

function isDone(statusType: string | null): boolean {
  const type = (statusType ?? "").toLowerCase();
  return type === "completed" || type === "canceled";
}
