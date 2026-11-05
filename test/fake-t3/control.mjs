// Field names follow docs/t3-cli.md, so threads move through runs the way real T3 threads do.
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export function fakeT3(statePath) {
  const load = () => JSON.parse(readFileSync(statePath, "utf8"));
  const save = (state) => {
    writeFileSync(`${statePath}.control.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${statePath}.control.tmp`, statePath);
  };
  const update = (fn) => {
    const state = load();
    fn(state);
    save(state);
  };
  const thread = (state, id) => {
    const t = state.threads?.[id];
    if (t === undefined) throw new Error(`the fake T3 has no thread ${id}`);
    return t;
  };

  return {
    state: load,
    sent: () => load().sent ?? [],
    messages: (id) => thread(load(), id).messages ?? [],
    addThread: (id, fields) =>
      update((s) => {
        s.threads[id] = { status: "completed", activeRunId: null, latestRunId: null, pendingRequestCount: 0, messages: [], ...fields };
      }),
    startRun: (id) =>
      update((s) => {
        const t = thread(s, id);
        t.runs = (t.runs ?? 0) + 1;
        const runId = `run:thread:${id}:ordinal:${t.runs}`;
        t.messages = (t.messages ?? []).map((m) => (m.runId === null ? { ...m, runId } : m));
        Object.assign(t, { status: "running", activeRunId: runId, latestRunId: runId, pendingRequestCount: 0 });
      }),
    /** The running agent waits for an answer (`--wait` would exit 2). */
    ask: (id) => update((s) => void (thread(s, id).pendingRequestCount = 1)),
    endRun: (id, status) => update((s) => void Object.assign(thread(s, id), { status, activeRunId: null, pendingRequestCount: 0 })),
    setMissing: (id, missing) => update((s) => void (thread(s, id).missing = missing)),
    setFail: (fail) => update((s) => void (s.fail = fail)),
    setFailAfter: (failAfter) => update((s) => void (s.failAfter = failAfter)),
    setHold: (hold) => update((s) => void (s.hold = hold)),
  };
}
