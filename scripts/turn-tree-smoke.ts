import { AppServerClient } from "../src/appServerClient.js";
import { buildSyncedTurnNodes } from "../src/model.js";
import { parseThreadList, parseThreadSnapshot } from "../src/protocol.js";

const [executable, cwd, rootThreadId] = process.argv.slice(2);
if (!executable || !cwd || !rootThreadId) {
  throw new Error("Usage: turn-tree-smoke <codex-executable> <cwd> <root-thread-id>");
}

async function main(): Promise<void> {
  const client = new AppServerClient(executable, "0.5.0");
  try {
    const listed = parseThreadList(
      await client.request<unknown>("thread/list", {
        cursor: null,
        limit: 100,
        sortKey: "updated_at",
        cwd,
        sourceKinds: ["vscode"],
      }),
    );
    const snapshots = new Map();
    for (const thread of listed) {
      snapshots.set(
        thread.id,
        parseThreadSnapshot(
          await client.request<unknown>("thread/read", {
            threadId: thread.id,
            includeTurns: true,
          }),
        ),
      );
    }

    const nodes = buildSyncedTurnNodes(rootThreadId, listed, snapshots, [], new Set());
    const children = new Map<string | null, string[]>();
    for (const node of nodes) {
      const bucket = children.get(node.parentNodeId) ?? [];
      bucket.push(node.id);
      children.set(node.parentNodeId, bucket);
    }
    const siblingGroups = [...children.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([parentTurnId, ids]) => ({
        parentTurnId,
        titles: ids.map((id) => nodes.find((node) => node.id === id)?.title ?? id),
      }));

    process.stdout.write(
      `${JSON.stringify({
        ok: nodes.length > 0,
        taskCount: listed.length,
        nodeCount: nodes.length,
        exactNodes: nodes.filter((node) => node.navigationExact).length,
        approximateNodes: nodes.filter((node) => !node.navigationExact).length,
        emptyForkMarkers: nodes.reduce((sum, node) => sum + node.waitingBranchCount, 0),
        siblingGroups,
        lastNodes: nodes.slice(-5).map((node) => ({
          title: node.title,
          parentTurnId: node.parentNodeId,
          exact: node.navigationExact,
        })),
      })}\n`,
    );
  } finally {
    client.dispose();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
