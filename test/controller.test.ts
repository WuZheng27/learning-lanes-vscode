import { describe, expect, it } from "vitest";
import { buildSyncedTurnNodes } from "../src/model.js";
import type {
  CodexListedThread,
  CodexThreadSnapshot,
  CodexTurnSnapshot,
} from "../src/types.js";

function turn(id: string, question?: string): CodexTurnSnapshot {
  return {
    id,
    status: "completed",
    items: question
      ? [{ type: "userMessage", content: [{ type: "text", text: question }] }]
      : [],
    raw: {},
  };
}

function listed(id: string, createdAt: number): CodexListedThread {
  return {
    id,
    name: null,
    preview: null,
    cwd: "F:/tree",
    sessionId: null,
    forkedFromId: null,
    createdAt,
    updatedAt: createdAt,
    status: { type: "idle" },
  };
}

function snapshot(id: string, turns: ReadonlyArray<CodexTurnSnapshot>): CodexThreadSnapshot {
  return {
    id,
    name: null,
    preview: null,
    cwd: "F:/tree",
    sessionId: null,
    forkedFromId: null,
    createdAt: null,
    updatedAt: null,
    turns,
    status: { type: "idle" },
  };
}

describe("turn-prefix learning tree", () => {
  const threads = [
    listed("root", 1),
    listed("branch-a", 2),
    listed("branch-b", 3),
    listed("grandchild", 4),
    listed("empty-fork", 5),
    listed("unrelated", 6),
  ];
  const snapshots = new Map<string, CodexThreadSnapshot>([
    [
      "root",
      snapshot("root", [
        turn("t1", "什么是电子传递链？"),
        turn("t2", "解释糖酵解"),
        turn("t3", "丙酮酸之后发生什么？"),
      ]),
    ],
    ["branch-a", snapshot("branch-a", [turn("t1"), turn("a2", "NADH 是什么？")])],
    ["branch-b", snapshot("branch-b", [turn("t1"), turn("t2"), turn("b3", "解释三羧酸循环")])],
    [
      "grandchild",
      snapshot("grandchild", [turn("t1"), turn("a2"), turn("a3", "电子来自哪里？")]),
    ],
    ["empty-fork", snapshot("empty-fork", [turn("t1"), turn("t2")])],
    ["unrelated", snapshot("unrelated", [turn("other", "另一个任务")])],
  ]);

  it("uses one question per depth and merges copied turns", () => {
    const nodes = buildSyncedTurnNodes("root", threads, snapshots, [], new Set());
    expect(nodes.map(({ id, parentNodeId }) => [id, parentNodeId])).toEqual([
      ["t1", null],
      ["t2", "t1"],
      ["t3", "t2"],
      ["a2", "t1"],
      ["b3", "t2"],
      ["a3", "a2"],
    ]);
    expect(nodes.find((node) => node.id === "t1")?.containingThreadIds).toHaveLength(5);
    expect(nodes.find((node) => node.id === "t2")).toMatchObject({
      title: "解释糖酵解",
      navigationExact: true,
      waitingBranchCount: 1,
      threadId: "empty-fork",
    });
    expect(nodes.find((node) => node.id === "b3")?.title).toBe("解释三羧酸循环");
  });

  it("marks an interior question as approximate when no task ends there", () => {
    const nodes = buildSyncedTurnNodes(
      "root",
      [listed("root", 1)],
      new Map([
        [
          "root",
          snapshot("root", [turn("t1", "问题一"), turn("t2", "问题二"), turn("t3", "问题三")]),
        ],
      ]),
      [],
      new Set(),
    );
    expect(nodes.find((node) => node.id === "t2")).toMatchObject({
      navigationExact: false,
      threadId: "root",
    });
    expect(nodes.find((node) => node.id === "t3")?.navigationExact).toBe(true);
  });

  it("removes injected IDE context from visible question titles", () => {
    const contextual = snapshot("contextual", [
      turn(
        "context-turn",
        "# Context from my IDE setup:\n\n## Open tabs:\n- file.md\n\n## My request for Codex:\n解释一下 isoform usage",
      ),
    ]);
    const nodes = buildSyncedTurnNodes(
      "contextual",
      [listed("contextual", 1)],
      new Map([["contextual", contextual]]),
      [],
      new Set(),
    );
    expect(nodes[0]?.title).toBe("解释一下 isoform usage");
  });

  it("keeps a deleted question subtree hidden after resync", () => {
    const nodes = buildSyncedTurnNodes(
      "root",
      threads,
      snapshots,
      [],
      new Set(["a2"]),
    );
    expect(nodes.map((node) => node.id)).toEqual(["t1", "t2", "t3", "b3"]);
  });
});
