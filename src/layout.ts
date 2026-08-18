import type { LaneLayout, LanePlacement, LearningNode } from "./types.js";

function compareNodes(left: LearningNode, right: LearningNode): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function buildLaneLayout(nodes: ReadonlyArray<LearningNode>): LaneLayout {
  if (nodes.length === 0) return { rows: [], laneCount: 0, laneKeys: [] };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, LearningNode[]>();
  for (const node of nodes) {
    if (node.parentNodeId === null || !nodeById.has(node.parentNodeId)) continue;
    const children = childrenByParent.get(node.parentNodeId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentNodeId, children);
  }
  for (const children of childrenByParent.values()) children.sort(compareNodes);

  const roots = nodes
    .filter((node) => node.parentNodeId === null || !nodeById.has(node.parentNodeId))
    .sort(compareNodes);
  const visibleChildren = (node: LearningNode): ReadonlyArray<LearningNode> =>
    node.collapsed ? [] : (childrenByParent.get(node.id) ?? []);

  const spanByNodeId = new Map<string, number>();
  const measuring = new Set<string>();
  const measureSubtree = (node: LearningNode): number => {
    const cached = spanByNodeId.get(node.id);
    if (cached !== undefined) return cached;
    if (measuring.has(node.id)) return 1;
    measuring.add(node.id);
    const children = visibleChildren(node);
    const span = Math.max(
      1,
      children.reduce((total, child) => total + measureSubtree(child), 0),
    );
    measuring.delete(node.id);
    spanByNodeId.set(node.id, span);
    return span;
  };

  const placementsByDepth: LanePlacement[][] = [];
  const leafKeys: string[] = [];
  const visited = new Set<string>();
  const placeSubtree = (node: LearningNode, depth: number, lane: number): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    (placementsByDepth[depth] ??= []).push({
      node,
      depth,
      lane,
      columnSpan: measureSubtree(node),
    });
    const children = visibleChildren(node);
    if (children.length === 0) leafKeys[lane] = node.id;
    let childLane = lane;
    for (const child of children) {
      placeSubtree(child, depth + 1, childLane);
      childLane += measureSubtree(child);
    }
  };

  let laneCount = 0;
  for (const root of roots) {
    placeSubtree(root, 0, laneCount);
    laneCount += measureSubtree(root);
  }
  if (roots.length === 0) {
    const fallback = [...nodes].sort(compareNodes)[0];
    if (fallback) {
      placeSubtree(fallback, 0, 0);
      laneCount = measureSubtree(fallback);
    }
  }

  const rows = placementsByDepth.map((placements) => {
    const row: Array<LanePlacement | null> = Array.from({ length: laneCount }, () => null);
    for (const placement of placements) row[placement.lane] = placement;
    return row;
  });
  return {
    rows,
    laneCount,
    laneKeys: Array.from({ length: laneCount }, (_, lane) => leafKeys[lane] ?? `lane-${lane}`),
  };
}
