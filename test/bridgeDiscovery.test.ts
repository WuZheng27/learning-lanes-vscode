import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
const shutdown = vi.hoisted(() => vi.fn(async () => {}));
const start = vi.hoisted(() => vi.fn(async () => {}));
const ui = vi.hoisted(() => ({ execute: vi.fn(async () => {}), open: vi.fn(async () => true) }));
vi.mock("vscode", () => ({ commands: { executeCommand: ui.execute }, env: { openExternal: ui.open }, Uri: { parse: (uri: string) => uri } }));
vi.mock("../src/appServerClient.js", () => ({ AppServerClient: class {
  start = start; request = rpc; shutdown = shutdown; dispose = vi.fn();
} }));
import { CodexBridge } from "../src/codexBridge.js";
function bridge() {
  const client = new CodexBridge("test");
  vi.spyOn(client, "checkCompatibility").mockResolvedValue({ extensionVersion: "test", appServerVersion: "test", executable: "mock", sidebarViewId: "mock" });
  return client;
}
beforeEach(() => { rpc.mockReset(); start.mockReset().mockResolvedValue(undefined); shutdown.mockReset().mockResolvedValue(undefined); ui.execute.mockClear(); ui.open.mockClear(); });

describe("verified parent discovery", () => {
  it("preserves a startup failure while cleanup blocks a replacement process", async () => {
    start.mockRejectedValueOnce(new Error("initialize failed"));
    let finish: () => void = () => {};
    shutdown.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    rpc.mockImplementation(async (_method, params) => ({ thread: { id: params.threadId, turns: [] } }));
    const client = bridge();
    await expect(client.readThread("root")).rejects.toThrow("initialize failed");
    expect(shutdown).toHaveBeenCalledTimes(1);
    const retry = client.readThread("root");
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    finish();
    await retry;
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("waits for fork handoff before new reads or official sidebar navigation", async () => {
    rpc.mockImplementation(async (method, params) => method === "thread/fork"
      ? { thread: { id: "forked" } }
      : method === "thread/read" ? { thread: { id: params.threadId, turns: [] } } : {});
    let finish: () => void = () => {};
    shutdown.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const client = bridge();
    const fork = client.forkThread("root", "turn-1");
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalled());
    const read = client.readThread("root");
    const open = client.openSidebarThread("forked");
    await Promise.resolve();
    expect(rpc.mock.calls.some(call => call[0] === "thread/read")).toBe(false);
    expect(ui.execute).not.toHaveBeenCalled();
    finish();
    expect(await fork).toEqual({ threadId: "forked" });
    await Promise.all([read, open]);
    expect(ui.execute).toHaveBeenCalled();
  });

  it("retries failed process release before starting a replacement client", async () => {
    rpc.mockImplementation(async (method, params) => method === "thread/fork"
      ? { thread: { id: "forked" } }
      : method === "thread/read" ? { thread: { id: params.threadId, turns: [] } } : {});
    shutdown.mockRejectedValueOnce(new Error("process still alive"));
    const client = bridge();
    await expect(client.forkThread("root", "turn-1")).rejects.toThrow("process still alive");
    await client.readThread("root");
    expect(shutdown).toHaveBeenCalledTimes(2);
  });

  it("does not spawn a replacement for requests still waiting when the bridge is disposed", async () => {
    rpc.mockImplementation(async (method) => method === "thread/fork" ? { thread: { id: "forked" } } : {});
    let finish: () => void = () => {};
    shutdown.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const client = bridge();
    const fork = client.forkThread("root", "turn-1");
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalled());
    const read = client.readThread("root");
    const rejected = expect(read).rejects.toThrow(/disposed/u);
    client.dispose();
    finish();
    await Promise.all([fork, rejected]);
    expect(rpc.mock.calls.some(call => call[0] === "thread/read")).toBe(false);
  });
  it("verifies list nulls before publishing roots and streams verified choices", async () => {
    rpc.mockImplementation(async (method, params) => {
      if (method === "thread/read") return { thread: { id: params.threadId, forkedFromId: null } };
      return params.cursor
        ? { data: [{ id: "second", forkedFromId: null }] }
        : { data: [{ id: "first", forkedFromId: null }, { id: "branch", forkedFromId: "first" }], nextCursor: "next" };
    });
    const client = bridge(); const update = vi.fn();
    expect((await client.listAllRootThreads(update)).map(thread => thread.id)).toEqual(["first", "second"]);
    expect(update.mock.calls[0]![0].map((thread: { id: string }) => thread.id)).toEqual(["first"]);
    expect(update.mock.lastCall![0].map((thread: { id: string }) => thread.id)).toEqual(["first", "second"]);
    expect(client.cachedRootThreads).toHaveLength(2);
    expect(rpc.mock.calls.filter(call => call[0] === "thread/read")).toHaveLength(2);
    expect(rpc.mock.calls.filter(call => call[0] === "thread/list").map(call => call[1].limit)).toEqual([25, 200]);
  });

  it("reads beyond 100 pages instead of silently losing older roots", async () => {
    rpc.mockImplementation(async (method, params) => {
      if (method === "thread/read") return { thread: { id: params.threadId, forkedFromId: null } };
      const page = Number(params.cursor ?? 0);
      return { data: [{ id: `root-${page}`, forkedFromId: null }], nextCursor: page < 100 ? String(page + 1) : null };
    });
    const roots = await bridge().listAllRootThreads();
    expect(roots).toHaveLength(101);
    expect(roots.at(-1)?.id).toBe("root-100");
  });

  it("continues past an empty page that has a next cursor", async () => {
    rpc.mockImplementation(async (method, params) => {
      if (method === "thread/read") return { thread: { id: params.threadId, forkedFromId: null } };
      return params.cursor ? { data: [{ id: "older-root", forkedFromId: null }] } : { data: [], nextCursor: "older" };
    });
    expect((await bridge().listAllRootThreads()).map(thread => thread.id)).toEqual(["older-root"]);
  });

  it("reports repeated cursors instead of returning a partial branch set", async () => {
    rpc.mockResolvedValue({ data: [{ id: "partial" }], nextCursor: "repeated" });
    await expect(bridge().listRelatedThreads("root", "/workspace")).rejects.toThrow("未完成扫描");
    expect(rpc.mock.calls.filter(call => call[0] === "thread/list")).toHaveLength(2);
  });

  it("reports the scan limit instead of treating truncated results as complete", async () => {
    let page = 0;
    rpc.mockImplementation(async () => ({ data: [], nextCursor: String(++page) }));
    await expect(bridge().listWorkspaceThreads("/workspace")).rejects.toThrow("页数上限");
  });

  it("keeps cached choices while later pages load and removes absent roots on completion", async () => {
    rpc.mockImplementation(async (method, params) => method === "thread/read"
      ? { thread: { id: params.threadId, forkedFromId: null } }
      : { data: [{ id: "first", forkedFromId: null }, { id: "second", forkedFromId: null }] });
    const client = bridge();
    await client.listAllRootThreads();
    let finishPage: (value: unknown) => void = () => {};
    rpc.mockImplementation(async (_method, params) => params.cursor
      ? new Promise(resolve => { finishPage = resolve; })
      : { data: [{ id: "first", forkedFromId: null }], nextCursor: "later" });
    const update = vi.fn();
    const pending = client.listAllRootThreads(update);
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![0].map((thread: { id: string }) => thread.id)).toEqual(["first", "second"]);
    finishPage({ data: [] });
    expect((await pending).map(thread => thread.id)).toEqual(["first"]);
    expect(client.cachedRootThreads.map(thread => thread.id)).toEqual(["first"]);
  });

  it("recovers branches when every list parent is null, caches verification, and filters unrelated roots", async () => {
    rpc.mockImplementation(async (method, params) => method === "thread/list"
      ? { data: ["root", "branch", "grandchild", "other"].map(id => ({ id, forkedFromId: null })) }
      : { thread: { id: params.threadId, forkedFromId: ({ branch: "root", grandchild: "branch" } as Record<string, string>)[params.threadId] ?? null } });
    const client = bridge();
    const roots = await client.listAllRootThreads();
    expect(roots.map(thread => thread.id)).toEqual(["root", "other"]);
    expect((await client.listRelatedThreads("root", "/workspace")).map(thread => thread.id)).toEqual(["root", "branch", "grandchild"]);
    const reads = rpc.mock.calls.filter(call => call[0] === "thread/read");
    expect(reads).toHaveLength(4);
    expect(reads.every(call => call[1].includeTurns === false)).toBe(true);
    expect(await client.resolveRootThread("grandchild")).toBe("root");
    expect(rpc.mock.calls.filter(call => call[0] === "thread/read")).toHaveLength(4);
  });

  it("keeps fallback candidates when a summary fails and does not advertise them as roots", async () => {
    rpc.mockImplementation(async (method, params) => {
      if (method === "thread/list") return { data: [{ id: "root", forkedFromId: null }, { id: "unknown", forkedFromId: null }] };
      if (params.threadId === "root") return { thread: { id: "root", forkedFromId: null } };
      throw new Error("unavailable summary");
    });
    const client = bridge();
    expect((await client.listAllRootThreads()).map(thread => thread.id)).toEqual(["root"]);
    expect(await client.listRelatedThreads("root", "/workspace")).toHaveLength(2);
  });

  it("stops pagination when a root picker is closed", async () => {
    rpc.mockImplementation(async (method) => method === "thread/list"
      ? { data: [{ id: "root", forkedFromId: null }], nextCursor: "next" }
      : { thread: { id: "root", forkedFromId: null } });
    const abort = new AbortController();
    await expect(bridge().listAllRootThreads(() => abort.abort(), abort.signal)).rejects.toThrow();
    expect(rpc.mock.calls.filter(call => call[0] === "thread/list")).toHaveLength(1);
  });

  it("resolves an already selected descendant through ancestors outside the active list", async () => {
    rpc.mockImplementation(async (method, params) => {
      expect(method).toBe("thread/read");
      return { thread: { id: params.threadId, forkedFromId: ({ child: "archived-parent", "archived-parent": "root" } as Record<string, string>)[params.threadId] ?? null } };
    });
    expect(await bridge().resolveRootThread("child")).toBe("root");
    expect(rpc.mock.calls.map(call => call[1].threadId)).toEqual(["child", "archived-parent", "root"]);
  });

  it("includes an active descendant whose intermediate parent is absent from the list", async () => {
    const parents: Record<string, string | null> = { root: null, child: "unlisted-parent", "unlisted-parent": "root", other: null };
    rpc.mockImplementation(async (method, params) => method === "thread/list"
      ? { data: ["root", "child", "other"].map(id => ({ id, forkedFromId: null })) }
      : { thread: { id: params.threadId, forkedFromId: parents[params.threadId] } });
    const client = bridge();
    expect((await client.listRelatedThreads("root", "/workspace")).map(thread => thread.id)).toEqual(["root", "child"]);
    expect(rpc.mock.calls.filter(call => call[0] === "thread/read" && call[1].threadId === "unlisted-parent")).toHaveLength(1);
  });

  it("retains candidates when an omitted ancestor cannot be read", async () => {
    rpc.mockImplementation(async (method, params) => {
      if (method === "thread/list") return { data: [{ id: "root", forkedFromId: "missing-parent" }, { id: "child", forkedFromId: "root" }] };
      throw new Error("ancestor unavailable");
    });
    expect(await bridge().listRelatedThreads("root", "/workspace")).toHaveLength(2);
  });

  it("reports parent cycles without hanging or guessing a root", async () => {
    rpc.mockImplementation(async (_method, params) => ({ thread: { id: params.threadId, forkedFromId: params.threadId === "a" ? "b" : "a" } }));
    await expect(bridge().resolveRootThread("a")).rejects.toThrow("循环");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
