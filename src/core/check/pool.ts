import { Worker } from "node:worker_threads";

export type PoolOutcome<R> =
  | { readonly kind: "done"; readonly result: R }
  | { readonly kind: "timeout" }
  | { readonly kind: "crashed"; readonly message: string };

type Pending<J, R> = { readonly job: J; readonly resolve: (outcome: PoolOutcome<R>) => void };

/**
 * Runs one job per worker at a time. A worker that times out or crashes is terminated and dropped, and the next job
 * spawns a fresh one. Idle workers are unref'd so they never keep the process alive.
 */
export function createPool<J, R>(options: { file: URL; size: number; timeoutMs: number }) {
  const idle: Worker[] = [];
  const queue: Pending<J, R>[] = [];
  let live = 0;
  let closed = false;

  const spawn = () => {
    live += 1;
    return new Worker(options.file, { resourceLimits: { maxOldGenerationSizeMb: 256 } });
  };

  const drop = (worker: Worker) => {
    live -= 1;
    void worker.terminate();
  };

  const dispatch = () => {
    while (queue.length > 0 && (idle.length > 0 || live < options.size)) {
      const pending = queue.shift();
      if (pending === undefined) return;
      start(idle.pop() ?? spawn(), pending);
    }
  };

  const start = (worker: Worker, { job, resolve }: Pending<J, R>) => {
    worker.ref();
    const onMessage = (result: R) => finish({ kind: "done", result }, true);
    const onError = (e: Error) => finish({ kind: "crashed", message: e.message }, false);
    const onExit = (code: number) => finish({ kind: "crashed", message: `worker exited with code ${code}` }, false);
    const finish = (outcome: PoolOutcome<R>, keep: boolean) => {
      clearTimeout(timer);
      worker.off("message", onMessage).off("error", onError).off("exit", onExit);
      if (keep && !closed) {
        worker.unref();
        idle.push(worker);
      } else {
        drop(worker);
      }
      resolve(outcome);
      dispatch();
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }, false), options.timeoutMs);
    worker.on("message", onMessage).on("error", onError).on("exit", onExit);
    worker.postMessage(job);
  };

  return {
    run(job: J): Promise<PoolOutcome<R>> {
      if (closed) return Promise.resolve({ kind: "crashed", message: "the check pool is closed" });
      return new Promise((resolve) => {
        queue.push({ job, resolve });
        dispatch();
      });
    },
    async close(): Promise<void> {
      closed = true;
      await Promise.all(idle.splice(0).map((w) => w.terminate()));
    },
  };
}
