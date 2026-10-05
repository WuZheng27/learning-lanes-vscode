import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface AppServerMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly data?: unknown;
  };
}

export class AppServerClient {
  readonly #executable: string;
  readonly #args: ReadonlyArray<string>;
  readonly #version: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #reader: readline.Interface | null = null;
  #nextId = 1;
  #pending = new Map<string, PendingRequest>();
  #startPromise: Promise<void> | null = null;
  #stderrTail = "";
  #disposed = false;

  constructor(executable: string, version: string, args: ReadonlyArray<string> = ["app-server"]) {
    this.#executable = executable;
    this.#args = args;
    this.#version = version;
  }

  async start(): Promise<void> {
    if (this.#disposed) throw new Error("App Server client is disposed.");
    if (this.#startPromise) return this.#startPromise;
    if (this.#child) return;
    this.#startPromise = this.#start();
    try {
      await this.#startPromise;
    } finally {
      this.#startPromise = null;
    }
  }

  async #start(): Promise<void> {
    const child = spawn(this.#executable, [...this.#args], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    this.#child = child;
    this.#stderrTail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-8_000);
    });
    child.once("error", (error) => this.#handleExit(error));
    child.once("exit", (code, signal) => {
      const detail = this.#stderrTail.trim();
      const suffix = detail ? ` ${detail}` : "";
      this.#handleExit(
        new Error(`Codex App Server exited (code=${String(code)}, signal=${String(signal)}).${suffix}`),
      );
    });

    const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.#reader = reader;
    reader.on("line", (line) => this.#handleLine(line));

    await this.#requestRaw(
      "initialize",
      {
        clientInfo: {
          name: "codex_learning_navigator",
          title: "Codex Learning Navigator",
          version: this.#version,
        },
        capabilities: {
          experimentalApi: true,
        },
      },
      60_000,
    );
    this.notify("initialized", {});
  }

  async request<T>(method: string, params: Readonly<Record<string, unknown>>): Promise<T> {
    await this.start();
    return (await this.#requestRaw(method, params, 20_000)) as T;
  }

  notify(method: string, params: Readonly<Record<string, unknown>>): void {
    this.#send({ method, params });
  }

  #requestRaw(
    method: string,
    params: Readonly<Record<string, unknown>>,
    timeoutMs: number,
  ): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(String(id));
        reject(new Error(`Codex App Server request '${method}' timed out.`));
      }, timeoutMs);
      this.#pending.set(String(id), { method, resolve, reject, timer });
      try {
        this.#send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(String(id));
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #send(message: Readonly<Record<string, unknown>>): void {
    const child = this.#child;
    if (!child || child.stdin.destroyed) throw new Error("Codex App Server is not running.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line: string): void {
    if (!line.trim()) return;
    let message: AppServerMessage;
    try {
      message = JSON.parse(line) as AppServerMessage;
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const pending = this.#pending.get(String(message.id));
    if (!pending) {
      if (message.method) {
        this.#send({
          id: message.id,
          error: { code: -32601, message: `Unsupported server request: ${message.method}` },
        });
      }
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(String(message.id));
    if (message.error) {
      pending.reject(
        new Error(
          `Codex App Server '${pending.method}' failed: ${message.error.message ?? "Unknown error"}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  #handleExit(error: Error): void {
    if (!this.#child) return;
    this.#reader?.close();
    this.#reader = null;
    this.#child = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async shutdown(timeoutMs = 3_000): Promise<void> {
    this.#disposed = true;
    const child = this.#child;
    this.#child = null;
    this.#reader?.close();
    this.#reader = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex App Server client was shut down."));
    }
    this.#pending.clear();

    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        if (error) reject(error);
        else resolve();
      };
      const onExit = (): void => finish();
      const timer = setTimeout(() => {
        finish(new Error(`Codex App Server did not exit within ${timeoutMs}ms.`));
      }, timeoutMs);
      child.once("exit", onExit);
      if (!child.killed) child.kill();
    });
  }

  dispose(): void {
    void this.shutdown().catch(() => {
      // Disposal is best effort. Operations that require a confirmed handoff await shutdown directly.
    });
  }
}
