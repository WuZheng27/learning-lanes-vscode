import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("vscode", () => ({}));
vi.mock("../src/appServerClient.js", () => ({ AppServerClient: class {
  start = vi.fn(async () => {}); request = rpc; dispose = vi.fn();
} }));
import { CodexBridge } from "../src/codexBridge.js";
function bridge() {
  const client = new CodexBridge("test");
  vi.spyOn(client, "checkCompatibility").mockResolvedValue({ extensionVersion: "test", appServerVersion: "test", executable: "mock", sidebarViewId: "mock" });
  return client;
}
beforeEach(() => { rpc.mockReset(); });

describe("verified parent discovery", () => {
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
