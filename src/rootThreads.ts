import * as path from "node:path";
import type { CodexListedThread } from "./types.js";

export interface RootThreadChoice {
  readonly thread: CodexListedThread;
  readonly label: string;
  readonly description: string;
  readonly detail: string;
}

export function buildRootThreadChoices(
  threads: ReadonlyArray<CodexListedThread>,
  currentRootThreadId: string | null,
  currentWorkspaceCwd: string,
  excludedThreadIds: ReadonlySet<string>,
): ReadonlyArray<RootThreadChoice> {
  const roots = [
    ...new Map(
      threads
        .filter(
          (thread) =>
            thread.forkedFromId === null && !excludedThreadIds.has(thread.id),
        )
        .map((thread) => [thread.id, thread]),
    ).values(),
  ];
  roots.sort((left, right) =>
    compareRootChoices(left, right, currentRootThreadId, currentWorkspaceCwd),
  );
  return roots.map((thread) => ({
    thread,
    label: rootThreadLabel(thread),
    description: rootThreadDescription(
      thread,
      currentRootThreadId,
      currentWorkspaceCwd,
    ),
    detail: rootThreadDetail(thread),
  }));
}

export function rootThreadLabel(thread: CodexListedThread): string {
  const name = cleanThreadText(thread.name);
  const preview = cleanThreadText(thread.preview);
  const genericName = !name || /^Start conversation(?: \(\d+\))?$/iu.test(name);
  const value = (genericName ? preview || name : name) || `Codex task ${shortId(thread.id)}`;
  return value.length <= 110 ? value : `${value.slice(0, 109)}…`;
}

function compareRootChoices(
  left: CodexListedThread,
  right: CodexListedThread,
  currentRootThreadId: string | null,
  currentWorkspaceCwd: string,
): number {
  const leftCurrent = left.id === currentRootThreadId ? 1 : 0;
  const rightCurrent = right.id === currentRootThreadId ? 1 : 0;
  if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
  const leftLocal = sameCwd(left.cwd, currentWorkspaceCwd) ? 1 : 0;
  const rightLocal = sameCwd(right.cwd, currentWorkspaceCwd) ? 1 : 0;
  if (leftLocal !== rightLocal) return rightLocal - leftLocal;
  return (
    (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0) ||
    rootThreadLabel(left).localeCompare(rootThreadLabel(right), "zh-CN")
  );
}

function rootThreadDescription(
  thread: CodexListedThread,
  currentRootThreadId: string | null,
  currentWorkspaceCwd: string,
): string {
  const project = thread.cwd ? path.basename(thread.cwd) || thread.cwd : "未关联项目";
  if (thread.id === currentRootThreadId) return `当前泳道 · ${project}`;
  if (sameCwd(thread.cwd, currentWorkspaceCwd)) return `当前项目 · ${shortId(thread.id)}`;
  return `${project} · ${shortId(thread.id)}`;
}

function rootThreadDetail(thread: CodexListedThread): string {
  const updated = thread.updatedAt ? formatEpoch(thread.updatedAt) : "更新时间未知";
  return `${updated} · ${thread.cwd ?? "工作目录未知"} · ${thread.id}`;
}

function formatEpoch(value: number): string {
  const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value;
  return new Date(milliseconds).toLocaleString("zh-CN");
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function sameCwd(left: string | null, right: string): boolean {
  if (!left) return false;
  const normalize = (value: string): string =>
    value.replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase("en-US");
  return normalize(left) === normalize(right);
}

function cleanThreadText(value: string | null): string {
  if (!value) return "";
  let result = value;
  for (const marker of ["## My request for Codex:", "## My request:"]) {
    const index = result.lastIndexOf(marker);
    if (index >= 0) result = result.slice(index + marker.length);
  }
  return result.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}
