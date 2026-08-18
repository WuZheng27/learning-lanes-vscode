import * as path from "node:path";

export interface InspectedCodexPackage {
  readonly ok: boolean;
  readonly sidebarViewId: string | null;
  readonly reason: string | null;
}

export function inspectCodexPackage(packageJson: unknown): InspectedCodexPackage {
  if (!packageJson || typeof packageJson !== "object") {
    return { ok: false, sidebarViewId: null, reason: "官方 Codex 扩展的 package.json 无法读取。" };
  }
  const pkg = packageJson as Record<string, unknown>;
  const contributes = pkg.contributes;
  if (!contributes || typeof contributes !== "object") {
    return { ok: false, sidebarViewId: null, reason: "官方 Codex 扩展未声明 contributes。" };
  }
  const commands = (contributes as Record<string, unknown>).commands;
  const hasOpenSidebarCommand =
    Array.isArray(commands) &&
    commands.some(
      (command) =>
        command !== null &&
        typeof command === "object" &&
        (command as Record<string, unknown>).command === "chatgpt.openSidebar",
    );
  if (!hasOpenSidebarCommand) {
    return {
      ok: false,
      sidebarViewId: null,
      reason: "当前官方 Codex 扩展不再提供最右侧 Codex 面板入口。",
    };
  }
  const views = (contributes as Record<string, unknown>).views;
  const viewCandidates =
    views && typeof views === "object"
      ? Object.values(views as Record<string, unknown>).flatMap((value) =>
          Array.isArray(value) ? value : [],
        )
      : [];
  const sidebar = viewCandidates.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      ["chatgpt.sidebarView", "chatgpt.sidebarSecondaryView"].includes(
        String((candidate as Record<string, unknown>).id ?? ""),
      ),
  ) as Record<string, unknown> | undefined;
  if (!sidebar) {
    return {
      ok: false,
      sidebarViewId: null,
      reason: "当前官方 Codex 扩展未声明侧边栏对话视图。",
    };
  }
  return { ok: true, sidebarViewId: String(sidebar.id), reason: null };
}

export function inspectCodexEntrypoint(source: string): string | null {
  if (!source.includes("registerUriHandler")) return "缺少 VS Code URI 处理器。";
  if (!source.includes("navigateToRoute")) return "缺少侧边栏任务导航入口。";
  return null;
}

export function bundledCodexRelativePath(
  platform: NodeJS.Platform,
  architecture: string,
): string | null {
  const arch = architecture === "arm64" ? "aarch64" : architecture === "x64" ? "x86_64" : null;
  if (!arch) return null;
  if (platform === "win32") return path.join("bin", `windows-${arch}`, "codex.exe");
  if (platform === "linux") return path.join("bin", `linux-${arch}`, "codex");
  return null;
}
