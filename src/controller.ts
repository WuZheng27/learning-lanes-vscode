import * as vscode from "vscode";
import { CodexBridge } from "./codexBridge.js";
import { buildLaneLayout } from "./layout.js";
import {
  buildSyncedTurnNodes,
  clampColumnWidth,
  clampFontScale,
  clampRowHeight,
  clampTableScale,
  cloneDocument,
  extractAnswerPreview,
  extractQuestionMarkdown,
  frozenNodeRootMap,
  subtreeNodeIds,
  toggleFrozenRoot,
  UndoHistory,
} from "./model.js";
import { renderSnapshotMarkdown } from "./markdown.js";
import { LearningStore } from "./store.js";
import { buildRootThreadChoices } from "./rootThreads.js";
import {
  createTemporaryFork,
  decideTemporaryForkMaintenance,
  reopenTemporaryFork,
  scheduleTemporaryForkCleanup,
  snapshotHasTurnAfterBase,
} from "./temporaryForks.js";
import type {
  CodexListedThread,
  CodexThreadSnapshot,
  LearningDocument,
  LearningNodePreview,
  NavigatorViewState,
  TemporaryFork,
} from "./types.js";

interface CompatibilityState {
  readonly checked: boolean;
  readonly ok: boolean;
  readonly extensionVersion: string | null;
  readonly appServerVersion: string | null;
  readonly message: string | null;
}

const uncheckedCompatibility: CompatibilityState = {
  checked: false,
  ok: false,
  extensionVersion: null,
  appServerVersion: null,
  message: null,
};

export class NavigatorController implements vscode.Disposable {
  readonly #bridge: CodexBridge;
  readonly #store: LearningStore;
  readonly #workspaceFolder: vscode.WorkspaceFolder;
  readonly #history = new UndoHistory();
  readonly #stateEmitter = new vscode.EventEmitter<NavigatorViewState>();
  readonly #snapshotCache = new Map<string, CodexThreadSnapshot>();
  readonly #pollTimer: NodeJS.Timeout;
  #document: LearningDocument;
  #selectedNodeId: string | null = null;
  #busy = false;
  #polling = false;
  #disposed = false;
  #navigatorVisible = false;
  #activeTemporaryThreadId: string | null = null;
  #compatibility: CompatibilityState = uncheckedCompatibility;
  #transientMessage: string | null = null;

  readonly onDidChangeState = this.#stateEmitter.event;

  private constructor(
    bridge: CodexBridge,
    store: LearningStore,
    workspaceFolder: vscode.WorkspaceFolder,
    document: LearningDocument,
  ) {
    this.#bridge = bridge;
    this.#store = store;
    this.#workspaceFolder = workspaceFolder;
    this.#document = document;
    this.#pollTimer = setInterval(() => void this.#pollOfficialTasks(), 3_000);
  }

  static async create(
    bridge: CodexBridge,
    store: LearningStore,
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<NavigatorController> {
    const controller = new NavigatorController(
      bridge,
      store,
      workspaceFolder,
      await store.read(),
    );
    await controller.#scheduleRecoveredTemporaryForks();
    void controller.checkCompatibility(false);
    void controller.#pollOfficialTasks();
    return controller;
  }

  getState(): NavigatorViewState {
    return {
      document: this.#document,
      layout: buildLaneLayout(this.#document.nodes),
      selectedNodeId: this.#selectedNodeId,
      selectedNodePreview: this.#selectedNodePreview(),
      canUndo: this.#history.canUndo,
      canRedo: this.#history.canRedo,
      busy: this.#busy,
      compatibility: this.#compatibility,
      transientMessage: this.#transientMessage,
    };
  }

  async checkCompatibility(showError = true): Promise<boolean> {
    try {
      const compatibility = await this.#bridge.checkCompatibility();
      this.#compatibility = {
        checked: true,
        ok: true,
        extensionVersion: compatibility.extensionVersion,
        appServerVersion: compatibility.appServerVersion,
        message: null,
      };
      this.#emit();
      return true;
    } catch (error) {
      const message = errorMessage(error);
      this.#compatibility = {
        checked: true,
        ok: false,
        extensionVersion: null,
        appServerVersion: null,
        message,
      };
      this.#emit();
      if (showError) void vscode.window.showErrorMessage(`Learning Navigator：${message}`);
      return false;
    }
  }

  async selectRoot(): Promise<void> {
    await this.#withBusy(async () => {
      if (!(await this.checkCompatibility())) return;
      const temporaryThreadIds = new Set(
        this.#document.temporaryForks.map((fork) => fork.threadId),
      );
      this.#setMessage("正在读取全部官方 Codex 对话并隐藏分支，请稍候…", false);
      const choices = buildRootThreadChoices(
        await this.#bridge.listAllRootThreads(),
        this.#document.rootThreadId,
        this.#workspaceFolder.uri.fsPath,
        temporaryThreadIds,
      );
      this.#setMessage(`已整理出 ${choices.length} 个官方根对话；可按标题、项目路径或任务 ID 搜索。`, false);
      if (choices.length === 0) {
        void vscode.window.showInformationMessage(
          "没有找到可用的官方 Codex 根对话。请先在官方 Codex 中开始一次对话。",
        );
        return;
      }
      const selected = await vscode.window.showQuickPick(
        choices,
        {
          title: "更换学习泳道根对话（已隐藏所有分支）",
          placeHolder: "输入对话标题、问题、项目路径或任务 ID 搜索全部官方 Codex 根对话",
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      if (!selected) return;
      const previouslyActive = this.#activeTemporaryThreadId;
      await this.#commitUser({
        ...this.#document,
        rootThreadId: selected.thread.id,
        hiddenTurnIds: [],
        frozenRootNodeIds: [],
        temporaryForks: this.#document.temporaryForks.filter(
          (fork) => fork.threadId !== selected.thread.id,
        ),
        nodeActivity: {},
        nodeLabels: {},
        nodes: [],
      });
      this.#selectedNodeId = null;
      this.#snapshotCache.clear();
      await this.#syncOfficialTasks();
      this.#selectedNodeId = this.#document.nodes.find((node) => node.parentNodeId === null)?.id ?? null;
      await this.#bridge.openSidebarThread(selected.thread.id);
      this.#activeTemporaryThreadId = null;
      if (previouslyActive && previouslyActive !== selected.thread.id) {
        await this.#scheduleTemporaryFork(previouslyActive);
      }
      this.#setMessage("已按问题逐层绑定。以后请用官方 Codex 的分支按钮创建分支。", false);
    });
  }

  async sync(): Promise<void> {
    await this.#withBusy(async () => {
      if (!(await this.checkCompatibility())) return;
      if (!this.#document.rootThreadId) {
        void vscode.window.showInformationMessage("请先选择一个官方 Codex 根任务。");
        return;
      }
      const countBefore = this.#document.nodes.length;
      await this.#syncOfficialTasks();
      await this.#maintainTemporaryForks();
      const added = Math.max(0, this.#document.nodes.length - countBefore);
      this.#setMessage(
        added > 0 ? `已同步 ${added} 个问题节点。` : "已与官方 Codex 问题树同步。",
        false,
      );
    });
  }

  async openNode(nodeId: string): Promise<void> {
    const node = this.#document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    this.#selectedNodeId = node.id;
    this.#emit();
    await this.#withBusy(async () => {
      if (!(await this.checkCompatibility())) return;
      const previouslyActive = this.#activeTemporaryThreadId;
      let temporary = this.#document.temporaryForks.find(
        (fork) => fork.threadId === node.threadId,
      );
      if (!node.navigationExact) {
        temporary ??= this.#document.temporaryForks.find((fork) => fork.nodeId === node.id);
        if (temporary?.state === "archived") {
          await this.#bridge.unarchiveThread(temporary.threadId);
          this.#snapshotCache.delete(temporary.threadId);
        }
        if (!temporary) {
          const forked = await this.#bridge.forkThread(node.threadId, node.turnId);
          temporary = createTemporaryFork(
            node.id,
            node.threadId,
            forked.threadId,
            node.turnId,
          );
        } else {
          temporary = reopenTemporaryFork(temporary);
        }
        await this.#upsertTemporaryFork(temporary);
      } else if (temporary) {
        temporary = reopenTemporaryFork(temporary);
        await this.#upsertTemporaryFork(temporary);
      }

      const targetThreadId = temporary?.threadId ?? node.threadId;
      try {
        await this.#bridge.openSidebarThread(targetThreadId);
      } catch (error) {
        if (temporary) await this.#scheduleTemporaryFork(temporary.threadId);
        throw error;
      }
      this.#activeTemporaryThreadId = temporary?.threadId ?? null;
      if (previouslyActive && previouslyActive !== this.#activeTemporaryThreadId) {
        await this.#scheduleTemporaryFork(previouslyActive);
      }

      if (temporary) {
        await this.#syncOfficialTasks();
        this.#setMessage(
          "已打开精确临时分支。在官方 Codex 中发送问题后会自动保留；未提问并离开 5 分钟后将永久删除。",
          false,
        );
      }
      await this.#recordNodeVisit(node.id);
    });
  }

  selectNode(nodeId: string): void {
    if (!this.#document.nodes.some((node) => node.id === nodeId)) return;
    this.#selectedNodeId = nodeId;
    this.#emit();
  }

  async deleteSelected(): Promise<void> {
    if (!this.#selectedNodeId) return;
    const ids = subtreeNodeIds(this.#document.nodes, this.#selectedNodeId);
    if (ids.size === 0) return;
    const selected = this.#document.nodes.find((node) => node.id === this.#selectedNodeId);
    const selectedDisplayTitle = selected
      ? (this.#document.nodeLabels[selected.id] ?? selected.title)
      : "这个节点";
    const confirmation = await vscode.window.showWarningMessage(
      ids.size === 1
        ? `要从学习导航器移除“${selectedDisplayTitle}”吗？正式 Codex 对话不会被删除。`
        : `要从学习导航器移除“${selectedDisplayTitle}”及其 ${ids.size - 1} 个后代吗？正式 Codex 对话不会被删除。`,
      { modal: true },
      "从导航器删除",
    );
    if (confirmation !== "从导航器删除") return;
    const hiddenTurnIds = new Set(this.#document.hiddenTurnIds);
    for (const id of ids) hiddenTurnIds.add(id);
    const deletingRoot = selected?.parentNodeId === null;
    const nodeActivity = Object.fromEntries(
      Object.entries(this.#document.nodeActivity).filter(([nodeId]) => !ids.has(nodeId)),
    );
    const nodeLabels = Object.fromEntries(
      Object.entries(this.#document.nodeLabels).filter(([nodeId]) => !ids.has(nodeId)),
    );
    await this.#commitUser({
      ...this.#document,
      rootThreadId: deletingRoot ? null : this.#document.rootThreadId,
      hiddenTurnIds: deletingRoot ? [] : [...hiddenTurnIds],
      frozenRootNodeIds: deletingRoot
        ? []
        : this.#document.frozenRootNodeIds.filter((nodeId) => !ids.has(nodeId)),
      nodeActivity: deletingRoot ? {} : nodeActivity,
      nodeLabels: deletingRoot ? {} : nodeLabels,
      nodes: this.#document.nodes.filter((node) => !ids.has(node.id)),
    });
    const temporaryThreads = this.#document.temporaryForks
      .filter((fork) => ids.has(fork.nodeId))
      .map((fork) => fork.threadId);
    if (this.#activeTemporaryThreadId && temporaryThreads.includes(this.#activeTemporaryThreadId)) {
      this.#activeTemporaryThreadId = null;
    }
    for (const threadId of temporaryThreads) await this.#scheduleTemporaryFork(threadId);
    this.#selectedNodeId = null;
    this.#setMessage(
      `已从导航表移除 ${ids.size} 个节点；正式 Codex 历史不会删除，本扩展创建且未提问的临时定位分支会按计划清理。`,
      false,
    );
  }

  async undo(): Promise<void> {
    const previous = this.#history.undo(this.#document);
    if (!previous) return;
    this.#document = previous;
    this.#repairSelection();
    await this.#store.write(this.#document);
    this.#emit();
  }

  async redo(): Promise<void> {
    const next = this.#history.redo(this.#document);
    if (!next) return;
    this.#document = next;
    this.#repairSelection();
    await this.#store.write(this.#document);
    this.#emit();
  }

  async toggleCollapse(nodeId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.#commitUser({
      ...this.#document,
      nodes: this.#document.nodes.map((node) =>
        node.id === nodeId ? { ...node, collapsed: !node.collapsed, updatedAt: now } : node,
      ),
    });
  }

  async editNodeLabel(nodeId: string): Promise<void> {
    const node = this.#document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const currentLabel = this.#document.nodeLabels[nodeId] ?? "";
    const input = await vscode.window.showInputBox({
      title: "节点展示标签",
      prompt: "标签会替代原问题显示在泳道中；清空输入可恢复显示原问题。",
      placeHolder: node.title,
      value: currentLabel,
      valueSelection: [0, currentLabel.length],
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (/[\r\n]/u.test(value)) return "标签只能占一行。";
        if (value.trim().length > 80) return "标签最多 80 个字符。";
        return null;
      },
    });
    if (input === undefined) return;
    const label = input.trim();
    const nodeLabels = { ...this.#document.nodeLabels };
    if (label) nodeLabels[nodeId] = label;
    else delete nodeLabels[nodeId];
    if ((currentLabel || "") === label) return;
    await this.#commitUser({ ...this.#document, nodeLabels });
    this.#setMessage(label ? `已将节点显示标签设为“${label}”。` : "已清除节点标签，恢复显示原问题。", false);
  }

  async toggleFreeze(nodeId: string): Promise<void> {
    const node = this.#document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const wasFrozen = frozenNodeRootMap(
      this.#document.nodes,
      this.#document.frozenRootNodeIds,
    ).has(nodeId);
    const nextFrozenRoots = toggleFrozenRoot(
      this.#document.nodes,
      this.#document.frozenRootNodeIds,
      nodeId,
    );
    await this.#commitUser({
      ...this.#document,
      frozenRootNodeIds: nextFrozenRoots,
    });
    this.#setMessage(
      wasFrozen
        ? "已解除该分支的冻结归档。"
        : "已冻结该节点及其全部子节点；这是学习泳道归档，不会归档官方 Codex 任务。",
      false,
    );
  }

  async setTextMode(textMode: "wrap" | "ellipsis"): Promise<void> {
    await this.#commitUser({
      ...this.#document,
      preferences: { ...this.#document.preferences, textMode },
    });
  }

  async setFontScale(fontScale: number): Promise<void> {
    await this.#commitUser({
      ...this.#document,
      preferences: { ...this.#document.preferences, fontScale: clampFontScale(fontScale) },
    });
  }

  async setTableScale(tableScale: number): Promise<void> {
    await this.#commitUser({
      ...this.#document,
      preferences: {
        ...this.#document.preferences,
        tableScale: clampTableScale(tableScale),
        autoFit: false,
      },
    });
  }

  async setAutoFit(autoFit: boolean): Promise<void> {
    await this.#commitUser({
      ...this.#document,
      preferences: { ...this.#document.preferences, autoFit },
    });
  }

  async resetCompactLayout(): Promise<void> {
    await this.#commitUser({
      ...this.#document,
      preferences: {
        ...this.#document.preferences,
        tableScale: 0.85,
        autoFit: true,
        defaultColumnWidth: 210,
        defaultRowHeight: 88,
        columnWidths: {},
        rowHeights: {},
      },
    });
  }

  setNavigatorVisible(visible: boolean): void {
    const becameVisible = visible && !this.#navigatorVisible;
    this.#navigatorVisible = visible;
    if (becameVisible) void this.#pollOfficialTasks();
  }

  async resizeColumn(laneKey: string, width: number): Promise<void> {
    await this.#commitUser({
      ...this.#document,
      preferences: {
        ...this.#document.preferences,
        columnWidths: {
          ...this.#document.preferences.columnWidths,
          [laneKey]: clampColumnWidth(width),
        },
      },
    });
  }

  async resizeRow(depth: number, height: number): Promise<void> {
    await this.#commitUser({
      ...this.#document,
      preferences: {
        ...this.#document.preferences,
        rowHeights: {
          ...this.#document.preferences.rowHeights,
          [String(depth)]: clampRowHeight(height),
        },
      },
    });
  }

  async #pollOfficialTasks(): Promise<void> {
    if (
      this.#polling ||
      this.#busy ||
      this.#disposed ||
      !this.#navigatorVisible ||
      !vscode.window.state.focused ||
      !this.#document.rootThreadId
    ) {
      return;
    }
    this.#polling = true;
    try {
      await this.#syncOfficialTasks();
      await this.#maintainTemporaryForks();
    } catch {
      // Manual sync exposes actionable errors. Polling remains deliberately quiet.
    } finally {
      this.#polling = false;
    }
  }

  async #syncOfficialTasks(): Promise<void> {
    const rootThreadId = this.#document.rootThreadId;
    if (!rootThreadId) return;
    let rootSnapshot = this.#snapshotCache.get(rootThreadId);
    if (!rootSnapshot) {
      rootSnapshot = await this.#bridge.readThread(rootThreadId);
      this.#snapshotCache.set(rootThreadId, rootSnapshot);
    }
    const cwd = rootSnapshot.cwd ?? this.#workspaceFolder.uri.fsPath;
    const workspaceThreads = await this.#bridge.listWorkspaceThreads(cwd);
    const listedById = new Map<string, CodexListedThread>();
    for (const thread of workspaceThreads) listedById.set(thread.id, thread);

    const rootListed = listedById.get(rootThreadId);
    const idsToRead = new Set(listedById.keys());
    idsToRead.add(rootThreadId);
    for (const fork of this.#document.temporaryForks) {
      if (fork.state !== "archived") idsToRead.add(fork.threadId);
    }
    await Promise.all(
      [...idsToRead].map(async (threadId) => {
        const listed = listedById.get(threadId);
        const cached = this.#snapshotCache.get(threadId);
        if (cached && listed && cached.updatedAt === listed.updatedAt) {
          return;
        }
        this.#snapshotCache.set(threadId, await this.#bridge.readThread(threadId));
      }),
    );
    if (!rootListed) {
      listedById.set(rootThreadId, listedFromSnapshot(rootSnapshot));
    }

    const promotedThreadIds = new Set(
      this.#document.temporaryForks.flatMap((fork) => {
        const snapshot = this.#snapshotCache.get(fork.threadId);
        return snapshot && snapshotHasTurnAfterBase(snapshot, fork.baseTurnId)
          ? [fork.threadId]
          : [];
      }),
    );
    if (this.#activeTemporaryThreadId && promotedThreadIds.has(this.#activeTemporaryThreadId)) {
      this.#activeTemporaryThreadId = null;
    }
    const remainingTemporaryForks = this.#document.temporaryForks.filter(
      (fork) => !promotedThreadIds.has(fork.threadId),
    );
    for (const fork of remainingTemporaryForks) {
      if (fork.state === "archived" || listedById.has(fork.threadId)) continue;
      const snapshot = this.#snapshotCache.get(fork.threadId);
      if (snapshot) listedById.set(fork.threadId, listedFromSnapshot(snapshot));
    }

    const nodes = buildSyncedTurnNodes(
      rootThreadId,
      [...listedById.values()],
      this.#snapshotCache,
      this.#document.nodes,
      new Set(this.#document.hiddenTurnIds),
    );
    const nextDocument = {
      ...this.#document,
      temporaryForks: remainingTemporaryForks,
      frozenRootNodeIds: this.#document.frozenRootNodeIds.filter((nodeId) =>
        nodes.some((node) => node.id === nodeId),
      ),
      nodeActivity: Object.fromEntries(
        Object.entries(this.#document.nodeActivity).filter(([nodeId]) =>
          nodes.some((node) => node.id === nodeId),
        ),
      ),
      nodes,
    };
    if (JSON.stringify(nextDocument) === JSON.stringify(this.#document)) return;
    await this.#commitSystem(nextDocument);
    if (promotedThreadIds.size > 0) {
      this.#setMessage("检测到临时分支中的新问题：已转为正式分支并同步到泳道。", false);
    }
    this.#repairSelection();
  }

  async #scheduleRecoveredTemporaryForks(): Promise<void> {
    const recovered = this.#document.temporaryForks.map((fork) =>
      fork.state === "waiting" ? scheduleTemporaryForkCleanup(fork) : fork,
    );
    if (JSON.stringify(recovered) === JSON.stringify(this.#document.temporaryForks)) return;
    await this.#commitSystem({ ...this.#document, temporaryForks: recovered });
  }

  async #upsertTemporaryFork(fork: TemporaryFork): Promise<void> {
    const exists = this.#document.temporaryForks.some(
      (candidate) => candidate.threadId === fork.threadId,
    );
    const temporaryForks = exists
      ? this.#document.temporaryForks.map((candidate) =>
          candidate.threadId === fork.threadId ? fork : candidate,
        )
      : [...this.#document.temporaryForks, fork];
    await this.#commitSystem({ ...this.#document, temporaryForks });
  }

  async #scheduleTemporaryFork(threadId: string): Promise<void> {
    const temporaryForks = this.#document.temporaryForks.map((fork) =>
      fork.threadId === threadId ? scheduleTemporaryForkCleanup(fork) : fork,
    );
    if (JSON.stringify(temporaryForks) === JSON.stringify(this.#document.temporaryForks)) return;
    await this.#commitSystem({ ...this.#document, temporaryForks });
  }

  async #maintainTemporaryForks(): Promise<void> {
    if (this.#document.temporaryForks.length === 0) return;
    const cwd =
      (this.#document.rootThreadId
        ? this.#snapshotCache.get(this.#document.rootThreadId)?.cwd
        : null) ?? this.#workspaceFolder.uri.fsPath;
    const retained: TemporaryFork[] = [];
    let storageChanged = false;
    let taskSetChanged = false;
    for (const fork of this.#document.temporaryForks) {
      if (fork.threadId === this.#activeTemporaryThreadId) {
        retained.push(fork);
        continue;
      }
      let snapshot: CodexThreadSnapshot;
      try {
        snapshot = await this.#bridge.readThread(fork.threadId);
      } catch {
        retained.push(fork);
        continue;
      }
      this.#snapshotCache.set(fork.threadId, snapshot);
      let action = decideTemporaryForkMaintenance(fork, snapshot, Date.now(), false);
      if (action === "delete") {
        try {
          const descendants = await this.#bridge.listDescendantThreads(fork.threadId, cwd);
          action = decideTemporaryForkMaintenance(
            fork,
            snapshot,
            Date.now(),
            descendants.length > 0,
          );
        } catch {
          action = "none";
        }
      }
      if (action === "promote") {
        if (fork.state === "archived") await this.#bridge.unarchiveThread(fork.threadId);
        storageChanged = true;
        taskSetChanged = true;
        continue;
      }
      if (action === "delete") {
        await this.#bridge.deleteThread(fork.threadId);
        this.#snapshotCache.delete(fork.threadId);
        storageChanged = true;
        taskSetChanged = true;
        continue;
      }
      retained.push(fork);
    }
    if (storageChanged) {
      await this.#commitSystem({ ...this.#document, temporaryForks: retained });
    }
    if (taskSetChanged) await this.#syncOfficialTasks();
  }

  async #withBusy(action: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#transientMessage = null;
    this.#emit();
    try {
      await action();
    } catch (error) {
      const message = errorMessage(error);
      this.#setMessage(message, true);
      void vscode.window.showErrorMessage(`Learning Navigator：${message}`);
    } finally {
      this.#busy = false;
      this.#emit();
    }
  }

  async #commitUser(document: LearningDocument): Promise<void> {
    this.#history.record(this.#document);
    this.#document = cloneDocument(document);
    await this.#store.write(this.#document);
    this.#emit();
  }

  async #commitSystem(document: LearningDocument): Promise<void> {
    this.#document = cloneDocument(document);
    await this.#store.write(this.#document);
    this.#emit();
  }

  async #recordNodeVisit(nodeId: string): Promise<void> {
    const previous = this.#document.nodeActivity[nodeId];
    await this.#commitSystem({
      ...this.#document,
      nodeActivity: {
        ...this.#document.nodeActivity,
        [nodeId]: {
          visitCount: (previous?.visitCount ?? 0) + 1,
          lastVisitedAt: new Date().toISOString(),
        },
      },
    });
  }

  #selectedNodePreview(): LearningNodePreview | null {
    const node = this.#document.nodes.find((candidate) => candidate.id === this.#selectedNodeId);
    if (!node) return null;
    const nodesById = new Map(this.#document.nodes.map((candidate) => [candidate.id, candidate]));
    const path: string[] = [];
    const seen = new Set<string>();
    let cursor = node.parentNodeId ? nodesById.get(node.parentNodeId) : undefined;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      path.unshift(this.#document.nodeLabels[cursor.id] ?? cursor.title);
      cursor = cursor.parentNodeId ? nodesById.get(cursor.parentNodeId) : undefined;
    }
    let turn = undefined;
    for (const threadId of [node.threadId, ...node.containingThreadIds]) {
      turn = this.#snapshotCache.get(threadId)?.turns.find((candidate) => candidate.id === node.turnId);
      if (turn) break;
    }
    const activity = this.#document.nodeActivity[node.id];
    const answerMarkdown = turn ? extractAnswerPreview(turn) : null;
    const questionMarkdown = turn ? extractQuestionMarkdown(turn) : node.title;
    return {
      nodeId: node.id,
      label: this.#document.nodeLabels[node.id] ?? null,
      question: node.title,
      questionHtml: renderSnapshotMarkdown(questionMarkdown),
      answerHtml: answerMarkdown ? renderSnapshotMarkdown(answerMarkdown) : null,
      answerState: answerMarkdown
        ? "ready"
        : node.runtimeState === "running" || node.runtimeState === "waiting"
          ? "running"
          : "unavailable",
      path,
      childCount: this.#document.nodes.filter((candidate) => candidate.parentNodeId === node.id).length,
      descendantCount: Math.max(0, subtreeNodeIds(this.#document.nodes, node.id).size - 1),
      visitCount: activity?.visitCount ?? 0,
      lastVisitedAt: activity?.lastVisitedAt ?? null,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }

  #repairSelection(): void {
    if (
      this.#selectedNodeId &&
      !this.#document.nodes.some((node) => node.id === this.#selectedNodeId)
    ) {
      this.#selectedNodeId = null;
    }
  }

  #setMessage(message: string, isError: boolean): void {
    this.#transientMessage = message;
    if (isError) this.#compatibility = { ...this.#compatibility, message };
    this.#emit();
  }

  #emit(): void {
    if (!this.#disposed) this.#stateEmitter.fire(this.getState());
  }

  dispose(): void {
    this.#disposed = true;
    clearInterval(this.#pollTimer);
    if (this.#activeTemporaryThreadId) {
      void this.#scheduleTemporaryFork(this.#activeTemporaryThreadId);
      this.#activeTemporaryThreadId = null;
    }
    this.#stateEmitter.dispose();
    this.#bridge.dispose();
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
