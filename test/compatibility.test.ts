import { describe, expect, it } from "vitest";
import {
  bundledCodexRelativePath,
  inspectCodexEntrypoint,
  inspectCodexPackage,
} from "../src/compatibility.js";

describe("Codex extension compatibility", () => {
  it("detects the official right-side Codex view", () => {
    expect(
      inspectCodexPackage({
        contributes: {
          commands: [{ command: "chatgpt.openSidebar" }],
          views: { secondarySideBar: [{ id: "chatgpt.sidebarSecondaryView" }] },
        },
      }),
    ).toEqual({ ok: true, sidebarViewId: "chatgpt.sidebarSecondaryView", reason: null });
  });

  it("provides local and Remote SSH binary paths", () => {
    expect(bundledCodexRelativePath("win32", "x64")).toContain("windows-x86_64");
    expect(bundledCodexRelativePath("linux", "arm64")).toContain("linux-aarch64");
  });

  it("detects the internal sidebar URI navigation hook", () => {
    expect(inspectCodexEntrypoint("registerUriHandler navigateToRoute")).toBeNull();
    expect(inspectCodexEntrypoint("registerUriHandler")).toMatch(/侧边栏任务导航/u);
  });
});
