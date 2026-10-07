const fs = require("node:fs");
const readline = require("node:readline");
const mode = process.argv[2];
const recordPath = process.argv[3];
const events = [];
const record = event => {
  events.push(event);
  fs.writeFileSync(recordPath, JSON.stringify({ pid: process.pid, events }));
};
record("started");
const reader = readline.createInterface({ input: process.stdin });
const keepAlive = setInterval(() => {}, 1_000);
const finish = () => { clearInterval(keepAlive); process.exit(0); };
reader.on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
  } else if (message.method === "test/pid") {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { pid: process.pid } })}\n`);
  }
});
reader.on("close", () => {
  record("EOF");
  if (mode === "graceful") finish();
  if (mode === "slow") setTimeout(finish, 100);
  if (mode === "flood") {
    const notification = `${JSON.stringify({ method: "test/notification", params: { text: "x".repeat(100) } })}\n`;
    process.stdout.write(notification.repeat(30_000), () => { record("drained"); finish(); });
  }
});
process.on("SIGTERM", () => {
  record("SIGTERM");
  if (mode !== "stubborn") finish();
});
