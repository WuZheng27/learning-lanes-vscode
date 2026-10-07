import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ panel: null as any, emit: null as any, receive: null as any }));
vi.mock("vscode", () => ({ window: { createWebviewPanel: () => ui.panel }, ViewColumn: { Active: 1 } }));
import { NavigatorPanel } from "../src/webview.js";
import { defaultDocument } from "../src/model.js";
import { buildLaneLayout } from "../src/layout.js";
import type { NavigatorController } from "../src/controller.js";
import type { NavigatorViewState } from "../src/types.js";

let panel: NavigatorPanel;
let current: NavigatorViewState;
beforeEach(() => {
  current = {
    tableVersion: 1, document: defaultDocument("test"), layout: buildLaneLayout([]),
    selectedNodeId: null, selectedNodePreview: null, canUndo: false, canRedo: false, busy: false,
    compatibility: { checked: true, ok: true, extensionVersion: "test", appServerVersion: "test", message: null },
    transientMessage: null,
  };
  const disposable = () => ({ dispose() {} });
  ui.panel = {
    visible: true, reveal: vi.fn(), onDidDispose: disposable, onDidChangeViewState: disposable,
    webview: { html: "", cspSource: "test", postMessage: vi.fn(async () => true),
      onDidReceiveMessage: (receive: unknown) => { ui.receive = receive; return disposable(); } },
  };
  const controller = {
    getState: () => current, setNavigatorVisible: vi.fn(),
    onDidChangeState: (emit: unknown) => { ui.emit = emit; return disposable(); },
  };
  panel = NavigatorPanel.createOrShow(controller as unknown as NavigatorController);
});
afterEach(() => panel.dispose());

describe("panel state delivery", () => {
  it("sends only state updates until the table changes", () => {
    expect(ui.panel.webview.postMessage.mock.lastCall[0].type).toBe("state");
    ui.emit({ ...current, busy: true });
    expect(ui.panel.webview.postMessage.mock.lastCall[0].type).toBe("stateUpdate");
    ui.emit({ ...current, tableVersion: 2 });
    expect(ui.panel.webview.postMessage.mock.lastCall[0].type).toBe("state");
  });

  it("sends a full state when the Webview requests initialization or recovery", async () => {
    ui.emit(current);
    expect(ui.panel.webview.postMessage.mock.lastCall[0].type).toBe("stateUpdate");
    await ui.receive({ type: "ready" });
    expect(ui.panel.webview.postMessage.mock.lastCall[0]).toEqual({ type: "state", state: current });
  });

  it("retries with a full state after a failed delivery", async () => {
    ui.panel.webview.postMessage.mockResolvedValueOnce(false);
    ui.emit({ ...current, busy: true });
    await Promise.resolve();
    ui.emit(current);
    expect(ui.panel.webview.postMessage.mock.lastCall[0].type).toBe("state");
  });
});
