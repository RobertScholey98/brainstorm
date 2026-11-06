import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Store } from "../src/core/store";
import type { BlockId, ContentHash, IterationN, ProjectId, RequestN, SessionId, ThreadId } from "../src/core/types";
import { contentHash } from "../src/core/workingCopy";

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
  expect(reopened.schemaVersion()).toBe(4);
  expect(reopened.session(session)).toEqual({ id: session, projectId: "p1", title: "Wheel", brief: "", createdAt: at });
  expect(reopened.sessions(null).map((s) => s.projectName)).toEqual(["brainstorm"]);
  reopened.close();
});

test("a version 1 store gains a null name for the projects it already has", () => {
  const path = join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db");
  seeded(path).close();
  const v1 = new DatabaseSync(path);
  v1.exec("ALTER TABLE project DROP COLUMN name; DROP TABLE ui_pref; ALTER TABLE block_content ADD COLUMN about TEXT; PRAGMA user_version = 1;");
  v1.close();
  const store = new Store(path);
  expect(store.schemaVersion()).toBe(4);
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
  v3.exec("ALTER TABLE block_content ADD COLUMN about TEXT; PRAGMA user_version = 3;");
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
  expect(store.schemaVersion()).toBe(4);
  expect(store.iterationBlocks(session, 1 as IterationN)).toEqual([{ id: "wheel/neon" as BlockId, hash }]);
  expect(store.iterationBlocks(session, 2 as IterationN)).toEqual([{ id: "wheel/neon" as BlockId, hash }]);
  expect(store.content(hash as ContentHash)).toEqual({ hash, files, compiled: "compiled", parts: [] });
  expect(store.hasContent("a".repeat(64) as ContentHash)).toBe(false);
  store.close();
  const columns = new DatabaseSync(path).prepare("SELECT name FROM pragma_table_info('block_content')").all().map((r) => r.name);
  expect(columns).not.toContain("about");
});
