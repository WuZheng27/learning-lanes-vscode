import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("vscode", () => ({}));
vi.mock("../src/appServerClient.js", () => ({ AppServerClient: class {
  start = vi.fn(async () => {}); request = rpc; dispose = vi.fn();
} }));
import { CodexBridge } from "../src/codexBridge.js";
import { buildSyncedTurnNodes } from "../src/model.js";
import { buildLaneLayout } from "../src/layout.js";

interface Replay {
  rootId: string;
  descendantId: string;
  ancestorSummaries: Array<{id: string; parent: string | null}>;
  expectedNodes: number;
  expectedLanes: number;
  threads: Array<{ id: string; parent: string | null; createdAt: number; updatedAt: number; turnIds: string[] }>;
  expectedEdges: Array<[string, string | null]>;
}
const cases = JSON.parse(readFileSync("test/fixtures/list-null-ancestry.json", "utf8")) as Replay[];
beforeEach(() => { rpc.mockReset(); });

describe("anonymized real-history structure replay", () => {
  for (const [index, fixture] of cases.entries()) {
    it(`recovers root grouping and every node edge in history ${index + 1}`, async () => {
      rpc.mockImplementation(async (method, params) => {
        if (method === "thread/list") {
          const offset = Number(params.cursor ?? 0);
          const pageSize = Math.min(5, params.limit);
          return { data: fixture.threads.slice(offset, offset + pageSize).map(thread => ({
            id: thread.id, forkedFromId: null, createdAt: thread.createdAt, updatedAt: thread.updatedAt,
          })), nextCursor: offset + pageSize < fixture.threads.length ? String(offset + pageSize) : null };
        }
        const thread = fixture.threads.find(thread => thread.id === params.threadId);
        if (!thread) {
          const ancestor = fixture.ancestorSummaries.find(thread => thread.id === params.threadId);
          if (!ancestor) throw new Error("missing historical ancestor");
          return { thread: { id: ancestor.id, forkedFromId: ancestor.parent } };
        }
        return { thread: {
          id: thread.id, forkedFromId: thread.parent, createdAt: thread.createdAt, updatedAt: thread.updatedAt,
          turns: params.includeTurns ? thread.turnIds.map(id => ({ id, status: "completed", items: [] })) : [],
        } };
      });
      const client = new CodexBridge("test");
      vi.spyOn(client, "checkCompatibility").mockResolvedValue({
        extensionVersion: "test", appServerVersion: "test", executable: "mock", sidebarViewId: "mock",
      });
      const roots = await client.listAllRootThreads();
      expect(roots.map(thread => thread.id)).toEqual([fixture.rootId]);
      expect(await client.resolveRootThread(fixture.descendantId)).toBe(fixture.rootId);
      const related = await client.listRelatedThreads(fixture.rootId, "/fixture");
      const snapshots = new Map(await Promise.all(related.map(async thread => [thread.id, await client.readThread(thread.id)] as const)));
      const nodes = buildSyncedTurnNodes(fixture.rootId, related, snapshots, [], new Set());
      expect(nodes).toHaveLength(fixture.expectedNodes);
      expect(nodes.map(node => [node.id, node.parentNodeId]).sort((a, b) => a[0]!.localeCompare(b[0]!))).toEqual(fixture.expectedEdges);
      expect(buildLaneLayout(nodes).laneCount).toBe(fixture.expectedLanes);
    });
  }
});
