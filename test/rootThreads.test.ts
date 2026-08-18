import { describe, expect, it } from "vitest";
import { buildRootThreadChoices } from "../src/rootThreads.js";
import type { CodexListedThread } from "../src/types.js";

function thread(
  id: string,
  options: Partial<CodexListedThread> = {},
): CodexListedThread {
  return {
    id,
    name: options.name ?? id,
    preview: options.preview ?? null,
    cwd: options.cwd ?? "F:/current",
    sessionId: null,
    forkedFromId: options.forkedFromId ?? null,
    createdAt: options.createdAt ?? 1,
    updatedAt: options.updatedAt ?? 1,
    status: { type: "idle" },
  };
}

describe("global root thread choices", () => {
  it("hides branches and navigator temporary tasks while keeping other projects", () => {
    const choices = buildRootThreadChoices(
      [
        thread("current-root", { name: "当前根任务", updatedAt: 1 }),
        thread("local-root", { name: "当前项目历史", updatedAt: 3 }),
        thread("branch", { forkedFromId: "current-root", updatedAt: 9 }),
        thread("temporary", { name: "临时定位", updatedAt: 10 }),
        thread("other-root", {
          name: "Start conversation",
          preview: "你好我是一个小白，想学习 GitHub 如何用",
          cwd: "F:/github_learning",
          updatedAt: 20,
        }),
      ],
      "current-root",
      "F:\\current",
      new Set(["temporary"]),
    );
    expect(choices.map((choice) => choice.thread.id)).toEqual([
      "current-root",
      "local-root",
      "other-root",
    ]);
    expect(choices[2]).toMatchObject({
      label: "你好我是一个小白，想学习 GitHub 如何用",
      description: "github_learning · other-root",
    });
    expect(choices[2]?.detail).toContain("F:/github_learning");
  });

  it("uses the actual request instead of injected IDE context", () => {
    const [choice] = buildRootThreadChoices(
      [
        thread("root", {
          name: "Start conversation",
          preview:
            "# Context from my IDE setup:\n\n## My request for Codex:\n解释一下 GitHub 分支",
        }),
      ],
      null,
      "F:/current",
      new Set(),
    );
    expect(choice?.label).toBe("解释一下 GitHub 分支");
  });
});
