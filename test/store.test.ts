import { mkdtempSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker } from "../src/core/check";
import { Store } from "../src/core/store";
import type { BlockId, ContentHash, IterationN, ProjectId, RequestN, SessionId, ThreadId } from "../src/core/types";
import { contentHash } from "../src/core/workingCopy";
import { FakeBridge } from "./fakeBridge";

const session = "s_8f2k3a" as SessionId;
const t1 = "11111111-1111-1111-1111-111111111111" as ThreadId;
const t2 = "22222222-2222-2222-2222-222222222222" as ThreadId;
const at = "2026-11-05T10:00:00.000Z";

function seeded(path: string): Store {
  const store = new Store(path);
  store.ensureProject("p1" as ProjectId, null, at);
  store.createSession({ id: session, projectId: "p1" as ProjectId, title: "Wheel", brief: "", createdAt: at }, t1);
  return store;
}

test("migrations run once and reopening keeps the data", () => {
  const path = join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db");
  const store = seeded(path);
  store.nameProject("p1" as ProjectId, "brainstorm");
  store.close();
  const reopened = new Store(path);
  expect(reopened.schemaVersion()).toBe(11);
  expect(reopened.session(session)).toEqual({ id: session, projectId: "p1", title: "Wheel", brief: "", createdAt: at });
  expect(reopened.sessions(null).map((s) => s.projectName)).toEqual(["brainstorm"]);
  reopened.close();
});

test("a version 1 store gains a null name for the projects it already has", () => {
  const path = join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db");
  seeded(path).close();
  const v1 = new DatabaseSync(path);
  v1.exec("ALTER TABLE project DROP COLUMN name; DROP TABLE ui_pref; ALTER TABLE block_content ADD COLUMN about TEXT; ALTER TABLE session DROP COLUMN settled_at; ALTER TABLE session DROP COLUMN unsettled_at; DROP TABLE fork; DROP TABLE variant_seen; DROP TABLE promotion; DROP TABLE iteration_proposed; DROP TABLE proposed_content; DROP TABLE session_theme; ALTER TABLE session DROP COLUMN system_n; ALTER TABLE session DROP COLUMN system_id; DROP TABLE design_system_theme; DROP TABLE design_system_version; DROP TABLE design_system; DROP TABLE system_import; DROP TABLE main_choice; DROP TABLE graft; DROP TABLE trashed; DROP TABLE primary_branch; PRAGMA user_version = 1;");
  v1.close();
  const store = new Store(path);
  expect(store.schemaVersion()).toBe(11);
  expect(store.sessions(null).map((s) => [s.id, s.projectName])).toEqual([[session, null]]);
  store.close();
});

test("one open attachment and one open request per session", () => {
  const store = seeded(join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db"));
  store.reattach(session, t2, "2026-11-05T11:00:00.000Z");
  expect(store.attachment(session)).toEqual({ session, threadId: t2, attachedAt: "2026-11-05T11:00:00.000Z", lostAt: null });

  const body = { scope: { kind: "all" as const }, freetext: null };
  expect(store.insertRequest(session, { body, feedbackIds: [], base: null, threadId: t2, at })).toBe(1);
  expect(() => store.insertRequest(session, { body, feedbackIds: [], base: null, threadId: t2, at })).toThrow(
    "UNIQUE constraint failed: request.session_id",
  );
  store.setRequestState(session, 1 as RequestN, { state: "withdrawn" });
  expect(store.insertRequest(session, { body, feedbackIds: [], base: null, threadId: t2, at })).toBe(2);
  store.close();
});

test("a branch joins its tree's thread as it is, lost included, and its request 1 is answered by its first iteration or left open", () => {
  const store = seeded(join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db"));
  const lostAt = "2026-11-05T11:00:00.000Z";
  const empty = { blocks: [], contents: [], proposed: [], proposedContents: [], addresses: [] };
  store.insertIteration({ session, iteration: { n: 1 as IterationN, threadId: t1, note: null, slots: [], createdAt: at }, ...empty });
  store.setLost(session, lostAt);
  const branch = (id: SessionId, answered: boolean) =>
    store.createBranch(
      {
        session: { id, projectId: "p1" as ProjectId, title: "Branch", brief: "", createdAt: at },
        link: { parent: session, from: 1 as IterationN, baked: [], createdAt: at },
        iteration: { n: 2 as IterationN, threadId: t1, note: null, slots: [], createdAt: at },
        blocks: [],
        contents: [],
        proposed: [],
        feedback: [],
        request: { body: { scope: { kind: "all" }, freetext: null }, at, answered },
        system: null,
        theme: [],
      },
      store.attachment(session),
    );
  const answered = "s_answer01" as SessionId;
  const asking = "s_asking01" as SessionId;
  branch(answered, true);
  branch(asking, false);
  expect(store.attachment(answered)).toMatchObject({ threadId: t1, lostAt });
  expect(store.requests(answered).map((r) => [r.n, r.base, r.state])).toEqual([[1, 1, { state: "fulfilled", iteration: 2 }]]);
  expect(store.requests(asking).map((r) => [r.n, r.base, r.state])).toEqual([[1, 2, { state: "sending" }]]);
  store.close();
});

test("a delivery result lands only on a request still sending to that thread", () => {
  const store = seeded(join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db"));
  const body = { scope: { kind: "all" as const }, freetext: null };
  const n = store.insertRequest(session, { body, feedbackIds: [], base: null, threadId: t1, at });
  expect(store.settleDelivery(session, n, t2, { state: "sent", sentAt: at }), "another thread's send").toBe(false);
  expect(store.settleDelivery(session, n, t1, { state: "send_failed", error: "timed out" })).toBe(true);
  expect(store.settleDelivery(session, n, t1, { state: "sent", sentAt: at }), "no longer sending").toBe(false);
  expect(store.requests(session).map((r) => r.state)).toEqual([{ state: "send_failed", error: "timed out" }]);
  store.close();
});

test("a version 3 store drops variant notes and stores each noted block under the hash of its files without the note", () => {
  const path = join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db");
  seeded(path).close();
  const v3 = new DatabaseSync(path);
  v3.exec("ALTER TABLE block_content ADD COLUMN about TEXT; ALTER TABLE session DROP COLUMN settled_at; ALTER TABLE session DROP COLUMN unsettled_at; DROP TABLE fork; DROP TABLE variant_seen; DROP TABLE promotion; DROP TABLE iteration_proposed; DROP TABLE proposed_content; DROP TABLE session_theme; ALTER TABLE session DROP COLUMN system_n; ALTER TABLE session DROP COLUMN system_id; DROP TABLE design_system_theme; DROP TABLE design_system_version; DROP TABLE design_system; DROP TABLE system_import; DROP TABLE main_choice; DROP TABLE graft; DROP TABLE trashed; DROP TABLE primary_branch; PRAGMA user_version = 3;");
  const files = { tsx: "export default () => null;\n", json: '{ "title": "Neon" }\n', css: null, controls: null };
  const insert = v3.prepare(
    "INSERT INTO block_content(hash, source, css, block_json, controls_json, controls_derived, about, compiled, parts_json) VALUES (?, ?, NULL, ?, NULL, 1, ?, 'compiled', '[]')",
  );
  insert.run("a".repeat(64), files.tsx, files.json, "**Hypothesis.** Loud wins.");
  insert.run("b".repeat(64), files.tsx, files.json, "**Tradeoff.** It tires.");
  v3.prepare("INSERT INTO iteration(session_id, n, thread_id, slots_json, created_at) VALUES (?, 1, ?, '[]', ?), (?, 2, ?, '[]', ?)").run(session, t1, at, session, t1, at);
  v3.prepare("INSERT INTO iteration_block(session_id, n, block_id, hash) VALUES (?, 1, 'wheel/neon', ?), (?, 2, 'wheel/neon', ?)").run(session, "a".repeat(64), session, "b".repeat(64));
  v3.close();

  const store = new Store(path);
  const hash = contentHash(files);
  expect(store.schemaVersion()).toBe(11);
  expect(store.iterationBlocks(session, 1 as IterationN)).toEqual([{ id: "wheel/neon" as BlockId, hash }]);
  expect(store.iterationBlocks(session, 2 as IterationN)).toEqual([{ id: "wheel/neon" as BlockId, hash }]);
  expect(store.content(hash as ContentHash)).toEqual({ hash, files, compiled: "compiled", parts: [] });
  expect(store.hasContent("a".repeat(64) as ContentHash)).toBe(false);
  store.close();
  const columns = new DatabaseSync(path).prepare("SELECT name FROM pragma_table_info('block_content')").all().map((r) => r.name);
  expect(columns).not.toContain("about");
});

/**
 * A version 9 store as version 9's own code wrote it: test/fixtures/make-v9-store.mjs drove that commit's service to
 * make it, and its header lists what is in it. Loaded fresh for each test, so the migration runs on rows nobody wrote
 * by hand.
 */
function v9Store(): string {
  const path = join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db");
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(import.meta.dirname, "fixtures", "v9-store.sql"), "utf8"));
  expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(9);
  db.close();
  return path;
}

const v9 = {
  root: "s_root0001" as SessionId,
  fork: "s_fork0001" as SessionId,
  grand: "s_grand001" as SessionId,
  pending: "s_pend0001" as SessionId,
  same: "s_same0001" as SessionId,
  lost: "s_lost0001" as SessionId,
  lostFork: "s_lfork001" as SessionId,
  rootThread: "11111111-1111-1111-1111-111111111111" as ThreadId,
  forkThread: "f0000000-0000-4000-8000-000000000001" as ThreadId,
  grandThread: "f0000000-0000-4000-8000-000000000002" as ThreadId,
  lostThread: "33333333-3333-3333-3333-333333333333" as ThreadId,
  lostAt: "2026-11-01T09:00:36.000Z",
};
const RETRY_THERE = "Brainstorm now keeps every branch on one thread; retry to send it there";

test("a version 9 store turns forks into branches: their iterations continue the parent's numbers, on the root's thread", async () => {
  const path = v9Store();
  const store = new Store(path);
  expect(store.schemaVersion()).toBe(11);
  const ns = (id: SessionId) => [1, 2, 3, 4, 5, 6].filter((n) => store.iteration(id, n as IterationN) !== null);
  expect(ns(v9.root)).toEqual([1, 2, 3]);
  expect(ns(v9.fork), "a fork from 2 starts at 3").toEqual([3, 4]);
  expect(ns(v9.grand), "its child left it at its first iteration, now 3").toEqual([4, 5]);
  expect(ns(v9.pending), "a fork from 3 starts at 4").toEqual([4]);
  expect(ns(v9.same), "a fork from 1 starts at 2").toEqual([2]);
  expect([v9.fork, v9.grand, v9.pending, v9.same].map((id) => store.branchLink(id)?.from)).toEqual([2, 3, 3, 1]);

  // What moves with a fork's iterations: their blocks and proposed components, its pins and their history, and the
  // requests they answered. The root's own rows stay where they were.
  expect(store.iteration(v9.fork, 3 as IterationN)?.threadId, "the iteration the fork copied was written on the root's thread").toBe(v9.rootThread);
  expect(store.iteration(v9.fork, 4 as IterationN)).toMatchObject({ threadId: v9.forkThread, note: "darker, as a list" });
  expect(store.iterationBlocks(v9.root, 2 as IterationN)).toEqual([{ id: "home/a", hash: "ff915348d6d67e544be9d425c3c4106d7d1105dbc0129a56d4fb9386a959a1ff" }]);
  expect(store.iterationBlocks(v9.fork, 3 as IterationN)).toEqual([{ id: "home/a", hash: "ff915348d6d67e544be9d425c3c4106d7d1105dbc0129a56d4fb9386a959a1ff" }]);
  expect(store.iterationBlocks(v9.fork, 4 as IterationN)).toEqual([{ id: "home/a", hash: "f9f2b96f5bf2b9b360e01a64b5a2ac521cff36dbb54eb9010f0411c9003c0eb5" }]);
  expect(store.iterationBlocks(v9.grand, 4 as IterationN)).toEqual([{ id: "home/a", hash: "ff915348d6d67e544be9d425c3c4106d7d1105dbc0129a56d4fb9386a959a1ff" }]);
  expect(store.iterationBlocks(v9.grand, 5 as IterationN)).toEqual([{ id: "home/a", hash: "b66de2195991bb384f59ec2a986351120e7143b5c29947a9a9b859e16b330b0d" }]);
  expect(store.iterationBlocks(v9.pending, 4 as IterationN)).toEqual([{ id: "home/a", hash: "2a365f4c9bf96a45e860d0f7b7b33ffc173e2524e142be94d18c8a486ae4ca01" }]);
  expect(store.iterationBlocks(v9.same, 2 as IterationN)).toEqual([{ id: "home/a", hash: "957bae70861cf3c0ef4f039b61703b292df9593b01074d4551acd8fbb2c68085" }]);
  expect(store.iterationProposed(v9.fork, 4 as IterationN)).toEqual([{ name: "ChoreList", hash: "f4db589a42c1873d8f31fd4f08760a60896434103519454edeb643ed4d44acd1" }]);
  expect(store.iterationProposed(v9.fork, 2 as IterationN)).toEqual([]);
  const pins = (id: SessionId) => store.feedback(id).map((f) => [f.id, f.text, f.createdIn, f.history]);
  expect(pins(v9.root)).toEqual([[1, "darker still", 3, []]]);
  expect(pins(v9.fork)).toEqual([[1, "darker still", 3, [{ kind: "address", iteration: 4, at: "2026-11-01T09:00:12.000Z" }]]]);
  expect(pins(v9.pending)).toEqual([[1, "darker still", 4, []]]);
  expect(pins(v9.same)).toEqual([[1, "darker still", 2, []]]);

  // Every branch is on the root's thread now.
  for (const id of [v9.root, v9.fork, v9.grand, v9.pending, v9.same]) {
    expect(store.attachment(id), id).toMatchObject({ threadId: v9.rootThread, lostAt: null });
  }
  const requests = (id: SessionId) => store.requests(id).map((r) => [r.n, r.base, r.threadId, r.state]);
  expect(requests(v9.root)).toEqual([[1, 3, v9.rootThread, { state: "sent" }]]);
  expect(requests(v9.fork), "the open one waits on its old thread no longer").toEqual([
    [1, 3, v9.forkThread, { state: "fulfilled", iteration: 4 }],
    [2, 4, v9.rootThread, { state: "send_failed", error: RETRY_THERE }],
  ]);
  expect(requests(v9.grand)).toEqual([[1, 4, v9.grandThread, { state: "fulfilled", iteration: 5 }]]);
  expect(requests(v9.pending), "a fork whose thread never started").toEqual([[1, 4, v9.rootThread, { state: "send_failed", error: RETRY_THERE }]]);
  expect(requests(v9.same), "a fork on the root's thread waits beside the root's request too").toEqual([
    [1, 2, v9.rootThread, { state: "send_failed", error: RETRY_THERE }],
  ]);
  store.close();

  // The tree now has four open requests on one thread; the root's goes first, and the forks' wait for it.
  const bridge = new FakeBridge();
  bridge.add(v9.rootThread, "p1");
  const checker = createChecker({ size: 1 });
  const service = await Brainstorm.open({ dbPath: path, exportsDir: join(path, "..", "exports"), bridge, checker });
  for (const id of Object.values(v9).filter((v) => v.startsWith("s_"))) expect((await service.view(id as SessionId)).ok, id).toBe(true);
  expect(await service.act(v9.fork, { kind: "retry_request" })).toEqual({
    ok: false,
    error: { code: "request_open", message: `branch ${v9.root} has request 1 open on this thread; let it finish or withdraw it first`, n: 1 },
  });
  expect(bridge.sent).toEqual([]);

  // Once the root's request closes, the waiting ones don't hold each other up: the first retried goes, and the
  // others then wait for it.
  expect(await service.act(v9.root, { kind: "withdraw_request" })).toMatchObject({ ok: true });
  expect(await service.act(v9.fork, { kind: "retry_request" })).toMatchObject({ ok: true });
  expect(bridge.sent.map((m) => [m.thread, m.message.split("\n")[0]])).toEqual([
    [v9.rootThread, `[brainstorm] session ${v9.fork} · request 2 · scope: all · freetext: "darker again"`],
  ]);
  for (const waiting of [v9.pending, v9.same]) {
    expect(await service.act(waiting, { kind: "retry_request" })).toEqual({
      ok: false,
      error: { code: "request_open", message: `branch ${v9.fork} has request 2 open on this thread; let it finish or withdraw it first`, n: 2 },
    });
  }
  expect(bridge.sent).toHaveLength(1);
  service.close();
  await checker.close();
});

test("a version 9 fork that joins a lost root thread is lost too", () => {
  const store = new Store(v9Store());
  expect(store.attachment(v9.lost)).toMatchObject({ threadId: v9.lostThread, lostAt: v9.lostAt });
  expect(store.attachment(v9.lostFork)).toMatchObject({ threadId: v9.lostThread, lostAt: v9.lostAt });
  expect([1, 2, 3, 4].filter((n) => store.iteration(v9.lostFork, n as IterationN) !== null), "a fork from 1 starts at 2").toEqual([2, 3]);
  expect(store.requests(v9.lostFork).map((r) => [r.n, r.base, r.state])).toEqual([[1, 2, { state: "fulfilled", iteration: 3 }]]);
  store.close();
});
