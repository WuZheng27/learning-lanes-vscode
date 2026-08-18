import { describe, expect, it } from "vitest";
import {
  createTemporaryFork,
  decideTemporaryForkMaintenance,
  reopenTemporaryFork,
  scheduleTemporaryForkCleanup,
  TEMPORARY_FORK_CLEANUP_GRACE_MS,
} from "../src/temporaryForks.js";
import type { CodexThreadSnapshot } from "../src/types.js";

function snapshot(turnIds: ReadonlyArray<string>, status: unknown = { type: "idle" }): CodexThreadSnapshot {
  return {
    id: "temporary",
    name: null,
    preview: null,
    cwd: "F:/tree",
    sessionId: null,
    forkedFromId: "source",
    createdAt: null,
    updatedAt: null,
    turns: turnIds.map((id) => ({ id, status: "completed", items: [], raw: {} })),
    status,
  };
}

describe("temporary fork lifecycle", () => {
  const start = Date.parse("2026-08-18T00:00:00.000Z");

  it("promotes a temporary fork as soon as the user sends a new turn", () => {
    const fork = createTemporaryFork("base", "source", "temporary", "base", start);
    expect(decideTemporaryForkMaintenance(fork, snapshot(["base", "question"]), start, false)).toBe(
      "promote",
    );
  });

  it("permanently deletes an unused fork five minutes after leaving it", () => {
    const waiting = createTemporaryFork("base", "source", "temporary", "base", start);
    const pending = scheduleTemporaryForkCleanup(waiting, start);
    expect(
      decideTemporaryForkMaintenance(
        pending,
        snapshot(["base"]),
        start + TEMPORARY_FORK_CLEANUP_GRACE_MS - 1,
        false,
      ),
    ).toBe("none");
    expect(
      decideTemporaryForkMaintenance(
        pending,
        snapshot(["base"]),
        start + TEMPORARY_FORK_CLEANUP_GRACE_MS,
        false,
      ),
    ).toBe("delete");
  });

  it("deletes archived positioning forks left by older extension versions", () => {
    const archived = {
      ...createTemporaryFork("base", "source", "temporary", "base", start),
      state: "archived" as const,
      archivedAt: new Date(start).toISOString(),
    };
    expect(decideTemporaryForkMaintenance(archived, snapshot(["base"]), start, false)).toBe(
      "delete",
    );
  });

  it("never cleans an active task or one with descendants", () => {
    const pending = scheduleTemporaryForkCleanup(
      createTemporaryFork("base", "source", "temporary", "base", start),
      start,
    );
    const due = start + TEMPORARY_FORK_CLEANUP_GRACE_MS;
    expect(decideTemporaryForkMaintenance(pending, snapshot(["base"], { type: "active" }), due, false)).toBe(
      "none",
    );
    expect(decideTemporaryForkMaintenance(pending, snapshot(["base"]), due, true)).toBe("promote");
  });

  it("cancels pending cleanup when the same node is reopened", () => {
    const pending = scheduleTemporaryForkCleanup(
      createTemporaryFork("base", "source", "temporary", "base", start),
      start,
    );
    expect(reopenTemporaryFork(pending, start + 1)).toMatchObject({
      state: "waiting",
      cleanupAfter: null,
      archivedAt: null,
    });
  });
});
