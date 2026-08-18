const { spawn } = require("node:child_process");
const readline = require("node:readline");

const executable = process.argv[2];
const cwd = process.argv[3] || process.cwd();
const ancestorThreadId = process.argv[4] && !process.argv[4].startsWith("--") ? process.argv[4] : null;
const readSamples = process.argv.includes("--read");
const allRoots = process.argv.includes("--all-roots");
const queryArgument = process.argv.find((value) => value.startsWith("--query="));
const query = queryArgument ? queryArgument.slice("--query=".length).toLocaleLowerCase() : "";
if (!executable) {
  process.stderr.write("Usage: node scripts/app-server-smoke.cjs <codex-executable> [cwd]\n");
  process.exit(2);
}

const child = spawn(executable, ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const pending = new Map();
let nextId = 1;
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-8_000);
});

const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const request = pending.get(String(message.id));
  if (!request) return;
  pending.delete(String(message.id));
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`Timed out: ${method}`));
    }, 15_000);
    pending.set(String(id), {
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function main() {
  try {
    await send("initialize", {
      clientInfo: { name: "codex-learning-navigator-smoke", version: "0.5.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    const discovered = [];
    const seenCursors = new Set();
    let cursor = null;
    for (let page = 0; page < 100; page += 1) {
      const listed = await send("thread/list", {
        limit: 200,
        cursor,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        ...(!allRoots ? { cwd } : {}),
        sourceKinds: ["vscode"],
        ...(ancestorThreadId ? { ancestorThreadId } : {}),
      });
      discovered.push(...(Array.isArray(listed?.data) ? listed.data : []));
      const nextCursor =
        typeof listed?.nextCursor === "string"
          ? listed.nextCursor
          : typeof listed?.next_cursor === "string"
            ? listed.next_cursor
            : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    const hydrated = allRoots
      ? await mapWithConcurrency(discovered, 12, async (thread) => {
          try {
            const read = await send("thread/read", {
              threadId: thread.id,
              includeTurns: false,
            });
            return {
              ...thread,
              forkedFromId: read?.thread?.forkedFromId ?? null,
            };
          } catch {
            return thread;
          }
        })
      : discovered;
    const roots = allRoots
      ? hydrated.filter((thread) => thread.forkedFromId == null)
      : hydrated;
    const threads = query
      ? roots.filter((thread) =>
          `${thread.name ?? ""}\n${thread.preview ?? ""}\n${thread.cwd ?? ""}\n${thread.id}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : roots;
    const sample = [];
    for (const thread of threads.slice(0, 20)) {
      let turnIds = null;
      let readForkedFromId = null;
      if (readSamples) {
        const read = await send("thread/read", { threadId: thread.id, includeTurns: true });
        turnIds = Array.isArray(read?.thread?.turns)
          ? read.thread.turns.map((turn) => turn.id)
          : [];
        readForkedFromId = read?.thread?.forkedFromId ?? null;
      }
      sample.push({
        id: thread.id,
        name: thread.name ?? null,
        preview: thread.preview ?? null,
        cwd: thread.cwd ?? null,
        forkedFromId: thread.forkedFromId ?? null,
        readForkedFromId,
        createdAt: thread.createdAt ?? null,
        turnIds,
      });
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        mode: allRoots ? "all-roots" : "workspace",
        discoveredThreads: discovered.length,
        rootThreads: roots.length,
        matchedThreads: threads.length,
        cwd: allRoots ? null : cwd,
        sample,
      })}\n`,
    );
  } finally {
    lines.close();
    child.kill();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n${stderr}\n`);
  lines.close();
  child.kill();
  process.exitCode = 1;
});
