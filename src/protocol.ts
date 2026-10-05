import type { CodexListedThread, CodexThreadSnapshot, CodexTurnSnapshot } from "./types.js";

export function buildSidebarDeepLink(threadId: string): string {
  return `vscode://openai.chatgpt/local/${encodeURIComponent(threadId)}`;
}

export function parseThreadId(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("App Server returned no thread.");
  const thread = (value as Record<string, unknown>).thread;
  if (!thread || typeof thread !== "object" || typeof (thread as Record<string, unknown>).id !== "string") {
    throw new Error("App Server response did not contain a thread id.");
  }
  return (thread as Record<string, unknown>).id as string;
}

export function parseThreadSnapshot(value: unknown): CodexThreadSnapshot {
  if (!value || typeof value !== "object") throw new Error("App Server returned no thread.");
  const result = value as Record<string, unknown>;
  const rawThread = result.thread;
  if (!rawThread || typeof rawThread !== "object") {
    throw new Error("App Server response did not contain a thread.");
  }
  const thread = rawThread as Record<string, unknown>;
  if (typeof thread.id !== "string") throw new Error("App Server thread has no id.");
  const turns = Array.isArray(thread.turns)
    ? thread.turns.flatMap((turn) => {
        if (!turn || typeof turn !== "object") return [];
        const record = turn as Record<string, unknown>;
        if (typeof record.id !== "string") return [];
        return [
          {
            id: record.id,
            status: typeof record.status === "string" ? record.status : "running",
            items: Array.isArray(record.items) ? record.items : [],
            raw: record,
          } satisfies CodexTurnSnapshot,
        ];
      })
    : [];
  return {
    id: thread.id,
    name: typeof thread.name === "string" ? thread.name : null,
    preview: typeof thread.preview === "string" ? thread.preview : null,
    cwd: typeof thread.cwd === "string" ? thread.cwd : null,
    sessionId: typeof thread.sessionId === "string" ? thread.sessionId : null,
    forkedFromId: typeof thread.forkedFromId === "string" ? thread.forkedFromId : null,
    parentKnown: thread.forkedFromId === null || typeof thread.forkedFromId === "string",
    createdAt: finiteNumber(thread.createdAt),
    updatedAt: finiteNumber(thread.updatedAt),
    turns,
    status: thread.status,
  };
}

export function parseThreadList(value: unknown): ReadonlyArray<CodexListedThread> {
  return parseThreadListPage(value).data;
}

export function parseThreadListPage(value: unknown): {
  readonly data: ReadonlyArray<CodexListedThread>;
  readonly nextCursor: string | null;
} {
  if (!value || typeof value !== "object") return { data: [], nextCursor: null };
  const result = value as Record<string, unknown>;
  const data = result.data;
  const nextCursor =
    typeof result.nextCursor === "string"
      ? result.nextCursor
      : typeof result.next_cursor === "string"
        ? result.next_cursor
        : null;
  if (!Array.isArray(data)) return { data: [], nextCursor };
  return {
    nextCursor,
    data: data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const thread = item as Record<string, unknown>;
    if (typeof thread.id !== "string") return [];
    return [
      {
        id: thread.id,
        name: typeof thread.name === "string" ? thread.name : null,
        preview: typeof thread.preview === "string" ? thread.preview : null,
        cwd: typeof thread.cwd === "string" ? thread.cwd : null,
        sessionId: typeof thread.sessionId === "string" ? thread.sessionId : null,
        forkedFromId: typeof thread.forkedFromId === "string" ? thread.forkedFromId : null,
    parentKnown: thread.forkedFromId === null || typeof thread.forkedFromId === "string",
        createdAt: finiteNumber(thread.createdAt),
        updatedAt: finiteNumber(thread.updatedAt),
        status: thread.status,
      } satisfies CodexListedThread,
    ];
    }),
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
