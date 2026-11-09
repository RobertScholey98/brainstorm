import { mkdtempSync } from "node:fs";
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

test("a version 9 store turns forks into branches: their iterations continue the parent's numbers, on the root's thread", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db");
  seeded(path).close();
  const v9 = new DatabaseSync(path);
  v9.exec("DROP TABLE main_choice; DROP TABLE graft; DROP TABLE trashed; DROP TABLE primary_branch; PRAGMA user_version = 9;");
  const fork = "s_fork0001";
  const hash = "c".repeat(64);
  const grand = "s_grand001";
  // A fork whose own thread never finished starting: it was attached to a placeholder.
  const pending = "s_pend0001";
  const addSession = v9.prepare("INSERT INTO session(id, project_id, title, brief, created_at) VALUES (?, 'p1', ?, '', ?)");
  addSession.run(fork, "Darker", at);
  addSession.run(grand, "Smaller", at);
  addSession.run(pending, "Rounder", at);
  v9.prepare("INSERT INTO attachment(session_id, thread_id, attached_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(fork, t2, at, grand, t2, at, pending, `pending:${pending}`, at);
  const iteration = v9.prepare("INSERT INTO iteration(session_id, n, thread_id, slots_json, created_at) VALUES (?, ?, ?, '[]', ?)");
  for (const n of [1, 2, 3]) iteration.run(session, n, t1, at);
  for (const n of [1, 2]) iteration.run(fork, n, t2, at);
  iteration.run(grand, 1, t2, at);
  iteration.run(pending, 1, t1, at);
  const link = v9.prepare("INSERT INTO fork(session_id, parent_id, parent_n, baked_json, created_at) VALUES (?, ?, ?, '[]', ?)");
  link.run(fork, session, 2, at);
  link.run(grand, fork, 1, at);
  link.run(pending, session, 3, at);
  // What moves with a fork's iterations: their blocks and proposed components, its pins and their history, and the
  // requests they answered. The root's own request stays open on the root's thread.
  v9.prepare("INSERT INTO block_content(hash, source, css, block_json, controls_json, controls_derived, compiled, parts_json) VALUES (?, 'x', NULL, '{}', NULL, 1, 'x', '[]')").run(hash);
  v9.prepare("INSERT INTO proposed_content(hash, source, css, json, compiled) VALUES (?, 'x', NULL, '{}', 'x')").run(hash);
  const block = v9.prepare("INSERT INTO iteration_block(session_id, n, block_id, hash) VALUES (?, ?, 'wheel/neon', ?)");
  for (const n of [1, 2]) block.run(fork, n, hash);
  block.run(grand, 1, hash);
  v9.prepare("INSERT INTO iteration_proposed(session_id, n, name, hash) VALUES (?, 2, 'Dial', ?)").run(fork, hash);
  v9.prepare("INSERT INTO feedback(session_id, id, block_id, part, text, created_in, created_at) VALUES (?, 1, 'wheel/neon', NULL, 'darker still', 1, ?)").run(fork, at);
  v9.prepare("INSERT INTO feedback_event(session_id, feedback_id, seq, kind, iteration, at) VALUES (?, 1, 1, 'address', 2, ?)").run(fork, at);
  const request = v9.prepare(
    "INSERT INTO request(session_id, n, body_json, feedback_ids_json, base, thread_id, state, fulfilled_in, created_at) VALUES (?, ?, ?, '[]', ?, ?, ?, ?, ?)",
  );
  const body = (freetext: string) => JSON.stringify({ scope: { kind: "all" }, freetext });
  request.run(fork, 1, body("darker"), 1, t2, "fulfilled", 2, at);
  request.run(fork, 2, body("darker again"), 2, t2, "sent", null, at);
  request.run(session, 1, body("warmer"), 3, t1, "sent", null, at);
  request.run(pending, 1, body("rounder"), 1, `pending:${pending}`, "sending", null, at);
  v9.close();

  const store = new Store(path);
  expect(store.schemaVersion()).toBe(11);
  const ns = (id: string) => [1, 2, 3, 4, 5].filter((n) => store.iteration(id as SessionId, n as IterationN) !== null);
  expect(ns(session)).toEqual([1, 2, 3]);
  expect(ns(fork), "a fork from 2 starts at 3").toEqual([3, 4]);
  expect(ns(grand), "its child left it at its first iteration, now 3").toEqual([4]);
  expect(store.fork(grand as SessionId)?.from).toBe(3);
  expect(store.attachment(fork as SessionId).threadId).toBe(t1);
  expect(store.attachment(grand as SessionId).threadId).toBe(t1);
  expect(store.iterationBlocks(fork as SessionId, 3 as IterationN)).toEqual([{ id: "wheel/neon", hash }]);
  expect(store.iterationBlocks(fork as SessionId, 4 as IterationN)).toEqual([{ id: "wheel/neon", hash }]);
  expect(store.iterationBlocks(grand as SessionId, 4 as IterationN)).toEqual([{ id: "wheel/neon", hash }]);
  expect(store.iterationProposed(fork as SessionId, 4 as IterationN)).toEqual([{ name: "Dial", hash }]);
  expect(store.feedback(fork as SessionId).map((f) => [f.createdIn, f.history])).toEqual([[3, [{ kind: "address", iteration: 4, at }]]]);
  expect(store.requests(fork as SessionId).map((r) => [r.n, r.base, r.state])).toEqual([
    [1, 3, { state: "fulfilled", iteration: 4 }],
    [2, 4, { state: "send_failed", error: "Brainstorm now keeps every branch on one thread; retry to send it there" }],
  ]);
  expect(store.openRequest(fork as SessionId)?.threadId).toBe(t1);
  expect(store.openRequest(session)).toMatchObject({ n: 1, base: 3, threadId: t1, state: { state: "sent" } });
  expect(ns(pending), "a fork from 3 starts at 4").toEqual([4]);
  expect(store.attachment(pending as SessionId).threadId, "a fork whose thread never started joins the root's").toBe(t1);
  expect(store.requests(pending as SessionId).map((r) => [r.n, r.threadId, r.state])).toEqual([
    [1, t1, { state: "send_failed", error: "Brainstorm now keeps every branch on one thread; retry to send it there" }],
  ]);
  store.close();

  // The tree now has two open requests on one thread; the fork's waits for the root's.
  const bridge = new FakeBridge();
  bridge.add(t1, "p1");
  const checker = createChecker({ size: 1 });
  const service = await Brainstorm.open({ dbPath: path, exportsDir: join(path, "..", "exports"), bridge, checker });
  expect(await service.act(fork as SessionId, { kind: "retry_request" })).toEqual({
    ok: false,
    error: { code: "request_open", message: `branch ${session} has request 1 open on this thread; let it finish or withdraw it first`, n: 1 },
  });
  expect(bridge.sent).toEqual([]);
  service.close();
  await checker.close();
});
