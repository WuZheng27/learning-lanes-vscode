import { describe, expect, it } from "vitest";
import {
  buildSidebarDeepLink,
  parseThreadId,
  parseThreadList,
  parseThreadListPage,
  parseThreadSnapshot,
} from "../src/protocol.js";

describe("Codex protocol helpers", () => {
  it("targets the official Codex sidebar URI handler", () => {
    expect(buildSidebarDeepLink("thread/id")).toBe(
      "vscode://openai.chatgpt/local/thread%2Fid",
    );
  });

  it("reads the id returned by thread/fork", () => {
    expect(parseThreadId({ thread: { id: "forked-thread" } })).toBe("forked-thread");
    expect(() => parseThreadId({})).toThrow(/thread id/u);
  });

  it("parses fork metadata and complete task snapshots", () => {
    const snapshot = parseThreadSnapshot({
      thread: {
        id: "thread",
        name: "Title",
        preview: "Question",
        cwd: "F:/tree",
        sessionId: "session",
        forkedFromId: "parent",
        parentKnown: true,
        createdAt: 10,
        updatedAt: 12,
        status: { type: "idle" },
        turns: [{ id: "turn", status: "completed", items: [{ type: "userMessage" }] }],
      },
    });
    expect(snapshot).toMatchObject({
      id: "thread",
      forkedFromId: "parent",
      createdAt: 10,
      updatedAt: 12,
    });
    expect(snapshot.turns[0]).toMatchObject({ id: "turn", status: "completed" });
  });

  it("parses official task discovery results", () => {
    expect(
      parseThreadList({
        data: [
          {
            id: "thread",
            name: "Title",
            preview: "Question",
            cwd: "F:/tree",
            sessionId: "session",
            forkedFromId: "parent",
            createdAt: 10,
            updatedAt: 12,
            status: { type: "idle" },
          },
        ],
      }),
    ).toEqual([
      {
        id: "thread",
        name: "Title",
        preview: "Question",
        cwd: "F:/tree",
        sessionId: "session",
        forkedFromId: "parent",
        parentKnown: true,
        createdAt: 10,
        updatedAt: 12,
        status: { type: "idle" },
      },
    ]);
  });

  it("preserves the cursor needed to read every task-list page", () => {
    expect(
      parseThreadListPage({
        data: [{ id: "root", forkedFromId: null }],
        nextCursor: "page-2",
      }),
    ).toMatchObject({
      nextCursor: "page-2",
      data: [{ id: "root", forkedFromId: null }],
    });
  });
});
