import { describe, expect, it } from "vitest";
import {
  defaultDocument,
  extractAnswerPreview,
  extractQuestionMarkdown,
  findForkBaseTurnId,
  frozenNodeRootMap,
  normalizeDocument,
  subtreeNodeIds,
  toggleFrozenRoot,
  turnAfterBase,
  UndoHistory,
} from "../src/model.js";
import type { CodexThreadSnapshot, LearningNode } from "../src/types.js";

function node(id: string, parentNodeId: string | null): LearningNode {
  return {
    id,
    parentNodeId,
    threadId: id,
    turnId: id,
    title: id,
    runtimeState: "completed",
    collapsed: false,
    navigationExact: true,
    waitingBranchCount: 0,
    containingThreadIds: [id],
    terminalThreadIds: [id],
    createdAt: id,
    updatedAt: id,
  };
}

function snapshot(id: string, turnIds: ReadonlyArray<string>): CodexThreadSnapshot {
  return {
    id,
    name: null,
    preview: null,
    cwd: "F:/tree",
    sessionId: null,
    forkedFromId: null,
    createdAt: null,
    updatedAt: null,
    status: null,
    turns: turnIds.map((turnId) => ({ id: turnId, status: "completed", items: [], raw: {} })),
  };
}

describe("learning model", () => {
  it("deletes a complete subtree without touching siblings", () => {
    const nodes = [node("root", null), node("a", "root"), node("a1", "a"), node("b", "root")];
    expect([...subtreeNodeIds(nodes, "a")].sort()).toEqual(["a", "a1"]);
  });

  it("keeps undo and redo in memory", () => {
    const history = new UndoHistory();
    const first = defaultDocument("file:///workspace");
    const second = { ...first, nodes: [node("root", null)] };
    history.record(first);
    expect(history.undo(second)?.nodes).toHaveLength(0);
    expect(history.redo(first)?.nodes).toHaveLength(1);
  });

  it("finds the exact shared turn used by an official fork", () => {
    const parent = snapshot("parent", ["t1", "t2", "t3"]);
    const child = snapshot("child", ["t1", "t2", "branch-turn"]);
    expect(findForkBaseTurnId(parent, child)).toBe("t2");
    expect(turnAfterBase(child, "t2")?.id).toBe("branch-turn");
  });

  it("migrates task-level v2 data and rebuilds turn nodes on sync", () => {
    const legacy = {
      id: "legacy-node",
      parentNodeId: null,
      threadId: "root-thread",
      turnId: "last-turn",
    };
    const normalized = normalizeDocument(
      {
        schemaVersion: 2,
        rootThreadId: "root-thread",
        nodes: [legacy],
        preferences: {
          textMode: "unexpected",
          defaultColumnWidth: 99_999,
          defaultRowHeight: -1,
          columnWidths: { root: 1 },
          rowHeights: { "0": 9999 },
        },
      },
      "file:///workspace",
    );
    expect(normalized.schemaVersion).toBe(7);
    expect(normalized.rootThreadId).toBe("root-thread");
    expect(normalized.preferences.defaultColumnWidth).toBe(520);
    expect(normalized.preferences.defaultRowHeight).toBe(64);
    expect(normalized.nodes).toEqual([]);
    expect(normalized.hiddenTurnIds).toEqual([]);
    expect(normalized.frozenRootNodeIds).toEqual([]);
    expect(normalized.temporaryForks).toEqual([]);
    expect(normalized.nodeActivity).toEqual({});
  });

  it("migrates v3 question nodes without rebuilding them", () => {
    const normalized = normalizeDocument(
      {
        schemaVersion: 3,
        rootThreadId: "root-thread",
        hiddenTurnIds: [],
        nodes: [node("turn-1", null)],
        preferences: defaultDocument("file:///workspace").preferences,
      },
      "file:///workspace",
    );
    expect(normalized).toMatchObject({
      schemaVersion: 7,
      rootThreadId: "root-thread",
      temporaryForks: [],
      nodeActivity: {},
      frozenRootNodeIds: [],
    });
    expect(normalized.nodes).toHaveLength(1);
  });

  it("restores font and table scale plus access activity from stored data", () => {
    const normalized = normalizeDocument(
      {
        ...defaultDocument("file:///old"),
        preferences: { ...defaultDocument("file:///old").preferences, fontScale: 1.37 },
        nodeActivity: {
          root: { visitCount: 4.9, lastVisitedAt: "2026-08-18T00:00:00.000Z" },
        },
      },
      "file:///workspace",
    );
    expect(normalized.preferences.fontScale).toBe(1.4);
    expect(normalized.preferences.tableScale).toBe(0.85);
    expect(normalized.preferences.autoFit).toBe(true);
    expect(normalized.nodeActivity.root).toEqual({
      visitCount: 4,
      lastVisitedAt: "2026-08-18T00:00:00.000Z",
    });
  });

  it("freezes a complete subtree including descendants added by later syncs", () => {
    const nodes = [node("root", null), node("a", "root"), node("a1", "a"), node("b", "root")];
    expect(Object.fromEntries(frozenNodeRootMap(nodes, ["a"]))).toEqual({
      a: "a",
      a1: "a",
    });
    expect(
      Object.fromEntries(frozenNodeRootMap([...nodes, node("a2", "a1")], ["a"])),
    ).toMatchObject({ a2: "a" });
  });

  it("unfreezes the owning ancestor and replaces nested frozen roots", () => {
    const nodes = [node("root", null), node("a", "root"), node("a1", "a"), node("b", "root")];
    expect(toggleFrozenRoot(nodes, ["a"], "a1")).toEqual([]);
    expect(toggleFrozenRoot(nodes, ["a1"], "a")).toEqual(["a"]);
  });

  it("migrates v6 documents with no frozen branches", () => {
    const previous = defaultDocument("file:///old");
    const normalized = normalizeDocument(
      { ...previous, schemaVersion: 6, frozenRootNodeIds: ["ignored-in-v6"] },
      "file:///workspace",
    );
    expect(normalized.schemaVersion).toBe(7);
    expect(normalized.frozenRootNodeIds).toEqual([]);
  });

  it("extracts a concise assistant answer for the confirmation snapshot", () => {
    const turn = {
      id: "turn",
      status: "completed",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "问题" }] },
        { type: "agentMessage", text: "这是回答。\n它会显示在进入分支前的快照中。" },
      ],
      raw: {},
    };
    expect(extractAnswerPreview(turn)).toBe("这是回答。\n它会显示在进入分支前的快照中。");
    expect(extractQuestionMarkdown(turn)).toBe("问题");
  });
});
