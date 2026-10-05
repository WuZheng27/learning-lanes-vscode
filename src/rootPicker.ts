import * as vscode from "vscode";
import type { CodexListedThread } from "./types.js";
import { buildRootThreadChoices, type RootThreadChoice } from "./rootThreads.js";

export function pickRootThread(
  cached: ReadonlyArray<CodexListedThread>,
  refresh: (update: (threads: ReadonlyArray<CodexListedThread>) => void, signal: AbortSignal) => Promise<ReadonlyArray<CodexListedThread>>,
  rootId: string | null, cwd: string, excluded: ReadonlySet<string>,
): Promise<RootThreadChoice | undefined> {
  const picker = vscode.window.createQuickPick<RootThreadChoice>();
  const abort = new AbortController();
  picker.title = "更换学习泳道根对话（已隐藏所有分支）";
  picker.placeholder = "搜索标题、项目路径或任务 ID；正在后台刷新…";
  picker.matchOnDescription = true; picker.matchOnDetail = true; picker.busy = true;
  const update = (threads: ReadonlyArray<CodexListedThread>): void => {
    if (abort.signal.aborted) return;
    const active = picker.activeItems[0]?.thread.id;
    picker.items = buildRootThreadChoices(threads, rootId, cwd, excluded);
    const selected = picker.items.find(item => item.thread.id === active);
    if (selected) picker.activeItems = [selected];
  };
  update(cached);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: RootThreadChoice, error?: unknown): void => {
      if (settled) return;
      settled = true; abort.abort();
      accept.dispose(); hide.dispose(); picker.dispose();
      if (error) reject(error); else resolve(value);
    };
    const accept = picker.onDidAccept(() => {
      const selected = picker.selectedItems[0];
      if (selected) finish(selected);
    });
    const hide = picker.onDidHide(() => finish());
    picker.show();
    void refresh(update, abort.signal).then(threads => {
      if (settled) return;
      update(threads); picker.busy = false;
      picker.placeholder = picker.items.length ? "搜索全部官方 Codex 根对话" : "没有找到官方 Codex 根对话";
    }, error => { if (!settled) finish(undefined, error); });
  });
}
