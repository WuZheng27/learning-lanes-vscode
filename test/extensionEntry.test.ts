import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const extensionSource = readFileSync(join(process.cwd(), "src", "extension.ts"), "utf8");
const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{ command?: string; icon?: string }>;
    menus?: Record<string, Array<{ command?: string }>>;
  };
};

describe("one-click navigator entry", () => {
  it("shows a persistent status bar button without eagerly starting App Server", () => {
    expect(extensionSource).toContain("createStatusBarItem");
    expect(extensionSource).toContain('statusBarItem.command = "learningNavigator.open"');
    expect(extensionSource).toContain('statusBarItem.text = "$(type-hierarchy) 学习泳道"');
    expect(extensionSource).toContain("controllerPromise ??= createController(context)");
  });

  it("contributes clickable editor and Explorer title actions", () => {
    expect(manifest.activationEvents).toContain("onStartupFinished");
    expect(manifest.contributes?.commands).toContainEqual(
      expect.objectContaining({
        command: "learningNavigator.open",
        icon: "$(type-hierarchy)",
      }),
    );
    expect(manifest.contributes?.menus?.["editor/title"]).toContainEqual(
      expect.objectContaining({ command: "learningNavigator.open" }),
    );
    expect(manifest.contributes?.menus?.["explorer/title"]).toContainEqual(
      expect.objectContaining({ command: "learningNavigator.open" }),
    );
  });
});
