import * as vscode from "vscode";
import { NavigatorController } from "./controller.js";
import type { NavigatorViewState } from "./types.js";

interface WebviewMessage {
  readonly type?: unknown;
  readonly nodeId?: unknown;
  readonly textMode?: unknown;
  readonly fontScale?: unknown;
  readonly tableScale?: unknown;
  readonly autoFit?: unknown;
  readonly href?: unknown;
  readonly laneKey?: unknown;
  readonly width?: unknown;
  readonly depth?: unknown;
  readonly height?: unknown;
}

export class NavigatorPanel implements vscode.Disposable {
  static #current: NavigatorPanel | null = null;
  readonly #panel: vscode.WebviewPanel;
  readonly #controller: NavigatorController;
  readonly #disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, controller: NavigatorController) {
    this.#panel = panel;
    this.#controller = controller;
    panel.webview.html = webviewHtml(panel.webview);
    this.#disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.onDidChangeViewState(() => {
        this.#controller.setNavigatorVisible(panel.visible);
        if (panel.visible) this.#postState(this.#controller.getState());
      }),
      panel.webview.onDidReceiveMessage((message) => void this.#handleMessage(message)),
      controller.onDidChangeState((state) => this.#postState(state)),
    );
    this.#controller.setNavigatorVisible(panel.visible);
    this.#postState(controller.getState());
  }

  static createOrShow(controller: NavigatorController): NavigatorPanel {
    if (NavigatorPanel.#current) {
      NavigatorPanel.#current.#panel.reveal(vscode.ViewColumn.Active, false);
      NavigatorPanel.#current.#postState(controller.getState());
      return NavigatorPanel.#current;
    }
    const panel = vscode.window.createWebviewPanel(
      "learningNavigator.table",
      "学习泳道",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    NavigatorPanel.#current = new NavigatorPanel(panel, controller);
    return NavigatorPanel.#current;
  }

  async #handleMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") return;
    const message = raw as WebviewMessage;
    switch (message.type) {
      case "ready":
        this.#postState(this.#controller.getState());
        break;
      case "selectRoot":
        await this.#controller.selectRoot();
        break;
      case "sync":
        await this.#controller.sync();
        break;
      case "delete":
        await this.#controller.deleteSelected();
        break;
      case "undo":
        await this.#controller.undo();
        break;
      case "redo":
        await this.#controller.redo();
        break;
      case "selectNode":
        if (typeof message.nodeId === "string") this.#controller.selectNode(message.nodeId);
        break;
      case "openNode":
        if (typeof message.nodeId === "string") await this.#controller.openNode(message.nodeId);
        break;
      case "toggleCollapse":
        if (typeof message.nodeId === "string") {
          await this.#controller.toggleCollapse(message.nodeId);
        }
        break;
      case "toggleFreeze":
        if (typeof message.nodeId === "string") {
          await this.#controller.toggleFreeze(message.nodeId);
        }
        break;
      case "setTextMode":
        if (message.textMode === "wrap" || message.textMode === "ellipsis") {
          await this.#controller.setTextMode(message.textMode);
        }
        break;
      case "setFontScale":
        if (typeof message.fontScale === "number") {
          await this.#controller.setFontScale(message.fontScale);
        }
        break;
      case "setTableScale":
        if (typeof message.tableScale === "number") {
          await this.#controller.setTableScale(message.tableScale);
        }
        break;
      case "setAutoFit":
        if (typeof message.autoFit === "boolean") {
          await this.#controller.setAutoFit(message.autoFit);
        }
        break;
      case "resetCompactLayout":
        await this.#controller.resetCompactLayout();
        break;
      case "openLink":
        if (typeof message.href === "string") await openSafeExternal(message.href);
        break;
      case "resizeColumn":
        if (typeof message.laneKey === "string" && typeof message.width === "number") {
          await this.#controller.resizeColumn(message.laneKey, message.width);
        }
        break;
      case "resizeRow":
        if (typeof message.depth === "number" && typeof message.height === "number") {
          await this.#controller.resizeRow(message.depth, message.height);
        }
        break;
    }
  }

  #postState(state: NavigatorViewState): void {
    void this.#panel.webview.postMessage({ type: "state", state });
  }

  dispose(): void {
    if (NavigatorPanel.#current === this) NavigatorPanel.#current = null;
    this.#controller.setNavigatorVisible(false);
    while (this.#disposables.length > 0) this.#disposables.pop()?.dispose();
  }
}

async function openSafeExternal(href: string): Promise<void> {
  try {
    const uri = vscode.Uri.parse(href, true);
    if (uri.scheme !== "http" && uri.scheme !== "https" && uri.scheme !== "mailto") return;
    await vscode.env.openExternal(uri);
  } catch {
    // Sanitized snapshot links are best-effort only.
  }
}

function webviewHtml(webview: vscode.Webview): string {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "font-src 'none'",
    "img-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
  ].join("; ");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>学习泳道</title>
  <style>
    :root { color-scheme: light dark; --activity-accent: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); --structure-border: var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-panel-border))); --reading-font: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--reading-font); font-size: var(--vscode-font-size); overflow: hidden; }
    #app { display: flex; flex-direction: column; width: 100%; height: 100vh; min-height: 0; overflow: hidden; }
    button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-button-border, var(--structure-border)); border-radius: 4px; min-height: 28px; padding: 0 10px; cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible, .node:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
    button:disabled { opacity: .45; cursor: default; }
    .toolbar { z-index: 30; display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 45px; padding: 8px 10px; border-bottom: 1px solid var(--structure-border); background: var(--vscode-editor-background); }
    .toolbar .spacer { flex: 1 1 12px; min-width: 12px; }
    .toolbar .mode { min-width: 74px; }
    .zoom-controls { display: inline-flex; align-items: stretch; }
    .zoom-controls button { min-width: 32px; border-radius: 0; margin-left: -1px; }
    .zoom-controls button:first-child { margin-left: 0; border-radius: 4px 0 0 4px; }
    .zoom-controls button:last-child { border-radius: 0 4px 4px 0; }
    .zoom-value { min-width: 48px !important; color: var(--vscode-descriptionForeground); }
    .control-label { align-self: center; margin-left: 5px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .status { flex: 0 0 auto; min-height: 32px; padding: 7px 12px; border-bottom: 1px solid var(--structure-border); color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); }
    .status.error { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); }
    .status.ok { color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground)); }
    .empty { flex: 1 1 auto; padding: 64px 24px; text-align: center; color: var(--vscode-descriptionForeground); overflow: auto; }
    .snapshot-dialog { width: min(920px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); max-width: none; max-height: none; margin: auto; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); border: 1px solid var(--structure-border); border-radius: 8px; font-family: var(--reading-font); overflow: hidden; }
    .snapshot-dialog::backdrop { background: color-mix(in srgb, var(--vscode-editor-background) 44%, transparent); backdrop-filter: blur(2px); }
    .snapshot-shell { display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; }
    .snapshot-dialog-header { display: flex; flex: 0 0 auto; align-items: center; min-height: 48px; padding: 8px 12px 8px 16px; border-bottom: 1px solid var(--structure-border); }
    .snapshot-dialog-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 650; }
    .snapshot-close { min-width: 32px; padding: 0 8px; border: 0; background: transparent; font-size: 20px; line-height: 1; }
    .inspector { display: grid; flex: 1 1 auto; min-height: 0; grid-template-columns: minmax(320px, 1fr) minmax(190px, 245px); gap: 16px; padding: 16px; background: var(--vscode-editor-background); }
    .inspector-main { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
    .eyebrow { margin-bottom: 5px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
    .breadcrumb { margin-bottom: 7px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .snapshot-question { font-size: calc(var(--vscode-editor-font-size, 13px) + 4px); font-weight: 650; line-height: 1.5; letter-spacing: .01em; overflow-wrap: anywhere; }
    .snapshot-question > :first-child { margin-top: 0; }
    .snapshot-question > :last-child { margin-bottom: 0; }
    .snapshot-answer { flex: 1 1 auto; min-height: 0; margin-top: 12px; padding: 2px 16px 4px 12px; border-left: 2px solid color-mix(in srgb, var(--activity-accent) 55%, var(--structure-border)); color: var(--vscode-foreground); font-size: calc(var(--vscode-editor-font-size, 13px) + 1px); line-height: 1.72; letter-spacing: .012em; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
    .snapshot-answer:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .snapshot-answer > :first-child { margin-top: 0; }
    .snapshot-answer > :last-child { margin-bottom: 0; }
    .snapshot-answer h1, .snapshot-answer h2, .snapshot-answer h3 { margin: .8em 0 .35em; line-height: 1.3; }
    .snapshot-answer h1 { font-size: 1.35em; } .snapshot-answer h2 { font-size: 1.2em; } .snapshot-answer h3 { font-size: 1.08em; }
    .snapshot-answer p, .snapshot-answer ul, .snapshot-answer ol, .snapshot-answer blockquote, .snapshot-answer pre, .snapshot-answer table { margin: .55em 0; }
    .snapshot-answer ul, .snapshot-answer ol { padding-left: 1.65em; }
    .snapshot-answer blockquote { padding-left: .8em; border-left: 3px solid var(--structure-border); color: var(--vscode-descriptionForeground); }
    .snapshot-answer code { padding: .08em .28em; border: 1px solid var(--structure-border); border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); }
    .snapshot-answer pre { padding: 8px 10px; overflow: auto; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--structure-border); }
    .snapshot-answer pre code { padding: 0; border: 0; background: transparent; }
    .snapshot-answer table { border-collapse: collapse; }
    .snapshot-answer th, .snapshot-answer td { padding: 4px 7px; border: 1px solid var(--structure-border); }
    .snapshot-answer a { color: var(--vscode-textLink-foreground); }
    .snapshot-answer .katex-display, .snapshot-answer math[display="block"] { display: block; max-width: 100%; margin: .7em 0; overflow-x: auto; overflow-y: hidden; text-align: center; }
    .snapshot-answer .snapshot-image-placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
    .snapshot-answer-state { margin-top: 9px; color: var(--vscode-descriptionForeground); font-style: italic; }
    .inspector-side { display: flex; min-height: 0; flex-direction: column; gap: 8px; padding-left: 14px; border-left: 1px solid var(--structure-border); overflow-y: auto; }
    .snapshot-meta { display: grid; grid-template-columns: auto 1fr; gap: 4px 9px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .snapshot-meta strong { color: var(--vscode-foreground); font-weight: 500; text-align: right; }
    .enter-hint { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.4; }
    .activity-legend { display: flex; align-items: center; gap: 6px; margin-top: 5px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .legend-mark { width: 18px; height: 4px; background: var(--activity-accent); }
    .legend-mark.soft { opacity: .35; }
    .legend-mark.strong { opacity: 1; margin-left: 4px; }
    .table-scroll { flex: 1 1 auto; min-height: 0; width: 100%; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
    .table { width: max-content; min-width: 100%; --node-font-scale: 1; border-top: 1px solid var(--structure-border); }
    .header, .lane-row { display: grid; position: relative; min-width: max-content; }
    .header { position: sticky; top: 0; z-index: 15; min-height: 38px; background: var(--vscode-editor-background); border-bottom: 2px solid var(--structure-border); }
    .lane-header { position: relative; display: flex; align-items: center; min-width: 0; padding: 0 var(--cell-pad-x, 11px); border-right: 1px solid var(--structure-border); font-weight: 600; gap: 7px; }
    .lane-header:first-child { border-left: 1px solid var(--structure-border); }
    .lane-symbol { color: var(--activity-accent); }
    .lane-activity { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; }
    .lane-header.heat-2 { border-top: 3px solid color-mix(in srgb, var(--activity-accent) 75%, transparent); }
    .lane-header.heat-3 { border-top: 3px solid var(--activity-accent); }
    .lane-header.frozen { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-descriptionForeground)); border-top-color: transparent; }
    .lane-header.frozen .lane-symbol { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
    .lane-header.frozen .lane-activity { display: none; }
    .column-resizer { position: absolute; top: 0; right: -4px; z-index: 5; width: 8px; height: 100%; cursor: col-resize; }
    .column-resizer:hover { border-right: 2px solid var(--vscode-focusBorder); }
    .column-resizer:focus-visible, .row-resizer:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
    .lane-row { border-left: 1px solid var(--structure-border); border-bottom: 1px solid var(--structure-border); background: var(--vscode-editor-background); }
    .lane-slot { min-width: 0; border-right: 1px solid var(--structure-border); background: color-mix(in srgb, var(--vscode-editor-background) 98%, var(--vscode-foreground)); }
    .lane-slot.frozen { background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-descriptionForeground)); }
    .node { position: relative; z-index: 2; min-width: 0; margin: -1px 0 0 -1px; padding: var(--cell-pad-y, 9px) var(--cell-pad-x, 11px) var(--cell-pad-y, 9px) calc(var(--cell-pad-x, 11px) + 3px); border: 1px solid var(--structure-border); background: var(--vscode-editor-background); cursor: pointer; overflow: hidden; }
    .node::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: transparent; }
    .node.heat-1::before { background: color-mix(in srgb, var(--activity-accent) 35%, transparent); }
    .node.heat-2::before { background: color-mix(in srgb, var(--activity-accent) 70%, transparent); }
    .node.heat-3::before { background: var(--activity-accent); }
    .node:hover { background: var(--vscode-list-hoverBackground); }
    .node.selected { border: 2px solid var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground, var(--vscode-foreground)); }
    .node.frozen { color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--vscode-editor-background) 87%, var(--vscode-descriptionForeground)); }
    .node.frozen::before { background: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
    .node.frozen .title { color: var(--vscode-descriptionForeground); }
    .node.frozen.selected { border-color: var(--vscode-focusBorder); background: color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground) 72%, var(--vscode-editor-background)); }
    .node .meta { display: flex; align-items: center; gap: 6px; min-width: 0; margin-bottom: var(--meta-gap, 6px); color: var(--vscode-descriptionForeground); font-size: var(--node-meta-size, 12px); }
    .node .title { font-family: var(--reading-font); font-size: var(--node-title-size, 15px); font-weight: 450; line-height: 1.55; letter-spacing: .012em; }
    .state { display: inline-flex; align-items: center; gap: 5px; }
    .state-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
    .state.completed .state-dot { background: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
    .state.running .state-dot { background: var(--activity-accent); }
    .state.failed .state-dot { background: var(--vscode-errorForeground); }
    .state.interrupted .state-dot { background: var(--vscode-notificationsWarningIcon-foreground); }
    .table.ellipsis .node .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .table.wrap .node .title { white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden; }
    .badge { margin-left: auto; color: var(--vscode-notificationsWarningIcon-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge + .badge { margin-left: 0; }
    .badge.approximate { color: var(--vscode-descriptionForeground); }
    .badge.temporary { color: var(--activity-accent); }
    .badge.frozen { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
    .activity-badge { margin-left: auto; color: var(--activity-accent); white-space: nowrap; }
    .collapse { min-height: 22px; height: 22px; min-width: 22px; padding: 0 5px; margin-left: auto; border: none; background: transparent; color: inherit; }
    .row-resizer { position: absolute; left: 0; right: 0; bottom: -4px; z-index: 8; height: 8px; cursor: row-resize; }
    .row-resizer:hover { border-bottom: 2px solid var(--vscode-focusBorder); }
    .busy-dot { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 720px) { .snapshot-dialog { width: calc(100vw - 16px); height: calc(100vh - 16px); } .inspector { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 1fr) auto; gap: 10px; padding: 12px; } .inspector-main { min-height: 0; } .inspector-side { max-height: 150px; padding: 10px 0 0; border-left: 0; border-top: 1px solid var(--structure-border); } .snapshot-meta, .activity-legend, .enter-hint { display: none; } .toolbar .spacer { display: none; } }
    @media (prefers-reduced-motion: reduce) { .busy-dot { animation: none; } }
    .vscode-reduce-motion .busy-dot { animation: none; }
    .vscode-high-contrast .node, .vscode-high-contrast .lane-row, .vscode-high-contrast .lane-header { border-color: var(--vscode-contrastBorder); }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let current = null;
    let dismissedPreviewNodeId = null;
    let resizeFrame = 0;
    const post = (type, fields = {}) => vscode.postMessage({ type, ...fields });
    const app = document.getElementById('app');
    const labels = { waiting: '等待提问', running: '运行中', completed: '已完成', failed: '失败', interrupted: '已中断' };

    window.addEventListener('message', event => {
      if (event.data?.type !== 'state') return;
      const previousNodeId = current?.selectedNodeId || null;
      current = event.data.state;
      if (current.selectedNodeId !== previousNodeId) dismissedPreviewNodeId = null;
      render();
    });
    window.addEventListener('keydown', event => {
      if (!current || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Delete' && event.target instanceof Element && event.target.closest('.node')) {
        event.preventDefault(); post('delete'); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        post(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); post('redo');
      }
    });
    app.addEventListener('click', event => {
      const anchor = event.target instanceof Element ? event.target.closest('.snapshot-answer a') : null;
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute('href');
      if (href) post('openLink', { href });
    });
    new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (current) render(); });
    }).observe(app);

    function button(text, type, options = {}) {
      const element = document.createElement('button');
      element.textContent = text;
      if (options.primary) element.classList.add('primary');
      if (options.className) element.classList.add(options.className);
      element.disabled = Boolean(options.disabled);
      element.title = options.title || text;
      element.addEventListener('click', () => post(type, options.fields || {}));
      return element;
    }

    function requestNodePreview(nodeId) {
      dismissedPreviewNodeId = null;
      post('selectNode', { nodeId });
    }

    function render() {
      if (!current) return;
      const oldTableScroll = app.querySelector('.table-scroll');
      const oldSnapshot = app.querySelector('.snapshot-answer');
      const restore = {
        tableLeft: oldTableScroll?.scrollLeft || 0,
        tableTop: oldTableScroll?.scrollTop || 0,
        snapshotTop: oldSnapshot?.scrollTop || 0,
        selectedNodeId: app.querySelector('.node.selected')?.dataset.nodeId || null,
        focusedNodeId: document.activeElement?.closest?.('.node')?.dataset.nodeId || null,
        focusedSnapshot: document.activeElement === oldSnapshot,
      };
      app.replaceChildren();
      const selected = current.document.nodes.find(node => node.id === current.selectedNodeId);
      const preferences = current.document.preferences;
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      toolbar.append(
        button(current.document.rootThreadId ? '更换根对话' : '选择根对话', 'selectRoot', { primary: true, disabled: current.busy, title: '搜索全部项目中的官方 Codex 根对话；分支不会显示' }),
        button('同步官方分支', 'sync', { disabled: current.busy || !current.document.rootThreadId, title: '读取用官方 Codex 分支按钮创建的任务' }),
        button(preferences.textMode === 'wrap' ? '自动换行' : '省略显示', 'setTextMode', {
          className: 'mode',
          disabled: current.busy,
          fields: { textMode: preferences.textMode === 'wrap' ? 'ellipsis' : 'wrap' },
          title: '切换自动换行和省略显示',
        })
      );
      const zoom = document.createElement('div'); zoom.className = 'zoom-controls'; zoom.setAttribute('aria-label', '节点字号');
      zoom.append(
        button('A−', 'setFontScale', { disabled: current.busy || preferences.fontScale <= .8, fields: { fontScale: preferences.fontScale - .1 }, title: '缩小节点字体' }),
        button(Math.round(preferences.fontScale * 100) + '%', 'setFontScale', { className: 'zoom-value', disabled: current.busy || preferences.fontScale === 1, fields: { fontScale: 1 }, title: '恢复默认字号' }),
        button('A+', 'setFontScale', { disabled: current.busy || preferences.fontScale >= 1.6, fields: { fontScale: preferences.fontScale + .1 }, title: '放大节点字体' })
      );
      toolbar.append(zoom);
      const tableLabel = document.createElement('span'); tableLabel.className = 'control-label'; tableLabel.textContent = '表格';
      const tableZoom = document.createElement('div'); tableZoom.className = 'zoom-controls'; tableZoom.setAttribute('aria-label', '表格密度与缩放');
      tableZoom.append(
        button('−', 'setTableScale', { disabled: current.busy || preferences.tableScale <= .65, fields: { tableScale: preferences.tableScale - .05 }, title: '缩小表格结构' }),
        button(preferences.autoFit ? '自适应' : Math.round(preferences.tableScale * 100) + '%', 'setAutoFit', {
          className: 'zoom-value',
          disabled: current.busy,
          fields: { autoFit: !preferences.autoFit },
          title: preferences.autoFit ? '关闭自适应并使用当前比例' : '按可用宽度自适应',
        }),
        button('+', 'setTableScale', { disabled: current.busy || preferences.tableScale >= 1.35, fields: { tableScale: preferences.tableScale + .05 }, title: '放大表格结构' })
      );
      toolbar.append(tableLabel, tableZoom, button('紧凑重置', 'resetCompactLayout', { disabled: current.busy, title: '恢复紧凑自适应，并清除手动行高与列宽' }));
      const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.append(spacer);
      if (current.busy) { const dot = document.createElement('span'); dot.className = 'busy-dot'; dot.setAttribute('aria-label', '正在处理'); toolbar.append(dot); }
      toolbar.append(
        button('↶', 'undo', { disabled: current.busy || !current.canUndo, title: '撤销' }),
        button('↷', 'redo', { disabled: current.busy || !current.canRedo, title: '重做' }),
        button('删除', 'delete', { disabled: current.busy || !selected, title: '删除选中节点及全部后代（Delete）' })
      );
      app.append(toolbar);

      const status = document.createElement('div');
      const compatibility = current.compatibility;
      const temporaryCount = current.document.temporaryForks.length;
      const baseMessage = compatibility.ok
        ? '官方 Codex ' + compatibility.extensionVersion + ' · App Server ' + compatibility.appServerVersion + (temporaryCount ? ' · 临时定位 ' + temporaryCount : '')
        : '正在检查官方 Codex 兼容性…';
      const message = current.transientMessage || compatibility.message || baseMessage;
      status.className = 'status ' + (compatibility.checked && !compatibility.ok ? 'error' : compatibility.ok ? 'ok' : '');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = message;
      app.append(status);

      if (current.layout.laneCount === 0) {
        const empty = document.createElement('div'); empty.className = 'empty';
        empty.textContent = current.document.rootThreadId
          ? '正在读取官方任务。你也可以点击“同步官方分支”。'
          : '先在最右侧官方 Codex 中开始对话，再点击“选择根对话”。分支请继续用官方 Codex 的分支按钮创建。';
        app.append(empty); return;
      }
      const logicalWidths = current.layout.laneKeys.map(key => preferences.columnWidths[key] || preferences.defaultColumnWidth);
      const frozenByNode = frozenNodeRoots(current.document.nodes, current.document.frozenRootNodeIds || []);
      const frozenLaneFlags = current.layout.laneKeys.map(key => frozenByNode.has(key));
      const metrics = tableMetrics(logicalWidths, Math.max(1, app.clientWidth), preferences, frozenLaneFlags);
      const widths = metrics.widths;
      const forksByNode = new Map();
      current.document.temporaryForks.forEach(fork => {
        const values = forksByNode.get(fork.nodeId) || [];
        values.push(fork); forksByNode.set(fork.nodeId, values);
      });
      const childCountByNode = new Map();
      current.document.nodes.forEach(node => {
        if (node.parentNodeId) childCountByNode.set(node.parentNodeId, (childCountByNode.get(node.parentNodeId) || 0) + 1);
      });
      const columns = widths.map(width => width + 'px').join(' ');
      const tableScroll = document.createElement('div'); tableScroll.className = 'table-scroll'; tableScroll.setAttribute('tabindex', '0'); tableScroll.setAttribute('aria-label', '学习分支表格，可独立滚动');
      const table = document.createElement('div'); table.className = 'table ' + preferences.textMode; table.setAttribute('role', 'grid');
      table.style.setProperty('--node-font-scale', String(preferences.fontScale));
      table.style.setProperty('--node-title-size', (15 * preferences.fontScale).toFixed(1) + 'px');
      table.style.setProperty('--node-meta-size', (12 * preferences.fontScale).toFixed(1) + 'px');
      table.style.setProperty('--cell-pad-x', Math.max(8, Math.round(13 * metrics.effectiveScale)) + 'px');
      table.style.setProperty('--cell-pad-y', Math.max(6, Math.round(10 * metrics.effectiveScale)) + 'px');
      table.style.setProperty('--meta-gap', Math.max(4, Math.round(7 * metrics.effectiveScale)) + 'px');
      const header = document.createElement('div'); header.className = 'header'; header.style.gridTemplateColumns = columns; header.setAttribute('role', 'row');
      header.style.height = Math.max(38, Math.round(46 * metrics.effectiveScale)) + 'px';
      current.layout.laneKeys.forEach((key, lane) => {
        const isFrozenLane = frozenLaneFlags[lane];
        const aggregate = laneActivity(lane);
        const heat = activityHeat(aggregate);
        const cell = document.createElement('div'); cell.className = 'lane-header heat-' + heat + (isFrozenLane ? ' frozen' : ''); cell.style.gridColumn = String(lane + 1); cell.setAttribute('role', 'columnheader');
        const symbol = document.createElement('span'); symbol.className = 'lane-symbol'; symbol.textContent = '⌘';
        const title = document.createElement('span'); title.textContent = isFrozenLane ? '冻结' : '泳道 ' + (lane + 1); title.title = isFrozenLane ? '冻结归档泳道' : '';
        cell.append(symbol, title);
        if (!isFrozenLane && aggregate.visitCount > 0) {
          const activity = document.createElement('span'); activity.className = 'lane-activity'; activity.textContent = aggregate.visitCount + ' 次访问'; activity.title = aggregate.lastVisitedAt ? '最近：' + formatRelativeTime(aggregate.lastVisitedAt) : '';
          cell.append(activity);
        }
        if (!isFrozenLane) {
          const handle = document.createElement('div'); handle.className = 'column-resizer'; handle.setAttribute('aria-label', '调整泳道宽度');
          makeResizeHandle(handle, 'x', logicalWidths[lane], metrics.effectiveScale, value => post('resizeColumn', { laneKey: key, width: value }));
          cell.append(handle);
        }
        header.append(cell);
      });
      table.append(header);

      let rovingAssigned = false;
      current.layout.rows.forEach((placements, depth) => {
        const explicitHeight = preferences.rowHeights[String(depth)];
        const logicalHeight = explicitHeight || preferences.defaultRowHeight;
        const height = Math.max(54, Math.round(logicalHeight * metrics.effectiveScale));
        const row = document.createElement('div'); row.className = 'lane-row'; row.style.gridTemplateColumns = columns; row.setAttribute('role', 'row');
        if (explicitHeight) row.style.height = height + 'px'; else row.style.minHeight = height + 'px';
        for (let lane = 0; lane < current.layout.laneCount; lane += 1) {
          const slot = document.createElement('div'); slot.className = 'lane-slot' + (frozenLaneFlags[lane] ? ' frozen' : ''); slot.style.gridColumn = String(lane + 1); slot.setAttribute('aria-hidden', 'true'); row.append(slot);
        }
        placements.forEach(placement => {
          if (!placement) return;
          const node = placement.node;
          const activity = current.document.nodeActivity[node.id] || { visitCount: 0, lastVisitedAt: null };
          const heat = activityHeat(activity);
          const temporaryForks = forksByNode.get(node.id) || [];
          const activeTemporaryForks = temporaryForks.filter(fork => fork.state !== 'archived');
          const isFrozen = frozenByNode.has(node.id);
          const cell = document.createElement('div');
          cell.className = 'node heat-' + heat + (isFrozen ? ' frozen' : '') + (node.id === current.selectedNodeId ? ' selected' : '');
          cell.style.gridColumn = (placement.lane + 1) + ' / span ' + placement.columnSpan;
          cell.dataset.nodeId = node.id;
          const isTabStop = node.id === current.selectedNodeId || (!current.selectedNodeId && !rovingAssigned);
          cell.tabIndex = isTabStop ? 0 : -1;
          if (isTabStop) rovingAssigned = true;
          cell.setAttribute('role', 'gridcell');
          cell.setAttribute('aria-selected', String(node.id === current.selectedNodeId));
          cell.setAttribute('aria-label', node.title + '。单击查看快照。');
          const meta = document.createElement('div'); meta.className = 'meta';
          const state = document.createElement('span'); state.className = 'state ' + node.runtimeState;
          const stateDot = document.createElement('span'); stateDot.className = 'state-dot';
          const stateText = document.createElement('span'); stateText.textContent = labels[node.runtimeState] || node.runtimeState;
          state.append(stateDot, stateText); meta.append(state);
          if (isFrozen) { const badge = document.createElement('span'); badge.className = 'badge frozen'; badge.textContent = frozenByNode.get(node.id) === node.id ? '已冻结' : '随分支冻结'; badge.title = '此节点属于冻结归档分支'; meta.append(badge); }
          if (!node.navigationExact && temporaryForks.length === 0) { const badge = document.createElement('span'); badge.className = 'badge approximate'; badge.textContent = '需精确定位'; badge.title = '只有在快照中确认进入后，才会创建临时 Codex 分支'; meta.append(badge); }
          if (temporaryForks.length > 0) {
            const temporary = temporaryForks[0];
            const badge = document.createElement('span'); badge.className = 'badge temporary';
            badge.textContent = temporary.state === 'archived' ? '旧临时定位' : temporary.state === 'cleanupPending' ? '5 分钟后清理' : '临时定位';
            badge.title = '发送新问题后转为正式分支；未提问并离开 5 分钟后永久删除';
            meta.append(badge);
          }
          const otherWaitingBranches = Math.max(0, node.waitingBranchCount - activeTemporaryForks.length);
          if (otherWaitingBranches > 0) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = otherWaitingBranches + ' 个空分支'; badge.title = '官方 Codex 中尚未提出新问题的手动分支'; meta.append(badge); }
          if (activity.visitCount > 0) { const badge = document.createElement('span'); badge.className = 'activity-badge'; badge.textContent = activity.visitCount + ' 次'; badge.title = '最近进入：' + formatRelativeTime(activity.lastVisitedAt); meta.append(badge); }
          if ((childCountByNode.get(node.id) || 0) > 0) {
            const collapse = document.createElement('button'); collapse.className = 'collapse'; collapse.textContent = node.collapsed ? '▸' : '▾'; collapse.title = node.collapsed ? '展开子树' : '折叠子树'; collapse.setAttribute('aria-label', collapse.title); collapse.setAttribute('aria-expanded', String(!node.collapsed));
            collapse.addEventListener('click', event => { event.stopPropagation(); post('toggleCollapse', { nodeId: node.id }); }); meta.append(collapse);
          }
          const title = document.createElement('div'); title.className = 'title'; title.textContent = node.title;
          cell.append(meta, title);
          cell.addEventListener('click', () => requestNodePreview(node.id));
          cell.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); requestNodePreview(node.id); return;
            }
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); moveGridFocus(cell, event.key);
            }
          });
          row.append(cell);
        });
        const handle = document.createElement('div'); handle.className = 'row-resizer'; handle.setAttribute('aria-label', '调整这一行高度');
        makeResizeHandle(handle, 'y', logicalHeight, metrics.effectiveScale, value => post('resizeRow', { depth, height: value }));
        row.append(handle); table.append(row);
      });
      tableScroll.append(table); app.append(tableScroll);
      let previewDialog = null;
      if (
        selected &&
        current.selectedNodePreview &&
        dismissedPreviewNodeId !== selected.id
      ) {
        previewDialog = renderInspector(selected, current.selectedNodePreview);
        app.append(previewDialog);
        previewDialog.showModal();
      }
      requestAnimationFrame(() => {
        tableScroll.scrollLeft = restore.tableLeft;
        tableScroll.scrollTop = restore.tableTop;
        const snapshot = app.querySelector('.snapshot-answer');
        if (snapshot && restore.selectedNodeId === current.selectedNodeId) snapshot.scrollTop = restore.snapshotTop;
        if (snapshot && restore.focusedSnapshot) snapshot.focus({ preventScroll: true });
        const focusId = restore.focusedNodeId;
        if (!previewDialog?.open && focusId) app.querySelector('.node[data-node-id="' + CSS.escape(focusId) + '"]')?.focus({ preventScroll: true });
      });
    }

    function renderInspector(node, preview) {
      const dialog = document.createElement('dialog'); dialog.className = 'snapshot-dialog'; dialog.setAttribute('aria-labelledby', 'snapshot-dialog-title');
      const shell = document.createElement('div'); shell.className = 'snapshot-shell';
      const header = document.createElement('header'); header.className = 'snapshot-dialog-header';
      const dialogTitle = document.createElement('div'); dialogTitle.id = 'snapshot-dialog-title'; dialogTitle.className = 'snapshot-dialog-title'; dialogTitle.textContent = '问题快照';
      const close = document.createElement('button'); close.className = 'snapshot-close'; close.type = 'button'; close.textContent = '×'; close.title = '关闭快照（Esc）'; close.setAttribute('aria-label', '关闭问题快照'); close.autofocus = true;
      close.addEventListener('click', () => dismissPreview(dialog, node.id));
      header.append(dialogTitle, close); shell.append(header);
      const inspector = document.createElement('section'); inspector.className = 'inspector'; inspector.setAttribute('aria-label', '节点快照');
      const main = document.createElement('div'); main.className = 'inspector-main';
      const eyebrow = document.createElement('div'); eyebrow.className = 'eyebrow'; eyebrow.textContent = '问题'; main.append(eyebrow);
      if (preview.path.length > 0) {
        const breadcrumb = document.createElement('div'); breadcrumb.className = 'breadcrumb'; breadcrumb.textContent = preview.path.join('  /  '); breadcrumb.title = preview.path.join(' / '); main.append(breadcrumb);
      }
      const question = document.createElement('div'); question.className = 'snapshot-question'; question.innerHTML = preview.questionHtml; main.append(question);
      if (preview.answerHtml) {
        const answer = document.createElement('div'); answer.className = 'snapshot-answer'; answer.tabIndex = 0; answer.setAttribute('aria-label', '回答快照，可独立滚动'); answer.innerHTML = preview.answerHtml; main.append(answer);
      } else {
        const answerState = document.createElement('div'); answerState.className = 'snapshot-answer-state';
        answerState.textContent = preview.answerState === 'running'
          ? '回答仍在生成，完成后会自动刷新快照。'
          : '这个节点暂时没有可读取的回答内容。';
        main.append(answerState);
      }

      const side = document.createElement('div'); side.className = 'inspector-side';
      const meta = document.createElement('div'); meta.className = 'snapshot-meta';
      appendMeta(meta, '定位', node.navigationExact ? '已有精确任务' : '确认后创建');
      appendMeta(meta, '子节点', String(preview.childCount));
      appendMeta(meta, '后代', String(preview.descendantCount));
      const frozenByNode = frozenNodeRoots(current.document.nodes, current.document.frozenRootNodeIds || []);
      const frozenRootId = frozenByNode.get(node.id) || null;
      appendMeta(meta, '归档', frozenRootId ? (frozenRootId === node.id ? '此处冻结' : '随上级冻结') : '工作中');
      appendMeta(meta, '访问', preview.visitCount ? preview.visitCount + ' 次' : '尚未进入');
      appendMeta(meta, '最近', formatRelativeTime(preview.lastVisitedAt));
      side.append(meta);
      const temporary = current.document.temporaryForks.find(fork => fork.nodeId === node.id);
      const enterText = node.navigationExact || temporary ? '确定进入这个分支' : '创建精确定位并进入';
      const enter = button(enterText, 'openNode', { primary: true, disabled: current.busy, fields: { nodeId: node.id }, title: '在最右侧官方 Codex 中打开' });
      enter.addEventListener('click', () => dismissPreview(dialog, node.id));
      side.append(enter);
      const freezeText = frozenRootId
        ? (frozenRootId === node.id ? '解除冻结分支' : '解除上级冻结')
        : '冻结此节点及子节点';
      const freeze = button(freezeText, 'toggleFreeze', {
        disabled: current.busy,
        fields: { nodeId: node.id },
        title: frozenRootId ? '恢复整条冻结分支为工作泳道' : '将此节点及后代缩窄并灰化',
      });
      freeze.addEventListener('click', () => dismissPreview(dialog, node.id));
      side.append(freeze);
      const hint = document.createElement('div'); hint.className = 'enter-hint';
      hint.textContent = node.navigationExact || temporary
        ? '将在最右侧原生 Codex 中打开；单击节点本身只浏览快照。'
        : '只有确认后才创建持久化定位分支；未提问并离开 5 分钟后永久删除。';
      side.append(hint);
      const archiveHint = document.createElement('div'); archiveHint.className = 'enter-hint';
      archiveHint.textContent = '冻结只整理学习泳道，不会归档、删除或移动官方 Codex 任务。';
      side.append(archiveHint);
      const legend = document.createElement('div'); legend.className = 'activity-legend';
      const soft = document.createElement('span'); soft.className = 'legend-mark soft';
      const softText = document.createElement('span'); softText.textContent = '近期/访问';
      const strong = document.createElement('span'); strong.className = 'legend-mark strong';
      const strongText = document.createElement('span'); strongText.textContent = '高频';
      legend.append(soft, softText, strong, strongText); side.append(legend);
      inspector.append(main, side);
      shell.append(inspector); dialog.append(shell);
      dialog.addEventListener('cancel', event => {
        event.preventDefault(); dismissPreview(dialog, node.id);
      });
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dismissPreview(dialog, node.id);
      });
      return dialog;
    }

    function dismissPreview(dialog, nodeId) {
      dismissedPreviewNodeId = nodeId;
      if (dialog.open) dialog.close();
      requestAnimationFrame(() => {
        app.querySelector('.node[data-node-id="' + CSS.escape(nodeId) + '"]')?.focus({ preventScroll: true });
      });
    }

    function appendMeta(container, label, value) {
      const key = document.createElement('span'); key.textContent = label;
      const content = document.createElement('strong'); content.textContent = value;
      container.append(key, content);
    }

    function laneActivity(lane) {
      const nodeIds = new Set();
      current.layout.rows.forEach(placements => placements.forEach(placement => {
        if (placement && placement.lane === lane && placement.columnSpan === 1) nodeIds.add(placement.node.id);
      }));
      let visitCount = 0; let lastVisitedAt = null;
      nodeIds.forEach(nodeId => {
        const activity = current.document.nodeActivity[nodeId];
        if (!activity) return;
        visitCount += activity.visitCount;
        if (activity.lastVisitedAt && (!lastVisitedAt || activity.lastVisitedAt > lastVisitedAt)) lastVisitedAt = activity.lastVisitedAt;
      });
      return { visitCount, lastVisitedAt };
    }

    function activityHeat(activity) {
      if (!activity || activity.visitCount <= 0) return 0;
      let heat = activity.visitCount >= 7 ? 3 : activity.visitCount >= 3 ? 2 : 1;
      if (activity.lastVisitedAt) {
        const age = Date.now() - Date.parse(activity.lastVisitedAt);
        if (Number.isFinite(age) && age <= 24 * 60 * 60 * 1000) heat = Math.max(heat, 2);
        if (Number.isFinite(age) && age > 30 * 24 * 60 * 60 * 1000 && activity.visitCount < 3) return 0;
      }
      return heat;
    }

    function formatRelativeTime(value) {
      if (!value) return '从未';
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) return '未知';
      const delta = Math.max(0, Date.now() - timestamp);
      if (delta < 60 * 1000) return '刚刚';
      if (delta < 60 * 60 * 1000) return Math.floor(delta / 60000) + ' 分钟前';
      if (delta < 24 * 60 * 60 * 1000) return Math.floor(delta / 3600000) + ' 小时前';
      if (delta < 7 * 24 * 60 * 60 * 1000) return Math.floor(delta / 86400000) + ' 天前';
      return new Date(timestamp).toLocaleDateString('zh-CN');
    }

    function frozenNodeRoots(nodes, frozenRootNodeIds) {
      const nodesById = new Map(nodes.map(node => [node.id, node]));
      const frozenRoots = new Set(frozenRootNodeIds.filter(nodeId => nodesById.has(nodeId)));
      const result = new Map();
      nodes.forEach(node => {
        const visited = new Set();
        let currentNode = node;
        while (currentNode && !visited.has(currentNode.id)) {
          visited.add(currentNode.id);
          if (frozenRoots.has(currentNode.id)) {
            result.set(node.id, currentNode.id);
            break;
          }
          currentNode = currentNode.parentNodeId ? nodesById.get(currentNode.parentNodeId) : null;
        }
      });
      return result;
    }

    function tableMetrics(logicalWidths, viewportWidth, preferences, frozenLaneFlags = []) {
      const readableMin = Math.min(210, Math.max(132, Math.round(132 * preferences.fontScale)));
      const effectiveLogicalWidths = logicalWidths.map((width, index) => frozenLaneFlags[index] ? Math.min(width, 110) : width);
      const total = effectiveLogicalWidths.reduce((sum, width) => sum + width, 0);
      const fit = total > 0 ? Math.max(1, viewportWidth - 2) / total : preferences.tableScale;
      const effectiveScale = preferences.autoFit
        ? Math.min(preferences.tableScale, .85, Math.max(.68, fit))
        : preferences.tableScale;
      const widths = effectiveLogicalWidths.map((width, index) => Math.max(frozenLaneFlags[index] ? 76 : readableMin, Math.round(width * effectiveScale)));
      return { effectiveScale, readableMin, widths };
    }

    function moveGridFocus(source, key) {
      const nodes = [...app.querySelectorAll('.node')];
      if (nodes.length === 0) return;
      if (key === 'Home' || key === 'End') {
        const target = key === 'Home' ? nodes[0] : nodes[nodes.length - 1];
        target?.focus(); return;
      }
      const sourceRect = source.getBoundingClientRect();
      const sourceX = sourceRect.left + sourceRect.width / 2;
      const sourceY = sourceRect.top + sourceRect.height / 2;
      const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
      const forward = key === 'ArrowRight' || key === 'ArrowDown';
      let best = null; let bestScore = Number.POSITIVE_INFINITY;
      nodes.forEach(candidate => {
        if (candidate === source) return;
        const rect = candidate.getBoundingClientRect();
        const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
        const primary = horizontal ? x - sourceX : y - sourceY;
        if ((forward && primary <= 1) || (!forward && primary >= -1)) return;
        const secondary = horizontal ? Math.abs(y - sourceY) : Math.abs(x - sourceX);
        const score = Math.abs(primary) + secondary * 1.8;
        if (score < bestScore) { best = candidate; bestScore = score; }
      });
      best?.focus();
    }

    function makeResizeHandle(element, axis, initial, effectiveScale, commit) {
      const minimum = axis === 'x' ? 132 : 64;
      const maximum = axis === 'x' ? 520 : 360;
      element.tabIndex = 0;
      element.setAttribute('role', 'separator');
      element.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
      element.setAttribute('aria-valuemin', String(minimum));
      element.setAttribute('aria-valuemax', String(maximum));
      element.setAttribute('aria-valuenow', String(Math.round(initial)));
      element.addEventListener('keydown', event => {
        const decrease = axis === 'x' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
        const increase = axis === 'x' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
        if (!decrease && !increase) return;
        event.preventDefault(); event.stopPropagation();
        commit(Math.min(maximum, Math.max(minimum, initial + (increase ? 10 : -10))));
      });
      element.addEventListener('pointerdown', event => {
        event.preventDefault(); event.stopPropagation();
        const start = axis === 'x' ? event.clientX : event.clientY;
        element.setPointerCapture(event.pointerId);
        const move = moveEvent => {
          const currentPoint = axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
          const logical = Math.min(maximum, Math.max(minimum, initial + (currentPoint - start) / effectiveScale));
          const rendered = Math.round(logical * effectiveScale);
          if (axis === 'x') {
            const header = element.closest('.header');
            const lane = [...header.children].indexOf(element.parentElement);
            app.querySelectorAll('.header, .lane-row').forEach(grid => {
              const tracks = grid.style.gridTemplateColumns.split(' ');
              tracks[lane] = Math.max(132, rendered) + 'px';
              grid.style.gridTemplateColumns = tracks.join(' ');
            });
          } else {
            element.parentElement.style.height = Math.max(54, rendered) + 'px';
          }
        };
        const up = upEvent => {
          const end = axis === 'x' ? upEvent.clientX : upEvent.clientY;
          element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up);
          commit(Math.min(maximum, Math.max(minimum, initial + (end - start) / effectiveScale)));
        };
        element.addEventListener('pointermove', move); element.addEventListener('pointerup', up);
      });
    }
    post('ready');
  </script>
</body>
</html>`;
}
