import type { CodexThreadSnapshot, TemporaryFork } from "./types.js";

export const TEMPORARY_FORK_CLEANUP_GRACE_MS = 5 * 60 * 1_000;

export type TemporaryForkMaintenanceAction = "none" | "promote" | "delete";

export function createTemporaryFork(
  nodeId: string,
  sourceThreadId: string,
  threadId: string,
  baseTurnId: string,
  nowMs = Date.now(),
): TemporaryFork {
  const now = new Date(nowMs).toISOString();
  return {
    nodeId,
    sourceThreadId,
    threadId,
    baseTurnId,
    state: "waiting",
    createdAt: now,
    lastOpenedAt: now,
    cleanupAfter: null,
    archivedAt: null,
  };
}

export function reopenTemporaryFork(fork: TemporaryFork, nowMs = Date.now()): TemporaryFork {
  return {
    ...fork,
    state: "waiting",
    lastOpenedAt: new Date(nowMs).toISOString(),
    cleanupAfter: null,
    archivedAt: null,
  };
}

export function scheduleTemporaryForkCleanup(
  fork: TemporaryFork,
  nowMs = Date.now(),
): TemporaryFork {
  if (fork.state === "archived") return fork;
  return {
    ...fork,
    state: "cleanupPending",
    cleanupAfter: new Date(nowMs + TEMPORARY_FORK_CLEANUP_GRACE_MS).toISOString(),
  };
}

export function snapshotHasTurnAfterBase(
  snapshot: CodexThreadSnapshot,
  baseTurnId: string,
): boolean {
  const baseIndex = snapshot.turns.findIndex((turn) => turn.id === baseTurnId);
  // A missing base means the task no longer matches the temporary snapshot. Preserve it.
  return baseIndex < 0 || baseIndex < snapshot.turns.length - 1;
}

export function decideTemporaryForkMaintenance(
  fork: TemporaryFork,
  snapshot: CodexThreadSnapshot,
  nowMs: number,
  hasDescendants: boolean,
): TemporaryForkMaintenanceAction {
  if (snapshotHasTurnAfterBase(snapshot, fork.baseTurnId) || hasDescendants) return "promote";
  if (threadIsActive(snapshot)) return "none";
  if (fork.state === "cleanupPending" && timestampReached(fork.cleanupAfter, nowMs)) {
    return "delete";
  }
  if (fork.state === "archived") return "delete";
  return "none";
}

function threadIsActive(snapshot: CodexThreadSnapshot): boolean {
  if (snapshot.turns.some((turn) => !isTerminalTurnStatus(turn.status))) return true;
  if (!snapshot.status || typeof snapshot.status !== "object") return false;
  const type = (snapshot.status as Record<string, unknown>).type;
  return typeof type === "string" && type.toLowerCase() === "active";
}

function isTerminalTurnStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("complete") ||
    normalized.includes("interrupt") ||
    normalized.includes("cancel") ||
    normalized.includes("fail") ||
    normalized.includes("error")
  );
}

function timestampReached(value: string | null, thresholdMs: number): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= thresholdMs;
}
