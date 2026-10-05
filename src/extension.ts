import * as vscode from "vscode";
import { CodexBridge } from "./codexBridge.js";
import { NavigatorController } from "./controller.js";
import { LearningStore } from "./store.js";
import { NavigatorPanel } from "./webview.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  statusBarItem.name = "Codex Learning Navigator";
  statusBarItem.text = "$(type-hierarchy) 学习泳道";
  statusBarItem.tooltip = "点击打开 Codex 学习泳道";
  statusBarItem.command = "learningNavigator.open";
  statusBarItem.show();

  let controllerPromise: Promise<NavigatorController> | null = null;
  const controller = (): Promise<NavigatorController> => {
    controllerPromise ??= createController(context);
    return controllerPromise;
  };
  const open = async (): Promise<NavigatorController> => {
    const value = await controller();
    NavigatorPanel.createOrShow(value);
    return value;
  };

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand("learningNavigator.open", async () => {
      await open();
    }),
    vscode.commands.registerCommand("learningNavigator.selectRoot", async () => {
      await (await open()).selectRoot();
    }),
    vscode.commands.registerCommand("learningNavigator.sync", async () => {
      await (await open()).sync();
    }),
    vscode.commands.registerCommand("learningNavigator.deleteSubtree", async () => {
      await (await open()).deleteSelected();
    }),
    vscode.commands.registerCommand("learningNavigator.undo", async () => {
      await (await open()).undo();
    }),
    vscode.commands.registerCommand("learningNavigator.redo", async () => {
      await (await open()).redo();
    }),
    {
      dispose: () => {
        void controllerPromise?.then((value) => value.dispose());
      },
    },
  );
}

async function createController(context: vscode.ExtensionContext): Promise<NavigatorController> {
  const workspaceFolder = workspaceFolderForCurrentWindow();
  if (!workspaceFolder) {
    throw new Error("Learning Navigator 需要先打开一个 VS Code 工作区文件夹。");
  }
  const bridge = new CodexBridge(String(context.extension.packageJSON.version ?? "0.8.1"));
  const store = new LearningStore(context, workspaceFolder.uri.toString());
  return NavigatorController.create(bridge, store, workspaceFolder);
}

function workspaceFolderForCurrentWindow(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder) return activeFolder;
  }
  return vscode.workspace.workspaceFolders?.[0];
}

export function deactivate(): void {}
