import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { mapWithConcurrency } from "./threadDiscovery.js";
import { AppServerClient } from "./appServerClient.js";
import {
  bundledCodexRelativePath,
  inspectCodexEntrypoint,
  inspectCodexPackage,
} from "./compatibility.js";
import {
  buildSidebarDeepLink,
  parseThreadId,
  parseThreadListPage,
  parseThreadSnapshot,
} from "./protocol.js";
import type { CodexListedThread, CodexThreadSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const CODEX_EXTENSION_ID = "openai.chatgpt";

export interface CodexCompatibility {
  readonly extensionVersion: string;
  readonly appServerVersion: string;
  readonly executable: string;
  readonly sidebarViewId: string;
}

export class CodexBridge implements vscode.Disposable {
  readonly #extensionVersion: string;
  readonly #threadParentCache = new Map<string, Pick<CodexListedThread, "forkedFromId" | "parentKnown">>();
  readonly #parentReads = new Map<string, Promise<Pick<CodexListedThread, "forkedFromId" | "parentKnown">>>();
  #rootCache: ReadonlyArray<CodexListedThread> = [];

  get cachedRootThreads(): ReadonlyArray<CodexListedThread> { return this.#rootCache; }
  #client: AppServerClient | null = null;
  #releasingClient: { client: AppServerClient; promise: Promise<void> } | null = null;
  #disposed = false;
  #compatibility: CodexCompatibility | null = null;

  constructor(extensionVersion: string) {
    this.#extensionVersion = extensionVersion;
  }

  async checkCompatibility(): Promise<CodexCompatibility> {
    if (this.#compatibility) return this.#compatibility;
    const extension = vscode.extensions.getExtension(CODEX_EXTENSION_ID);
    if (!extension) {
      const remoteHint = vscode.env.remoteName
        ? `请在当前 ${vscode.env.remoteName} 扩展宿主中安装官方 Codex 扩展。`
        : "请先安装官方 OpenAI Codex 扩展。";
      throw new Error(`未找到 ${CODEX_EXTENSION_ID}。${remoteHint}`);
    }
    const inspected = inspectCodexPackage(extension.packageJSON);
    const detectedVersion = String(extension.packageJSON.version ?? "unknown");
    if (!inspected.ok || !inspected.sidebarViewId) {
      throw new Error(
        `官方 Codex ${detectedVersion} 不兼容：${inspected.reason ?? "缺少所需入口。"}`,
      );
    }
    await extension.activate();

    const main = extension.packageJSON.main;
    if (typeof main !== "string") {
      throw new Error(`官方 Codex ${detectedVersion} 不兼容：无法定位扩展入口文件。`);
    }
    const entrypointBytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(extension.extensionUri, main),
    );
    const entrypointIssue = inspectCodexEntrypoint(new TextDecoder().decode(entrypointBytes));
    if (entrypointIssue) {
      throw new Error(`官方 Codex ${detectedVersion} 不兼容：${entrypointIssue}`);
    }

    const relative = bundledCodexRelativePath(process.platform, process.arch);
    if (!relative) {
      throw new Error(`暂不支持当前扩展宿主平台：${process.platform}/${process.arch}。`);
    }
    const executable = path.join(extension.extensionUri.fsPath, relative);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(executable));
    } catch {
      throw new Error(`官方 Codex 扩展未携带当前平台的 App Server：${executable}`);
    }
    let appServerVersion = "unknown";
    try {
      const result = await execFileAsync(executable, ["--version"], {
        windowsHide: true,
        timeout: 10_000,
      });
      appServerVersion = result.stdout.trim().replace(/^codex-cli\s+/u, "") || "unknown";
    } catch {
      // The executable is present; starting App Server will provide the actionable error later.
    }
    this.#compatibility = {
      extensionVersion: detectedVersion,
      appServerVersion,
      executable,
      sidebarViewId: inspected.sidebarViewId,
    };
    return this.#compatibility;
  }

  async readThread(threadId: string): Promise<CodexThreadSnapshot> {
    const client = await this.#clientForRequest();
    const result = await client.request<unknown>("thread/read", { threadId, includeTurns: true });
    return parseThreadSnapshot(result);
  }

  async listWorkspaceThreads(cwd: string): Promise<ReadonlyArray<CodexListedThread>> {
    return this.#listThreads({
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
      cwd,
      sourceKinds: ["vscode"],
    });
  }

  async #readParent(threadId: string): Promise<Pick<CodexListedThread, "forkedFromId" | "parentKnown">> {
    const cached = this.#threadParentCache.get(threadId);
    if (cached) return cached;
    const pending = this.#parentReads.get(threadId);
    if (pending) return pending;
    const read = this.#loadParent(threadId);
    this.#parentReads.set(threadId, read);
    try { return await read; }
    finally { this.#parentReads.delete(threadId); }
  }

  async #loadParent(threadId: string): Promise<Pick<CodexListedThread, "forkedFromId" | "parentKnown">> {
    const client = await this.#clientForRequest();
    const snapshot = parseThreadSnapshot(await client.request<unknown>("thread/read", {
      threadId,
      includeTurns: false,
    }));
    const parent = { forkedFromId: snapshot.forkedFromId, parentKnown: snapshot.parentKnown ?? false };
    if (parent.parentKnown) {
      this.#threadParentCache.set(threadId, parent);
      if (this.#threadParentCache.size > 10_000) {
        this.#threadParentCache.delete(this.#threadParentCache.keys().next().value!);
      }
    }
    return parent;
  }

  async #hydrateParents(
    threads: ReadonlyArray<CodexListedThread>,
    signal?: AbortSignal,
    onThread?: (thread: CodexListedThread) => void,
  ): Promise<ReadonlyArray<CodexListedThread>> {
    return mapWithConcurrency(threads, 6, async thread => {
      let hydrated = thread;
      if (thread.forkedFromId) {
        this.#threadParentCache.set(thread.id, { forkedFromId: thread.forkedFromId, parentKnown: true });
      }
      if (!thread.parentKnown && !thread.forkedFromId) {
        try {
          hydrated = { ...thread, ...await this.#readParent(thread.id) };
        } catch {
          // Unknown ancestry must retain full-history fallback during branch sync.
        }
      }
      if (!signal?.aborted) onThread?.(hydrated);
      return hydrated;
    }, signal);
  }

  async resolveRootThread(threadId: string): Promise<string> {
    return await this.#resolveVerifiedRoot(threadId) ?? threadId;
  }

  async #resolveVerifiedRoot(threadId: string): Promise<string | null> {
    let current = threadId;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const parent = await this.#readParent(current);
      if (!parent.parentKnown) return null;
      if (!parent.forkedFromId) return current;
      current = parent.forkedFromId;
    }
    throw new Error("Codex 对话父关系出现循环，无法确认根对话。");
  }

  async listRelatedThreads(rootId: string, cwd: string): Promise<ReadonlyArray<CodexListedThread>> {
    const threads = await this.#hydrateParents(await this.listWorkspaceThreads(cwd));
    const roots = await mapWithConcurrency(threads, 6, async thread => {
      if (!thread.parentKnown && !thread.forkedFromId) return null;
      try {
        // An active child can descend through archived or otherwise unlisted intermediates.
        return await this.#resolveVerifiedRoot(thread.id);
      } catch {
        return null;
      }
    });
    // Keep uncertain candidates for turn-prefix inference; exclude only confirmed unrelated trees.
    return threads.filter((_thread, index) => roots[index] === rootId || roots[index] === null);
  }

  async listAllRootThreads(
    onUpdate?: (roots: ReadonlyArray<CodexListedThread>) => void,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<CodexListedThread>> {
    const roots = new Map<string, CodexListedThread>();
    const publish = (): void => {
      // Keep verified cached choices until their page is refreshed or the scan completes.
      this.#rootCache = [...new Map([...this.#rootCache, ...roots.values()].map(thread => [thread.id, thread])).values()];
      onUpdate?.(this.#rootCache);
    };
    await this.#listThreads({
      sortKey: "updated_at", sortDirection: "desc", archived: false, sourceKinds: ["vscode"],
    }, async page => {
      await this.#hydrateParents(page, signal, thread => {
        if (thread.parentKnown && thread.forkedFromId === null) {
          roots.set(thread.id, thread);
          publish();
        } else if (thread.forkedFromId) {
          this.#rootCache = this.#rootCache.filter(cached => cached.id !== thread.id);
        }
      });
    }, signal, 25);
    this.#rootCache = [...roots.values()];
    onUpdate?.(this.#rootCache);
    return this.#rootCache;
  }

  async forkThread(threadId: string, lastTurnId: string): Promise<{ threadId: string }> {
    const client = await this.#clientForRequest();
    try {
      const result = await client.request<unknown>("thread/fork", { threadId, lastTurnId });
      const forkedThreadId = parseThreadId(result);
      try {
        await client.request<unknown>("thread/unsubscribe", { threadId: forkedThreadId });
      } catch {
        // A freshly forked thread may not have an explicit subscription. Process shutdown below
        // is the authoritative handoff to the official Codex extension.
      }
      return { threadId: forkedThreadId };
    } finally {
      await this.#releaseClient(client);
    }
  }

  async archiveThread(threadId: string): Promise<void> {
    const client = await this.#clientForRequest();
    await client.request<unknown>("thread/archive", { threadId });
  }

  async unarchiveThread(threadId: string): Promise<void> {
    const client = await this.#clientForRequest();
    try {
      await client.request<unknown>("thread/unarchive", { threadId });
    } finally {
      // An archived temporary fork may be opened in the native sidebar immediately afterward.
      await this.#releaseClient(client);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const client = await this.#clientForRequest();
    await client.request<unknown>("thread/delete", { threadId });
  }

  async listDescendantThreads(
    threadId: string,
    cwd: string,
  ): Promise<ReadonlyArray<CodexListedThread>> {
    const request = async (archived: boolean): Promise<ReadonlyArray<CodexListedThread>> =>
      this.#listThreads({
        sortKey: "updated_at",
        sortDirection: "desc",
        archived,
        cwd,
        sourceKinds: ["vscode"],
        ancestorThreadId: threadId,
      });
    const [active, archived] = await Promise.all([request(false), request(true)]);
    return [...new Map([...active, ...archived].map((thread) => [thread.id, thread])).values()].filter(
      (thread) => thread.id !== threadId,
    );
  }

  async openSidebarThread(threadId: string): Promise<void> {
    await this.checkCompatibility();
    await this.#waitForClientRelease();
    if (this.#disposed) throw new Error("Codex bridge is disposed.");
    await vscode.commands.executeCommand("chatgpt.openSidebar");
    const deepLink = vscode.Uri.parse(buildSidebarDeepLink(threadId));
    const opened = await vscode.env.openExternal(deepLink);
    if (!opened) throw new Error("VS Code 拒绝打开官方 Codex 任务链接。");
  }

  async #listThreads(
    parameters: Readonly<Record<string, unknown>>,
    onPage?: (page: ReadonlyArray<CodexListedThread>) => Promise<void>,
    signal?: AbortSignal,
    firstPageLimit = 200,
  ): Promise<ReadonlyArray<CodexListedThread>> {
    const client = await this.#clientForRequest();
    const threads = new Map<string, CodexListedThread>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
      signal?.throwIfAborted();
      const result = await client.request<unknown>("thread/list", {
        ...parameters,
        limit: pageNumber === 0 ? firstPageLimit : 200,
        cursor,
      });
      const page = parseThreadListPage(result);
      signal?.throwIfAborted();
      for (const thread of page.data) threads.set(thread.id, thread);
      await onPage?.(page.data);
      if (!page.nextCursor) return [...threads.values()];
      if (seenCursors.has(page.nextCursor)) {
        throw new Error("Codex 对话列表游标重复，未完成扫描；请重新同步。");
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error("Codex 对话列表超过扫描页数上限，未完成扫描；请重新同步。");
  }

  async #clientForRequest(): Promise<AppServerClient> {
    if (this.#disposed) throw new Error("Codex bridge is disposed.");
    const compatibility = await this.checkCompatibility();
    await this.#waitForClientRelease();
    if (this.#disposed) throw new Error("Codex bridge is disposed.");
    if (!this.#client) {
      this.#client = new AppServerClient(
        compatibility.executable,
        this.#extensionVersion,
      );
    }
    const client = this.#client;
    try {
      await client.start();
      return client;
    } catch (error) {
      if (this.#client === client) this.#client = null;
      void this.#releaseClient(client).catch(() => {
        // Preserve the startup error; a later request retries the remembered cleanup.
      });
      throw error;
    }
  }

  async #waitForClientRelease(): Promise<void> {
    const release = this.#releasingClient;
    if (!release) return;
    try {
      await release.promise;
    } catch {
      if (this.#releasingClient === release) await this.#releaseClient(release.client, true);
      else if (this.#releasingClient) await this.#releasingClient.promise;
    }
  }

  async #releaseClient(client: AppServerClient, retry = false): Promise<void> {
    if (!retry && this.#releasingClient?.client === client) return this.#releasingClient.promise;
    if (this.#client === client) this.#client = null;
    const release = { client, promise: client.shutdown() };
    this.#releasingClient = release;
    await release.promise;
    if (this.#releasingClient === release) this.#releasingClient = null;
  }

  dispose(): void {
    this.#disposed = true;
    this.#client?.dispose();
    this.#releasingClient?.client.dispose();
    this.#client = null;
  }
}
