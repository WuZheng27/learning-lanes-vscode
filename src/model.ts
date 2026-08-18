import type {
  CodexListedThread,
  CodexThreadSnapshot,
  CodexTurnSnapshot,
  LearningDocument,
  LearningNode,
  LearningNodeActivity,
  LearningNodeRuntimeState,
  TemporaryFork,
} from "./types.js";

const MIN_COLUMN_WIDTH = 132;
const MAX_COLUMN_WIDTH = 520;
const MIN_ROW_HEIGHT = 64;
const MAX_ROW_HEIGHT = 360;
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 1.6;
const MIN_TABLE_SCALE = 0.65;
const MAX_TABLE_SCALE = 1.35;

export function defaultDocument(workspaceUri: string): LearningDocument {
  return {
    schemaVersion: 8,
    workspaceUri,
    rootThreadId: null,
    hiddenTurnIds: [],
    frozenRootNodeIds: [],
    temporaryForks: [],
    nodeActivity: {},
    nodeLabels: {},
    nodes: [],
    preferences: {
      textMode: "wrap",
      fontScale: 1,
      tableScale: 0.85,
      autoFit: true,
      defaultColumnWidth: 210,
      defaultRowHeight: 88,
      columnWidths: {},
      rowHeights: {},
    },
  };
}

export function cloneDocument(document: LearningDocument): LearningDocument {
  return JSON.parse(JSON.stringify(document)) as LearningDocument;
}

export function clampColumnWidth(value: number): number {
  if (!Number.isFinite(value)) return 210;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(value)));
}

export function clampRowHeight(value: number): number {
  if (!Number.isFinite(value)) return 88;
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.round(value)));
}

export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Math.round(value * 10) / 10));
}

export function clampTableScale(value: number): number {
  if (!Number.isFinite(value)) return 0.85;
  return Math.min(
    MAX_TABLE_SCALE,
    Math.max(MIN_TABLE_SCALE, Math.round(value * 20) / 20),
  );
}

export function normalizeDocument(value: unknown, workspaceUri: string): LearningDocument {
  const fallback = defaultDocument(workspaceUri);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) {
    return migrateLegacyDocument(candidate, workspaceUri);
  }
  if (
    (candidate.schemaVersion !== 3 &&
      candidate.schemaVersion !== 4 &&
      candidate.schemaVersion !== 5 &&
      candidate.schemaVersion !== 6 &&
      candidate.schemaVersion !== 7 &&
      candidate.schemaVersion !== 8) ||
    !Array.isArray(candidate.nodes)
  ) {
    return fallback;
  }
  return {
    schemaVersion: 8,
    workspaceUri,
    rootThreadId: typeof candidate.rootThreadId === "string" ? candidate.rootThreadId : null,
    hiddenTurnIds: stringArray(candidate.hiddenTurnIds),
    frozenRootNodeIds:
      candidate.schemaVersion === 7 || candidate.schemaVersion === 8
        ? stringArray(candidate.frozenRootNodeIds)
        : [],
    temporaryForks:
      (candidate.schemaVersion === 4 ||
        candidate.schemaVersion === 5 ||
        candidate.schemaVersion === 6 ||
        candidate.schemaVersion === 7 ||
        candidate.schemaVersion === 8) &&
      Array.isArray(candidate.temporaryForks)
        ? candidate.temporaryForks.filter(isTemporaryFork)
        : [],
    nodeActivity:
      candidate.schemaVersion === 5 ||
      candidate.schemaVersion === 6 ||
      candidate.schemaVersion === 7 ||
      candidate.schemaVersion === 8
        ? normalizeNodeActivity(candidate.nodeActivity)
        : {},
    nodeLabels: normalizeNodeLabels(candidate.nodeLabels),
    nodes: candidate.nodes.filter(isLearningNode),
    preferences: normalizePreferences(candidate.preferences),
  };
}

function migrateLegacyDocument(
  candidate: Record<string, unknown>,
  workspaceUri: string,
): LearningDocument {
  let rootThreadId = typeof candidate.rootThreadId === "string" ? candidate.rootThreadId : null;
  if (!rootThreadId && Array.isArray(candidate.nodes)) {
    const root = candidate.nodes.find((value) => {
      if (!value || typeof value !== "object") return false;
      return (value as Record<string, unknown>).parentNodeId === null;
    });
    if (root && typeof root === "object") {
      const threadId = (root as Record<string, unknown>).threadId;
      if (typeof threadId === "string") rootThreadId = threadId;
    }
  }
  return {
    schemaVersion: 8,
    workspaceUri,
    rootThreadId,
    hiddenTurnIds: [],
    frozenRootNodeIds: [],
    temporaryForks: [],
    nodeActivity: {},
    nodeLabels: {},
    nodes: [],
    preferences: normalizePreferences(candidate.preferences),
  };
}

function isTemporaryFork(value: unknown): value is TemporaryFork {
  if (!value || typeof value !== "object") return false;
  const fork = value as Partial<TemporaryFork>;
  return (
    typeof fork.nodeId === "string" &&
    typeof fork.sourceThreadId === "string" &&
    typeof fork.threadId === "string" &&
    typeof fork.baseTurnId === "string" &&
    (fork.state === "waiting" ||
      fork.state === "cleanupPending" ||
      fork.state === "archived") &&
    typeof fork.createdAt === "string" &&
    typeof fork.lastOpenedAt === "string" &&
    (fork.cleanupAfter === null || typeof fork.cleanupAfter === "string") &&
    (fork.archivedAt === null || typeof fork.archivedAt === "string")
  );
}

function normalizePreferences(value: unknown): LearningDocument["preferences"] {
  const preferences =
    value && typeof value === "object"
      ? (value as Partial<LearningDocument["preferences"]>)
      : undefined;
  return {
    textMode: preferences?.textMode === "ellipsis" ? "ellipsis" : "wrap",
    fontScale: clampFontScale(preferences?.fontScale ?? 1),
    tableScale: clampTableScale(preferences?.tableScale ?? 0.85),
    autoFit: preferences?.autoFit !== false,
    defaultColumnWidth: clampColumnWidth(preferences?.defaultColumnWidth ?? 210),
    defaultRowHeight: clampRowHeight(preferences?.defaultRowHeight ?? 88),
    columnWidths: normalizeNumberRecord(preferences?.columnWidths, clampColumnWidth),
    rowHeights: normalizeNumberRecord(preferences?.rowHeights, clampRowHeight),
  };
}

function normalizeNodeActivity(value: unknown): Readonly<Record<string, LearningNodeActivity>> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, LearningNodeActivity> = {};
  for (const [nodeId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const activity = raw as Partial<LearningNodeActivity>;
    if (
      typeof activity.visitCount !== "number" ||
      !Number.isFinite(activity.visitCount) ||
      activity.visitCount < 0 ||
      (activity.lastVisitedAt !== null && typeof activity.lastVisitedAt !== "string")
    ) {
      continue;
    }
    result[nodeId] = {
      visitCount: Math.floor(activity.visitCount),
      lastVisitedAt: activity.lastVisitedAt ?? null,
    };
  }
  return result;
}

function normalizeNodeLabels(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [nodeId, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    const label = raw.trim().replace(/[\r\n]+/gu, " ");
    if (label) result[nodeId] = label.slice(0, 80);
  }
  return result;
}

function isLearningNode(value: unknown): value is LearningNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<LearningNode>;
  return (
    typeof node.id === "string" &&
    (node.parentNodeId === null || typeof node.parentNodeId === "string") &&
    typeof node.threadId === "string" &&
    typeof node.turnId === "string" &&
    typeof node.title === "string" &&
    isRuntimeState(node.runtimeState) &&
    typeof node.collapsed === "boolean" &&
    typeof node.navigationExact === "boolean" &&
    typeof node.waitingBranchCount === "number" &&
    Array.isArray(node.containingThreadIds) &&
    node.containingThreadIds.every((id) => typeof id === "string") &&
    Array.isArray(node.terminalThreadIds) &&
    node.terminalThreadIds.every((id) => typeof id === "string") &&
    typeof node.createdAt === "string" &&
    typeof node.updatedAt === "string"
  );
}

function isRuntimeState(value: unknown): value is LearningNodeRuntimeState {
  return ["waiting", "running", "completed", "failed", "interrupted"].includes(
    String(value),
  );
}

function stringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string"))]
    : [];
}

function normalizeNumberRecord(
  value: unknown,
  clamp: (value: number) => number,
): Readonly<Record<string, number>> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) result[key] = clamp(raw);
  }
  return result;
}

export function subtreeNodeIds(
  nodes: ReadonlyArray<LearningNode>,
  rootNodeId: string,
): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentNodeId === null) continue;
    const bucket = children.get(node.parentNodeId) ?? [];
    bucket.push(node.id);
    children.set(node.parentNodeId, bucket);
  }
  const result = new Set<string>();
  const stack = [rootNodeId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || result.has(current)) continue;
    result.add(current);
    stack.push(...(children.get(current) ?? []));
  }
  return result;
}

export function frozenNodeRootMap(
  nodes: ReadonlyArray<LearningNode>,
  frozenRootNodeIds: ReadonlyArray<string>,
): ReadonlyMap<string, string> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const frozenRoots = new Set(frozenRootNodeIds.filter((id) => nodesById.has(id)));
  const result = new Map<string, string>();
  for (const node of nodes) {
    const visited = new Set<string>();
    let current: LearningNode | undefined = node;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (frozenRoots.has(current.id)) {
        result.set(node.id, current.id);
        break;
      }
      current = current.parentNodeId ? nodesById.get(current.parentNodeId) : undefined;
    }
  }
  return result;
}

export function toggleFrozenRoot(
  nodes: ReadonlyArray<LearningNode>,
  frozenRootNodeIds: ReadonlyArray<string>,
  nodeId: string,
): ReadonlyArray<string> {
  const validNodeIds = new Set(nodes.map((node) => node.id));
  if (!validNodeIds.has(nodeId)) return frozenRootNodeIds.filter((id) => validNodeIds.has(id));

  const currentRoots = frozenRootNodeIds.filter((id) => validNodeIds.has(id));
  const owner = frozenNodeRootMap(nodes, currentRoots).get(nodeId);
  if (owner) return currentRoots.filter((id) => id !== owner);

  const subtree = subtreeNodeIds(nodes, nodeId);
  return [...currentRoots.filter((id) => !subtree.has(id)), nodeId];
}

export class UndoHistory {
  readonly #limit: number;
  #undo: LearningDocument[] = [];
  #redo: LearningDocument[] = [];

  constructor(limit = 100) {
    this.#limit = limit;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  record(previous: LearningDocument): void {
    this.#undo.push(cloneDocument(previous));
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
  }

  undo(current: LearningDocument): LearningDocument | null {
    const previous = this.#undo.pop();
    if (!previous) return null;
    this.#redo.push(cloneDocument(current));
    return previous;
  }

  redo(current: LearningDocument): LearningDocument | null {
    const next = this.#redo.pop();
    if (!next) return null;
    this.#undo.push(cloneDocument(current));
    return next;
  }
}

export function turnAfterBase(
  snapshot: CodexThreadSnapshot,
  baseTurnId: string | null,
): CodexTurnSnapshot | null {
  if (snapshot.turns.length === 0) return null;
  if (baseTurnId === null) return snapshot.turns[0] ?? null;
  const baseIndex = snapshot.turns.findIndex((turn) => turn.id === baseTurnId);
  if (baseIndex >= 0) return snapshot.turns[baseIndex + 1] ?? null;
  return null;
}

export function mapTurnState(status: string): LearningNodeRuntimeState {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete")) return "completed";
  if (normalized.includes("interrupt") || normalized.includes("cancel")) return "interrupted";
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  return "running";
}

export function extractQuestion(turn: CodexTurnSnapshot): string {
  return compactTitle(extractQuestionMarkdown(turn));
}

export function extractQuestionMarkdown(turn: CodexTurnSnapshot): string {
  for (const item of turn.items) {
    const question = extractQuestionFromItem(item);
    if (question) return question;
  }
  return "已提问（等待读取标题）";
}

export function extractAnswerPreview(
  turn: CodexTurnSnapshot,
  maxLength = 30_000,
): string | null {
  for (const item of [...turn.items].reverse()) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
    if (!type.includes("agent") && !type.includes("assistant")) continue;
    const text = itemText(record);
    if (!text) continue;
    const markdown = text.trim();
    if (!markdown) continue;
    if (markdown.length <= maxLength) return markdown;
    const safeEnd = markdown.lastIndexOf("\n\n", maxLength);
    const end = safeEnd >= Math.floor(maxLength * 0.65) ? safeEnd : maxLength;
    return `${markdown.slice(0, end).trimEnd()}\n\n_快照内容较长，已在安全边界截断；进入分支可查看完整回答。_`;
  }
  return null;
}

function itemText(item: Readonly<Record<string, unknown>>): string | null {
  for (const key of ["text", "message", "outputText"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  if (!Array.isArray(item.content)) return null;
  const texts = item.content.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    return typeof record.text === "string" ? [record.text] : [];
  });
  return texts.length > 0 ? texts.join(" ") : null;
}

function extractQuestionFromItem(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  if (!type.includes("user") && type !== "message") return null;
  if (typeof item.text === "string" && item.text.trim()) return cleanQuestionText(item.text);
  if (typeof item.input === "string" && item.input.trim()) return cleanQuestionText(item.input);
  for (const field of [item.content, item.input]) {
    if (!Array.isArray(field)) continue;
    const texts = field.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? [record.text] : [];
    });
    if (texts.length > 0) return cleanQuestionText(texts.join(" "));
  }
  return null;
}

function cleanQuestionText(value: string): string {
  for (const marker of ["## My request for Codex:", "## My request:"]) {
    const index = value.lastIndexOf(marker);
    if (index >= 0) return value.slice(index + marker.length).trim();
  }
  return value.trim();
}

export function compactTitle(value: string, maxLength = 88): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "未命名问题";
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

export function lastTurnId(snapshot: CodexThreadSnapshot): string | null {
  return snapshot.turns.at(-1)?.id ?? null;
}

export function findForkBaseTurnId(
  parent: CodexThreadSnapshot | undefined,
  child: CodexThreadSnapshot,
): string | null {
  if (!parent) return null;
  const common = commonTurnPrefixLength(parent, child);
  return common > 0 ? (child.turns[common - 1]?.id ?? null) : null;
}

interface TurnAggregate {
  readonly turn: CodexTurnSnapshot;
  readonly parentTurnId: string | null;
  readonly containingThreadIds: Set<string>;
  readonly terminalThreadIds: Set<string>;
  readonly positions: Map<string, number>;
  createdAtMs: number;
  updatedAtMs: number;
}

export function buildSyncedTurnNodes(
  rootThreadId: string,
  listedThreads: ReadonlyArray<CodexListedThread>,
  snapshots: ReadonlyMap<string, CodexThreadSnapshot>,
  previousNodes: ReadonlyArray<LearningNode>,
  hiddenTurnIds: ReadonlySet<string>,
): ReadonlyArray<LearningNode> {
  const listedById = new Map(listedThreads.map((thread) => [thread.id, thread]));
  const rootSnapshot = snapshots.get(rootThreadId);
  if (!listedById.has(rootThreadId) && rootSnapshot) {
    listedById.set(rootThreadId, listedFromSnapshot(rootSnapshot));
  }
  if (!listedById.has(rootThreadId) || !rootSnapshot) return [];

  const taskParents = inferTaskParentIds([...listedById.values()], snapshots);
  const reachable = reachableTaskIds(rootThreadId, listedById, taskParents);
  const reachableThreads = [...reachable]
    .map((id) => listedById.get(id))
    .filter((thread): thread is CodexListedThread => Boolean(thread))
    .sort(compareTaskCreation);

  const aggregates = new Map<string, TurnAggregate>();
  for (const listed of reachableThreads) {
    const snapshot = snapshots.get(listed.id);
    if (!snapshot) continue;
    snapshot.turns.forEach((turn, index) => {
      const parentTurnId = index === 0 ? null : (snapshot.turns[index - 1]?.id ?? null);
      const createdAtMs = turnTimeMs(turn, listed.createdAt, index);
      const updatedAtMs = epochToMs(listed.updatedAt ?? snapshot.updatedAt) ?? createdAtMs;
      const aggregate = aggregates.get(turn.id);
      if (aggregate) {
        aggregate.containingThreadIds.add(listed.id);
        aggregate.positions.set(listed.id, index);
        aggregate.createdAtMs = Math.min(aggregate.createdAtMs, createdAtMs);
        aggregate.updatedAtMs = Math.max(aggregate.updatedAtMs, updatedAtMs);
        if (index === snapshot.turns.length - 1) aggregate.terminalThreadIds.add(listed.id);
        return;
      }
      aggregates.set(turn.id, {
        turn,
        parentTurnId,
        containingThreadIds: new Set([listed.id]),
        terminalThreadIds: new Set(index === snapshot.turns.length - 1 ? [listed.id] : []),
        positions: new Map([[listed.id, index]]),
        createdAtMs,
        updatedAtMs,
      });
    });
  }

  const waitingByTurnId = new Map<string, number>();
  for (const listed of reachableThreads) {
    if (listed.id === rootThreadId) continue;
    const parentThreadId = taskParents.get(listed.id);
    const snapshot = snapshots.get(listed.id);
    const parentSnapshot = parentThreadId ? snapshots.get(parentThreadId) : undefined;
    if (!snapshot || !parentSnapshot) continue;
    const baseTurnId = findForkBaseTurnId(parentSnapshot, snapshot);
    if (baseTurnId && lastTurnId(snapshot) === baseTurnId) {
      waitingByTurnId.set(baseTurnId, (waitingByTurnId.get(baseTurnId) ?? 0) + 1);
    }
  }

  const hidden = hiddenTurnClosure(aggregates, hiddenTurnIds);
  const previousByTurnId = new Map(previousNodes.map((node) => [node.turnId, node]));
  return [...aggregates.entries()]
    .filter(([turnId]) => !hidden.has(turnId))
    .map(([turnId, aggregate]) => {
      const previous = previousByTurnId.get(turnId);
      const containingThreadIds = [...aggregate.containingThreadIds].sort();
      const terminalThreadIds = [...aggregate.terminalThreadIds].sort();
      const threadId = chooseNavigationThread(
        aggregate,
        terminalThreadIds,
        containingThreadIds,
        listedById,
        snapshots,
      );
      return {
        id: turnId,
        parentNodeId: aggregate.parentTurnId,
        threadId,
        turnId,
        title: extractQuestion(aggregate.turn),
        runtimeState: mapTurnState(aggregate.turn.status),
        collapsed: previous?.collapsed ?? false,
        navigationExact: terminalThreadIds.length > 0,
        waitingBranchCount: waitingByTurnId.get(turnId) ?? 0,
        containingThreadIds,
        terminalThreadIds,
        createdAt: new Date(aggregate.createdAtMs).toISOString(),
        updatedAt: new Date(aggregate.updatedAtMs).toISOString(),
      } satisfies LearningNode;
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function chooseNavigationThread(
  aggregate: TurnAggregate,
  terminalThreadIds: ReadonlyArray<string>,
  containingThreadIds: ReadonlyArray<string>,
  listedById: ReadonlyMap<string, CodexListedThread>,
  snapshots: ReadonlyMap<string, CodexThreadSnapshot>,
): string {
  const candidates = terminalThreadIds.length > 0 ? terminalThreadIds : containingThreadIds;
  return [...candidates].sort((leftId, rightId) => {
    if (terminalThreadIds.length === 0) {
      const leftRemaining = remainingTurns(leftId, aggregate, snapshots);
      const rightRemaining = remainingTurns(rightId, aggregate, snapshots);
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
    }
    const left = listedById.get(leftId);
    const right = listedById.get(rightId);
    return (right?.createdAt ?? 0) - (left?.createdAt ?? 0) || leftId.localeCompare(rightId);
  })[0] ?? containingThreadIds[0] ?? "";
}

function remainingTurns(
  threadId: string,
  aggregate: TurnAggregate,
  snapshots: ReadonlyMap<string, CodexThreadSnapshot>,
): number {
  const index = aggregate.positions.get(threadId) ?? 0;
  return Math.max(0, (snapshots.get(threadId)?.turns.length ?? 1) - index - 1);
}

function hiddenTurnClosure(
  aggregates: ReadonlyMap<string, TurnAggregate>,
  initial: ReadonlySet<string>,
): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const [turnId, aggregate] of aggregates) {
    if (!aggregate.parentTurnId) continue;
    const bucket = children.get(aggregate.parentTurnId) ?? [];
    bucket.push(turnId);
    children.set(aggregate.parentTurnId, bucket);
  }
  const hidden = new Set(initial);
  const stack = [...initial];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const child of children.get(current) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      stack.push(child);
    }
  }
  return hidden;
}

function reachableTaskIds(
  rootThreadId: string,
  listedById: ReadonlyMap<string, CodexListedThread>,
  taskParents: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const reachable = new Set<string>([rootThreadId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const threadId of listedById.keys()) {
      if (reachable.has(threadId)) continue;
      const parent = taskParents.get(threadId);
      if (parent && reachable.has(parent)) {
        reachable.add(threadId);
        changed = true;
      }
    }
  }
  return reachable;
}

export function inferTaskParentIds(
  listedThreads: ReadonlyArray<CodexListedThread>,
  snapshots: ReadonlyMap<string, CodexThreadSnapshot>,
): ReadonlyMap<string, string> {
  const listedById = new Map(listedThreads.map((thread) => [thread.id, thread]));
  const result = new Map<string, string>();
  for (const child of listedThreads) {
    const childSnapshot = snapshots.get(child.id);
    const explicitParent = child.forkedFromId ?? childSnapshot?.forkedFromId ?? null;
    if (explicitParent && listedById.has(explicitParent)) {
      result.set(child.id, explicitParent);
      continue;
    }
    if (!childSnapshot || childSnapshot.turns.length === 0) continue;
    let best:
      | { readonly thread: CodexListedThread; readonly commonTurns: number }
      | undefined;
    for (const candidate of listedThreads) {
      if (candidate.id === child.id || compareTaskCreation(candidate, child) >= 0) continue;
      const candidateSnapshot = snapshots.get(candidate.id);
      if (!candidateSnapshot) continue;
      const commonTurns = commonTurnPrefixLength(candidateSnapshot, childSnapshot);
      if (commonTurns === 0) continue;
      if (
        !best ||
        commonTurns > best.commonTurns ||
        (commonTurns === best.commonTurns && compareTaskCreation(candidate, best.thread) < 0)
      ) {
        best = { thread: candidate, commonTurns };
      }
    }
    if (best) result.set(child.id, best.thread.id);
  }
  return result;
}

function commonTurnPrefixLength(
  left: CodexThreadSnapshot,
  right: CodexThreadSnapshot,
): number {
  const limit = Math.min(left.turns.length, right.turns.length);
  let index = 0;
  while (index < limit && left.turns[index]?.id === right.turns[index]?.id) index += 1;
  return index;
}

function compareTaskCreation(left: CodexListedThread, right: CodexListedThread): number {
  const leftCreated = left.createdAt ?? Number.MAX_SAFE_INTEGER;
  const rightCreated = right.createdAt ?? Number.MAX_SAFE_INTEGER;
  return leftCreated - rightCreated || left.id.localeCompare(right.id);
}

function listedFromSnapshot(snapshot: CodexThreadSnapshot): CodexListedThread {
  return {
    id: snapshot.id,
    name: snapshot.name,
    preview: snapshot.preview,
    cwd: snapshot.cwd,
    sessionId: snapshot.sessionId,
    forkedFromId: snapshot.forkedFromId,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    status: snapshot.status,
  };
}

function turnTimeMs(turn: CodexTurnSnapshot, threadCreatedAt: number | null, index: number): number {
  for (const key of ["turnStartedAtMs", "createdAt", "startedAt"]) {
    const value = turn.raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return epochToMs(value) ?? Date.now();
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return (epochToMs(threadCreatedAt) ?? Date.now()) + index;
}

function epochToMs(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}
