import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Store } from "../src/core/store";
import type { ProjectId, RequestN, SessionId, ThreadId } from "../src/core/types";

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
  expect(reopened.schemaVersion()).toBe(2);
  expect(reopened.session(session)).toEqual({ id: session, projectId: "p1", title: "Wheel", brief: "", createdAt: at });
  expect(reopened.sessions(null).map((s) => s.projectName)).toEqual(["brainstorm"]);
  reopened.close();
});

test("a version 1 store gains a null name for the projects it already has", () => {
  const path = join(mkdtempSync(join(tmpdir(), "bs-store-")), "brainstorm.db");
  seeded(path).close();
  const v1 = new DatabaseSync(path);
  v1.exec("ALTER TABLE project DROP COLUMN name; PRAGMA user_version = 1;");
  v1.close();
  const store = new Store(path);
  expect(store.schemaVersion()).toBe(2);
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
