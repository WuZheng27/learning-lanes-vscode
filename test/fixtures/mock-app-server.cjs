const readline = require("node:readline");

const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const threads = new Map([
  [
    "root",
    {
      id: "root",
      cwd: process.cwd(),
      archived: false,
      forkedFromId: null,
      status: { type: "notLoaded" },
      turns: [
        { id: "turn-1", status: "completed", items: [] },
        { id: "turn-2", status: "completed", items: [] },
      ],
    },
  ],
]);
let nextFork = 1;

reader.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    if (message.params?.capabilities?.experimentalApi !== true) {
      send({ id: message.id, error: { code: -32602, message: "experimentalApi required" } });
      return;
    }
    send({ id: message.id, result: { userAgent: "mock" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "test/pid") {
    send({ id: message.id, result: { pid: process.pid } });
    return;
  }
  if (message.method === "thread/unsubscribe") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/list") {
    const archived = message.params.archived === true;
    const ancestor = message.params.ancestorThreadId;
    const data = [...threads.values()].filter((thread) => {
      if (thread.archived !== archived) return false;
      if (!ancestor) return true;
      let parentId = thread.forkedFromId;
      while (parentId) {
        if (parentId === ancestor) return true;
        parentId = threads.get(parentId)?.forkedFromId ?? null;
      }
      return false;
    });
    send({ id: message.id, result: { data } });
    return;
  }
  if (message.method === "thread/read") {
    const thread = threads.get(message.params.threadId);
    if (!thread) {
      send({ id: message.id, error: { code: -32001, message: "missing thread" } });
      return;
    }
    send({ id: message.id, result: { thread } });
    return;
  }
  if (message.method === "thread/fork") {
    const source = threads.get(message.params.threadId);
    if (!source) {
      send({ id: message.id, error: { code: -32001, message: "missing source" } });
      return;
    }
    const lastTurnIndex = source.turns.findIndex((turn) => turn.id === message.params.lastTurnId);
    if (lastTurnIndex < 0) {
      send({ id: message.id, error: { code: -32602, message: "missing lastTurnId" } });
      return;
    }
    const id = `fork-${nextFork++}`;
    const thread = {
      ...source,
      id,
      forkedFromId: source.id,
      turns: source.turns.slice(0, lastTurnIndex + 1),
    };
    threads.set(id, thread);
    send({ id: message.id, result: { thread } });
    return;
  }
  if (message.method === "thread/archive") {
    const thread = threads.get(message.params.threadId);
    if (thread) thread.archived = true;
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/unarchive") {
    const thread = threads.get(message.params.threadId);
    if (!thread) {
      send({ id: message.id, error: { code: -32001, message: "missing thread" } });
      return;
    }
    thread.archived = false;
    send({ id: message.id, result: { thread } });
    return;
  }
  if (message.method === "thread/delete") {
    const remove = new Set([message.params.threadId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const thread of threads.values()) {
        if (thread.forkedFromId && remove.has(thread.forkedFromId) && !remove.has(thread.id)) {
          remove.add(thread.id);
          changed = true;
        }
      }
    }
    for (const id of remove) threads.delete(id);
    send({ id: message.id, result: {} });
    return;
  }
  send({ id: message.id, error: { code: -32601, message: "Unsupported" } });
});
