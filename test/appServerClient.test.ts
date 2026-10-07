import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient } from "../src/appServerClient.js";

const clients: AppServerClient[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.shutdown()));
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});

async function shutdownClient(mode: string) {
  const directory = mkdtempSync(join(tmpdir(), "navigator-shutdown-"));
  directories.push(directory);
  const recordPath = join(directory, "events.json");
  const client = new AppServerClient(process.execPath, "test", [join(process.cwd(), "test/fixtures/shutdown-app-server.cjs"), mode, recordPath]);
  clients.push(client);
  const { pid } = await client.request<{ pid: number }>("test/pid", {});
  const events = () => JSON.parse(readFileSync(recordPath, "utf8")).events as string[];
  return { client, pid, events };
}

describe("AppServerClient", () => {
  it("closes input and confirms graceful exit before sending termination signals", async () => {
    const { client, pid, events } = await shutdownClient("graceful");
    await client.shutdown();
    expect(events()).toEqual(["started", "EOF"]);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("shares delayed shutdown with concurrent shutdown and disposal calls", async () => {
    const { client, pid, events } = await shutdownClient("slow");
    const first = client.shutdown();
    const second = client.shutdown(0, 0);
    expect(second).toBe(first);
    client.dispose();
    await Promise.all([first, second]);
    expect(events()).toEqual(["started", "EOF"]);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("continues draining output while the server flushes notifications on exit", async () => {
    const { client, pid, events } = await shutdownClient("flood");
    await client.shutdown();
    expect(events()).toEqual(["started", "EOF", "drained"]);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it.runIf(process.platform !== "win32")("uses SIGTERM when EOF does not stop the process", async () => {
    const { client, pid, events } = await shutdownClient("term");
    await client.shutdown(30, 1_000);
    expect(events()).toEqual(["started", "EOF", "SIGTERM"]);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it.runIf(process.platform !== "win32")("escalates to SIGKILL when a process ignores EOF and SIGTERM", async () => {
    const { client, pid, events } = await shutdownClient("stubborn");
    await client.shutdown(30, 100);
    expect(events()).toEqual(["started", "EOF", "SIGTERM"]);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("rejects pending requests and blocks new work during shutdown", async () => {
    const { client } = await shutdownClient("slow");
    const pending = client.request("test/pending", {});
    await Promise.resolve();
    const rejected = expect(pending).rejects.toThrow(/shut down|disposed/u);
    const shutdown = client.shutdown();
    await expect(client.request("test/pid", {})).rejects.toThrow(/disposed/u);
    await Promise.all([shutdown, rejected]);
  });
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
