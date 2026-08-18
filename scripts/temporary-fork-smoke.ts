import { AppServerClient } from "../src/appServerClient.js";
import { parseThreadId, parseThreadList, parseThreadSnapshot } from "../src/protocol.js";

const [executable, cwd, sourceThreadId, baseTurnId] = process.argv.slice(2);
if (!executable || !cwd || !sourceThreadId || !baseTurnId) {
  throw new Error(
    "Usage: temporary-fork-smoke <codex-executable> <cwd> <source-thread-id> <base-turn-id>",
  );
}

async function main(): Promise<void> {
  let client = new AppServerClient(executable, "0.5.0");
  let temporaryThreadId: string | null = null;
  let deleted = false;
  try {
    const source = parseThreadSnapshot(
      await client.request<unknown>("thread/read", {
        threadId: sourceThreadId,
        includeTurns: true,
      }),
    );
    const baseIndex = source.turns.findIndex((turn) => turn.id === baseTurnId);
    if (baseIndex < 0 || baseIndex === source.turns.length - 1) {
      throw new Error("The smoke test requires a real non-terminal base turn.");
    }

    temporaryThreadId = parseThreadId(
      await client.request<unknown>("thread/fork", {
        threadId: sourceThreadId,
        lastTurnId: baseTurnId,
      }),
    );
    if (temporaryThreadId === sourceThreadId) throw new Error("thread/fork reused the source id.");

    const forked = parseThreadSnapshot(
      await client.request<unknown>("thread/read", {
        threadId: temporaryThreadId,
        includeTurns: true,
      }),
    );
    if (forked.turns.at(-1)?.id !== baseTurnId || forked.turns.length !== baseIndex + 1) {
      throw new Error("The temporary fork did not end at the requested turn.");
    }

    await client.shutdown();
    client = new AppServerClient(executable, "0.5.0");
    const handedOff = parseThreadSnapshot(
      await client.request<unknown>("thread/read", {
        threadId: temporaryThreadId,
        includeTurns: true,
      }),
    );
    if (handedOff.turns.at(-1)?.id !== baseTurnId) {
      throw new Error("A second App Server could not take over the temporary fork.");
    }
    for (const archived of [false, true]) {
      await client.request("thread/list", {
        limit: 200,
        cursor: null,
        archived,
        cwd,
        sourceKinds: ["vscode"],
        ancestorThreadId: temporaryThreadId,
      });
    }

    await client.request("thread/archive", { threadId: temporaryThreadId });
    const archived = parseThreadList(
      await client.request<unknown>("thread/list", {
        limit: 200,
        cursor: null,
        archived: true,
        cwd,
        sourceKinds: ["vscode"],
      }),
    );
    if (!archived.some((thread) => thread.id === temporaryThreadId)) {
      throw new Error("Archived temporary fork was not discoverable.");
    }
    const archivedSnapshot = parseThreadSnapshot(
      await client.request<unknown>("thread/read", {
        threadId: temporaryThreadId,
        includeTurns: true,
      }),
    );
    if (archivedSnapshot.turns.at(-1)?.id !== baseTurnId) {
      throw new Error("Archived temporary fork could not be verified before deletion.");
    }

    await client.request("thread/unarchive", { threadId: temporaryThreadId });
    await client.shutdown();
    client = new AppServerClient(executable, "0.5.0");
    const restoredSnapshot = parseThreadSnapshot(
      await client.request<unknown>("thread/read", {
        threadId: temporaryThreadId,
        includeTurns: true,
      }),
    );
    if (restoredSnapshot.turns.at(-1)?.id !== baseTurnId) {
      throw new Error("A second App Server could not take over the restored fork.");
    }
    await client.request("thread/delete", { threadId: temporaryThreadId });
    deleted = true;
    try {
      await client.request("thread/read", { threadId: temporaryThreadId, includeTurns: true });
      throw new Error("Deleted temporary fork can still be read.");
    } catch (error) {
      if (error instanceof Error && error.message === "Deleted temporary fork can still be read.") {
        throw error;
      }
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        sourceThreadId,
        baseTurnId,
        temporaryThreadId,
        copiedTurnCount: forked.turns.length,
        processHandoff: true,
        archived: true,
        restored: true,
        deleted: true,
      })}\n`,
    );
  } finally {
    if (temporaryThreadId && !deleted) {
      try {
        await client.request("thread/delete", { threadId: temporaryThreadId });
      } catch {
        // The output will report the original failure; cleanup is best effort.
      }
    }
    client.dispose();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
