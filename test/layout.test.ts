import { describe, expect, it } from "vitest";
import { buildLaneLayout } from "../src/layout.js";
import type { LearningNode } from "../src/types.js";

function node(id: string, parentNodeId: string | null, createdAt: string): LearningNode {
  return {
    id,
    parentNodeId,
    threadId: `thread-${id}`,
    turnId: id,
    title: id,
    runtimeState: "completed",
    collapsed: false,
    navigationExact: true,
    waitingBranchCount: 0,
    containingThreadIds: [`thread-${id}`],
    terminalThreadIds: [`thread-${id}`],
    createdAt,
    updatedAt: createdAt,
  };
}

describe("buildLaneLayout", () => {
  it("treats same-depth branches equally and spans ancestors across leaves", () => {
    const layout = buildLaneLayout([
      node("root", null, "2026-01-01T00:00:00Z"),
      node("a", "root", "2026-01-01T00:00:01Z"),
      node("b", "root", "2026-01-01T00:00:02Z"),
      node("a1", "a", "2026-01-01T00:00:03Z"),
      node("a2", "a", "2026-01-01T00:00:04Z"),
      node("b1", "b", "2026-01-01T00:00:05Z"),
    ]);

    expect(layout.laneCount).toBe(3);
    expect(layout.rows[0]?.[0]).toMatchObject({ lane: 0, columnSpan: 3 });
    expect(layout.rows[1]?.[0]).toMatchObject({ node: { id: "a" }, columnSpan: 2 });
    expect(layout.rows[1]?.[2]).toMatchObject({ node: { id: "b" }, columnSpan: 1 });
    expect(layout.rows[2]?.map((placement) => placement?.node.id)).toEqual(["a1", "a2", "b1"]);
    expect(layout.laneKeys).toEqual(["a1", "a2", "b1"]);
  });

  it("uses a collapsed node as one leaf lane", () => {
    const root = { ...node("root", null, "1"), collapsed: true };
    const layout = buildLaneLayout([root, node("child", "root", "2")]);
    expect(layout.laneCount).toBe(1);
    expect(layout.rows).toHaveLength(1);
    expect(layout.laneKeys).toEqual(["root"]);
  });
});
