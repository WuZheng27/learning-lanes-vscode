import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient } from "../src/appServerClient.js";

const clients: AppServerClient[] = [];
afterEach(() => {
  while (clients.length > 0) clients.pop()?.dispose();
});

describe("AppServerClient", () => {
  it("waits for initialization before sending concurrent discovery requests", async () => {
    const client = new AppServerClient(process.execPath, "test", [join(process.cwd(), "test", "fixtures", "mock-app-server.cjs")]);
    clients.push(client);
    const results = await Promise.all(Array.from({ length: 12 }, () => client.request<{ data: unknown[] }>("thread/list", {})));
    expect(results.every(result => result.data.length === 1)).toBe(true);
  });

  it("initializes experimental reads and lists without creating tasks", async () => {
    const fixture = join(process.cwd(), "test", "fixtures", "mock-app-server.cjs");
    const client = new AppServerClient(process.execPath, "test", [fixture]);
    clients.push(client);
    const listed = await client.request<{ data: Array<{ id: string }> }>("thread/list", {
      cwd: process.cwd(),
    });
    const read = await client.request<{ thread: { id: string; turns: unknown[] } }>("thread/read", {
      threadId: listed.data[0]?.id ?? "missing",
      includeTurns: true,
    });
    expect(listed.data[0]?.id).toBe("root");
    expect(read.thread).toMatchObject({ id: "root" });
    expect(read.thread.turns).toHaveLength(2);
  });

  it("forks an exact snapshot and supports archive, restore, and permanent cleanup", async () => {
    const fixture = join(process.cwd(), "test", "fixtures", "mock-app-server.cjs");
    const client = new AppServerClient(process.execPath, "test", [fixture]);
    clients.push(client);

    const forked = await client.request<{ thread: { id: string; turns: unknown[] } }>(
      "thread/fork",
      { threadId: "root", lastTurnId: "turn-1" },
    );
    expect(forked.thread.turns).toHaveLength(1);
    const threadId = forked.thread.id;

    await client.request("thread/archive", { threadId });
    const archived = await client.request<{ data: Array<{ id: string }> }>("thread/list", {
      archived: true,
      ancestorThreadId: "root",
    });
    expect(archived.data.map((thread) => thread.id)).toContain(threadId);

    await client.request("thread/unarchive", { threadId });
    await client.request("thread/delete", { threadId });
    await expect(
      client.request("thread/read", { threadId, includeTurns: true }),
    ).rejects.toThrow(/missing thread/u);
  });

  it("waits for the App Server process to exit before handing a task to another client", async () => {
    const fixture = join(process.cwd(), "test", "fixtures", "mock-app-server.cjs");
    const client = new AppServerClient(process.execPath, "test", [fixture]);
    clients.push(client);
    const { pid } = await client.request<{ pid: number }>("test/pid", {});

    await client.shutdown();

    expect(() => process.kill(pid, 0)).toThrow();
    await expect(client.request("thread/list", {})).rejects.toThrow(/disposed/u);
  });
});
