import type { CodexListedThread } from "./types.js";

/** Stop scheduling after cancellation/failure, and drain already running requests. */
export async function mapWithConcurrency<T, R>(
  values: ReadonlyArray<T>, concurrency: number, mapper: (value: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<ReadonlyArray<R>> {
  const results = new Array<R>(values.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (!failed && !signal?.aborted && next < values.length) {
      const index = next++;
      try { results[index] = await mapper(values[index]!); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
  signal?.throwIfAborted();
  return results;
}

/** Unknown legacy ancestry requires the existing turn-prefix fallback. */
export function relatedThreads(rootId: string, threads: ReadonlyArray<CodexListedThread>): ReadonlyArray<CodexListedThread> {
  if (threads.some(thread => !thread.parentKnown && !thread.forkedFromId)) return threads;
  const children = new Map<string, string[]>();
  for (const thread of threads) {
    if (!thread.forkedFromId) continue;
    const bucket = children.get(thread.forkedFromId) ?? [];
    bucket.push(thread.id); children.set(thread.forkedFromId, bucket);
  }
  const reachable = new Set<string>();
  const queue = [rootId];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    if (reachable.has(id)) continue;
    reachable.add(id); queue.push(...(children.get(id) ?? []));
  }
  return threads.filter(thread => reachable.has(thread.id));
}
