import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
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
  readonly #threadParentCache = new Map<string, string | null>();
  #client: AppServerClient | null = null;
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

  async listAllRootThreads(): Promise<ReadonlyArray<CodexListedThread>> {
    const threads = await this.#listThreads({
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
      sourceKinds: ["vscode"],
    });
    const client = await this.#clientForRequest();
    const hydrated = await mapWithConcurrency(threads, 12, async (thread) => {
      if (thread.forkedFromId) {
        this.#threadParentCache.set(thread.id, thread.forkedFromId);
        return thread;
      }
      if (this.#threadParentCache.has(thread.id)) {
        return {
          ...thread,
          forkedFromId: this.#threadParentCache.get(thread.id) ?? null,
        };
      }
      try {
        const snapshot = parseThreadSnapshot(
          await client.request<unknown>("thread/read", {
            threadId: thread.id,
            includeTurns: false,
          }),
        );
        this.#threadParentCache.set(thread.id, snapshot.forkedFromId);
        return { ...thread, forkedFromId: snapshot.forkedFromId };
      } catch {
        // Keep an otherwise discoverable task when one lightweight summary read fails.
        return thread;
      }
    });
    return hydrated.filter((thread) => thread.forkedFromId === null);
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
    await vscode.commands.executeCommand("chatgpt.openSidebar");
    const deepLink = vscode.Uri.parse(buildSidebarDeepLink(threadId));
    const opened = await vscode.env.openExternal(deepLink);
    if (!opened) throw new Error("VS Code 拒绝打开官方 Codex 任务链接。");
  }

  async #listThreads(
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<ReadonlyArray<CodexListedThread>> {
    const client = await this.#clientForRequest();
    const threads = new Map<string, CodexListedThread>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const result = await client.request<unknown>("thread/list", {
        ...parameters,
        limit: 200,
        cursor,
      });
      const page = parseThreadListPage(result);
      for (const thread of page.data) threads.set(thread.id, thread);
      if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    return [...threads.values()];
  }

  async #clientForRequest(): Promise<AppServerClient> {
    const compatibility = await this.checkCompatibility();
    if (!this.#client) {
      this.#client = new AppServerClient(
        compatibility.executable,
        this.#extensionVersion,
      );
    }
    try {
      await this.#client.start();
      return this.#client;
    } catch (error) {
      this.#client.dispose();
      this.#client = null;
      throw error;
    }
  }

  async #releaseClient(client: AppServerClient): Promise<void> {
    if (this.#client === client) this.#client = null;
    await client.shutdown();
  }

  dispose(): void {
    this.#client?.dispose();
    this.#client = null;
  }
}

async function mapWithConcurrency<T, R>(
  values: ReadonlyArray<T>,
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<ReadonlyArray<R>> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        if (value !== undefined) results[index] = await mapper(value);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
