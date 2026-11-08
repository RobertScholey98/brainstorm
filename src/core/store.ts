import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  AppearanceValue,
  Attachment,
  BakedSetting,
  BlockFiles,
  BlockId,
  ContentHash,
  FeedbackEvent,
  FeedbackId,
  IterationN,
  Override,
  PartName,
  Pin,
  PromotionState,
  ProposedFiles,
  ProposedName,
  SavedTheme,
  SystemId,
  SystemReview,
  SystemVersionN,
  ProjectId,
  PropName,
  Request,
  RequestBody,
  RequestN,
  RequestState,
  SessionId,
  SessionListing,
  SessionSummary,
  SlotId,
  SlotManifest,
  ThreadId,
  VariantKey,
  Issue,
} from "./types";
import type { SystemManifest } from "./system/model";
import type { SystemSource } from "./system/source";
import { contentHash } from "./workingCopy";

/** A step is SQL, or code for a change SQL can't express, such as recomputing content hashes. */
type Migration = string | ((db: DatabaseSync) => void);

const MIGRATIONS: readonly Migration[] = [
  `
  CREATE TABLE project(id TEXT PRIMARY KEY, repo_path TEXT, created_at TEXT NOT NULL);
  CREATE TABLE session(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project, title TEXT NOT NULL,
    brief TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT);
  CREATE TABLE attachment(session_id TEXT NOT NULL REFERENCES session, thread_id TEXT NOT NULL,
    attached_at TEXT NOT NULL, detached_at TEXT, lost_at TEXT);
  CREATE UNIQUE INDEX one_open_attachment ON attachment(session_id) WHERE detached_at IS NULL;
  CREATE TABLE block_content(hash TEXT PRIMARY KEY, source TEXT NOT NULL, css TEXT, block_json TEXT NOT NULL,
    controls_json TEXT, controls_derived INTEGER NOT NULL, about TEXT, compiled TEXT NOT NULL, parts_json TEXT NOT NULL);
  CREATE TABLE iteration(session_id TEXT NOT NULL REFERENCES session, n INTEGER NOT NULL, thread_id TEXT NOT NULL,
    note TEXT, slots_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id, n));
  CREATE TABLE iteration_block(session_id TEXT NOT NULL, n INTEGER NOT NULL, block_id TEXT NOT NULL,
    hash TEXT NOT NULL REFERENCES block_content, PRIMARY KEY(session_id, n, block_id));
  CREATE TABLE slot_choice(session_id TEXT NOT NULL, slot TEXT NOT NULL, variant TEXT NOT NULL, PRIMARY KEY(session_id, slot));
  CREATE TABLE override(session_id TEXT NOT NULL, block_id TEXT NOT NULL, prop TEXT NOT NULL, value_json TEXT NOT NULL,
    set_at TEXT NOT NULL, PRIMARY KEY(session_id, block_id, prop));
  CREATE TABLE feedback(session_id TEXT NOT NULL, id INTEGER NOT NULL, block_id TEXT NOT NULL, part TEXT, text TEXT NOT NULL,
    created_in INTEGER NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT, PRIMARY KEY(session_id, id));
  CREATE TABLE feedback_event(session_id TEXT NOT NULL, feedback_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('address','confirm','reopen')), iteration INTEGER, at TEXT NOT NULL,
    PRIMARY KEY(session_id, feedback_id, seq));
  CREATE TABLE request(session_id TEXT NOT NULL, n INTEGER NOT NULL, body_json TEXT NOT NULL, feedback_ids_json TEXT NOT NULL,
    base INTEGER, thread_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('sending','sent','send_failed','fulfilled','withdrawn')),
    error TEXT, sent_at TEXT, fulfilled_in INTEGER, created_at TEXT NOT NULL, PRIMARY KEY(session_id, n));
  CREATE UNIQUE INDEX one_open_request ON request(session_id) WHERE state IN ('sending','sent','send_failed');
  `,
  `ALTER TABLE project ADD COLUMN name TEXT;`,
  `CREATE TABLE ui_pref(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);`,
  dropVariantNotes,
  `ALTER TABLE session ADD COLUMN settled_at TEXT; ALTER TABLE session ADD COLUMN unsettled_at TEXT;`,
  // Every block that exists already counts as seen, so nothing old lights up as new.
  `
  CREATE TABLE fork(session_id TEXT PRIMARY KEY REFERENCES session, parent_id TEXT NOT NULL REFERENCES session,
    parent_n INTEGER NOT NULL, baked_json TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY(parent_id, parent_n) REFERENCES iteration(session_id, n));
  CREATE INDEX fork_parent ON fork(parent_id);
  CREATE TABLE variant_seen(session_id TEXT NOT NULL REFERENCES session, block_id TEXT NOT NULL, PRIMARY KEY(session_id, block_id));
  INSERT INTO variant_seen(session_id, block_id) SELECT DISTINCT session_id, block_id FROM iteration_block;
  `,
  // Design systems (ADR 007). A version is immutable; a session holds one, and moves only by Rob's upgrade.
  `
  CREATE TABLE design_system(id TEXT PRIMARY KEY, name TEXT NOT NULL, source_json TEXT NOT NULL, project_id TEXT,
    created_at TEXT NOT NULL);
  CREATE TABLE design_system_version(system_id TEXT NOT NULL REFERENCES design_system, n INTEGER NOT NULL, hash TEXT NOT NULL,
    bundle TEXT NOT NULL, css TEXT NOT NULL, manifest_json TEXT NOT NULL, warnings_json TEXT NOT NULL, synced_at TEXT NOT NULL,
    PRIMARY KEY(system_id, n));
  CREATE TABLE design_system_theme(system_id TEXT NOT NULL REFERENCES design_system, name TEXT NOT NULL, axes_json TEXT NOT NULL,
    tokens_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(system_id, name));
  ALTER TABLE session ADD COLUMN system_id TEXT;
  ALTER TABLE session ADD COLUMN system_n INTEGER;
  CREATE TABLE session_theme(session_id TEXT NOT NULL REFERENCES session, key TEXT NOT NULL, value TEXT NOT NULL,
    set_at TEXT NOT NULL, PRIMARY KEY(session_id, key));
  CREATE TABLE proposed_content(hash TEXT PRIMARY KEY, source TEXT NOT NULL, css TEXT, json TEXT NOT NULL, compiled TEXT NOT NULL);
  CREATE TABLE iteration_proposed(session_id TEXT NOT NULL, n INTEGER NOT NULL, name TEXT NOT NULL,
    hash TEXT NOT NULL REFERENCES proposed_content, PRIMARY KEY(session_id, n, name));
  CREATE TABLE promotion(session_id TEXT NOT NULL REFERENCES session, name TEXT NOT NULL, state TEXT NOT NULL,
    thread_id TEXT, link TEXT, error TEXT, at TEXT NOT NULL, PRIMARY KEY(session_id, name));
  `,
  // Systems from app projects (ADR 008): what the last sync read, why it failed, and imports an agent is running.
  `
  ALTER TABLE design_system ADD COLUMN inputs_json TEXT;
  ALTER TABLE design_system ADD COLUMN sync_error_json TEXT;
  CREATE TABLE system_import(root TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, thread_id TEXT, link TEXT,
    error TEXT, at TEXT NOT NULL);
  `,
  // Rob reviews an imported system before brainstorms use it (ADR 008).
  `
  ALTER TABLE design_system ADD COLUMN review_json TEXT;
  `,
];

/**
 * Variant notes left the format. A note was part of its block's content hash, so each block that had one is stored
 * again under the hash of its files without it. Otherwise the next commit would see every such block as changed.
 */
function dropVariantNotes(db: DatabaseSync): void {
  const noted = db.prepare("SELECT * FROM block_content WHERE about IS NOT NULL").all() as Row[];
  for (const r of noted) {
    const hash = contentHash({
      tsx: str(r.source),
      json: str(r.block_json),
      css: strOrNull(r.css),
      controls: num(r.controls_derived) === 1 ? null : strOrNull(r.controls_json),
    });
    db.prepare(
      `INSERT OR IGNORE INTO block_content(hash, source, css, block_json, controls_json, controls_derived, about, compiled, parts_json)
       SELECT ?, source, css, block_json, controls_json, controls_derived, NULL, compiled, parts_json FROM block_content WHERE hash = ?`,
    ).run(hash, str(r.hash));
    db.prepare("UPDATE iteration_block SET hash = ? WHERE hash = ?").run(hash, str(r.hash));
    db.prepare("DELETE FROM block_content WHERE hash = ?").run(str(r.hash));
  }
  db.exec("ALTER TABLE block_content DROP COLUMN about");
}

const OPEN_REQUEST = `state IN ('sending','sent','send_failed')`;

type Row = Record<string, unknown>;

const str = (v: unknown): string => v as string;
const strOrNull = (v: unknown): string | null => (v === null ? null : (v as string));
const num = (v: unknown): number => Number(v);

export type StoredContent = {
  readonly hash: ContentHash;
  readonly files: BlockFiles;
  readonly compiled: string;
  readonly parts: readonly PartName[];
};

export type StoredIteration = {
  readonly n: IterationN;
  readonly threadId: ThreadId;
  readonly note: string | null;
  readonly slots: readonly SlotManifest[];
  readonly createdAt: string;
};

export type IterationBlock = { readonly id: BlockId; readonly hash: ContentHash };

export type IterationProposed = { readonly name: ProposedName; readonly hash: ContentHash };

export type StoredProposedContent = { readonly hash: ContentHash; readonly files: ProposedFiles; readonly compiled: string };

export type StoredSystem = {
  readonly id: SystemId;
  readonly name: string;
  readonly source: SystemSource;
  /** The T3 project its source belongs to, when Brainstorm knows it, so Promote can start a thread there. */
  readonly projectId: ProjectId | null;
  readonly createdAt: string;
  /** What the last sync read, so auto-sync can tell when the project changed (ADR 008). Null before the first. */
  readonly inputs: SystemInputs | null;
  /** Why the last sync failed, or null when it succeeded. */
  readonly syncError: SyncError | null;
  /** Rob's review of the import; null for a system added before reviews existed. */
  readonly review: SystemReview | null;
};

export type { SystemInputs } from "./system/inputs";
import type { SystemInputs } from "./system/inputs";
export type SyncError = { readonly message: string; readonly issues: readonly Issue[]; readonly at: string };
export type StoredImport = { readonly root: string; readonly projectId: ProjectId; readonly at: string } & PromotionState;

export type StoredSystemVersion = {
  readonly system: SystemId;
  readonly n: SystemVersionN;
  readonly hash: string;
  readonly manifest: SystemManifest;
  readonly warnings: readonly Issue[];
  readonly syncedAt: string;
};

/** A session's design system version, or null for a freeform session. */
export type SessionSystem = { readonly id: SystemId; readonly n: SystemVersionN };

export type StoredPromotion = PromotionState & { readonly name: ProposedName; readonly at: string };

/** A feedback row with its event log; the service folds the status. */
export type FeedbackRecord = {
  readonly id: FeedbackId;
  readonly pin: Pin;
  readonly text: string;
  readonly createdIn: IterationN;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly history: readonly FeedbackEvent[];
};


const toSession = (r: Row): SessionSummary => ({
  id: str(r.id) as SessionId,
  projectId: str(r.project_id) as ProjectId,
  title: str(r.title),
  brief: str(r.brief),
  createdAt: str(r.created_at),
});

/** A fork's link to its parent. `baked` names the settings that became its defaults, for the agent. */
export type StoredFork = {
  readonly parent: SessionId;
  readonly from: IterationN;
  readonly baked: readonly BakedSetting[];
  readonly createdAt: string;
};

/** Everything a fork is made of, written in one transaction before its thread starts. */
export type NewFork = {
  readonly session: SessionSummary;
  readonly fork: StoredFork;
  readonly iteration: StoredIteration;
  readonly blocks: readonly IterationBlock[];
  readonly contents: readonly StoredContent[];
  readonly proposed: readonly IterationProposed[];
  readonly feedback: readonly { readonly pin: Pin; readonly text: string }[];
  readonly request: { readonly body: RequestBody; readonly at: string };
  /** The parent's design system version and theme, which the fork keeps. */
  readonly system: SessionSystem | null;
  readonly theme: readonly { readonly key: string; readonly value: string }[];
};

/**
 * A listing as the store holds it; the service reads an open request's phase from the thread and folds the settle.
 * `woken` is whether anything that brings a settled brainstorm back has happened since `settledAt`.
 */
export type StoredListing = Omit<SessionListing, "request" | "settlement"> & {
  readonly openRequest: boolean;
  readonly settledAt: string | null;
  readonly unsettledAt: string | null;
  readonly woken: boolean;
};

const toListing = (r: Row): StoredListing => {
  const createdAt = str(r.created_at);
  return {
    ...toSession(r),
    projectName: strOrNull(r.project_name),
    attachedThread: str(r.thread_id) as ThreadId,
    lost: r.lost_at !== null,
    latest: r.latest_n === null ? null : (num(r.latest_n) as IterationN),
    activeAt: [strOrNull(r.latest_at), strOrNull(r.request_at)].reduce<string>((max, t) => (t !== null && t > max ? t : max), createdAt),
    openRequest: num(r.open_request) === 1,
    settledAt: strOrNull(r.settled_at),
    unsettledAt: strOrNull(r.unsettled_at),
    woken: num(r.woken) === 1,
    fork: r.fork_from === null ? null : { parentTitle: str(r.fork_parent_title), from: num(r.fork_from) as IterationN },
  };
};

const toAttachment = (r: Row): Attachment => ({
  session: str(r.session_id) as SessionId,
  threadId: str(r.thread_id) as ThreadId,
  attachedAt: str(r.attached_at),
  lostAt: strOrNull(r.lost_at),
});

const toIteration = (r: Row): StoredIteration => ({
  n: num(r.n) as IterationN,
  threadId: str(r.thread_id) as ThreadId,
  note: strOrNull(r.note),
  slots: JSON.parse(str(r.slots_json)) as SlotManifest[],
  createdAt: str(r.created_at),
});

const toRequestState = (r: Row): RequestState => {
  const state = str(r.state) as RequestState["state"];
  switch (state) {
    case "send_failed":
      return { state, error: str(r.error) };
    case "fulfilled":
      return { state, iteration: num(r.fulfilled_in) as IterationN };
    case "sending":
    case "sent":
    case "withdrawn":
      return { state };
  }
};

const toRequest = (r: Row): Request => ({
  ...(JSON.parse(str(r.body_json)) as RequestBody),
  session: str(r.session_id) as SessionId,
  n: num(r.n) as RequestN,
  feedbackIds: JSON.parse(str(r.feedback_ids_json)) as FeedbackId[],
  base: r.base === null ? null : (num(r.base) as IterationN),
  threadId: str(r.thread_id) as ThreadId,
  state: toRequestState(r),
  sentAt: strOrNull(r.sent_at),
  createdAt: str(r.created_at),
});

const toEvent = (r: Row): FeedbackEvent => {
  const kind = str(r.kind) as FeedbackEvent["kind"];
  const at = str(r.at);
  return kind === "address" ? { kind, iteration: num(r.iteration) as IterationN, at } : { kind, at };
};

const toSystem = (r: Row): StoredSystem => ({
  id: str(r.id) as SystemId,
  name: str(r.name),
  source: JSON.parse(str(r.source_json)) as SystemSource,
  projectId: r.project_id === null ? null : (str(r.project_id) as ProjectId),
  createdAt: str(r.created_at),
  inputs: r.inputs_json == null ? null : (JSON.parse(str(r.inputs_json)) as SystemInputs),
  syncError: r.sync_error_json == null ? null : (JSON.parse(str(r.sync_error_json)) as SyncError),
  review: r.review_json == null ? null : (JSON.parse(str(r.review_json)) as SystemReview),
});

const toSystemVersion = (r: Row): StoredSystemVersion => ({
  system: str(r.system_id) as SystemId,
  n: num(r.n) as SystemVersionN,
  hash: str(r.hash),
  manifest: JSON.parse(str(r.manifest_json)) as SystemManifest,
  warnings: JSON.parse(str(r.warnings_json)) as Issue[],
  syncedAt: str(r.synced_at),
});

/** SQL only. Private to the Brainstorm service, which owns every rule about what may be written. */
export class Store {
  readonly #db: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();
  #depth = 0;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.#migrate();
  }

  close(): void {
    this.#db.close();
  }

  /** Runs `fn` in one IMMEDIATE transaction. Nested calls join the outer one. */
  tx<T>(fn: () => T): T {
    if (this.#depth > 0) return fn();
    this.#db.exec("BEGIN IMMEDIATE");
    this.#depth += 1;
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    } finally {
      this.#depth -= 1;
    }
  }

  #migrate(): void {
    const version = num((this.#get("PRAGMA user_version") ?? {}).user_version ?? 0);
    MIGRATIONS.slice(version).forEach((step, i) =>
      this.tx(() => {
        if (typeof step === "string") this.#db.exec(step);
        else step(this.#db);
        this.#db.exec(`PRAGMA user_version = ${version + i + 1}`);
      }),
    );
  }

  /** The SQL texts are a small fixed set, so each is prepared once and reused. */
  #statement(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  #get(sql: string, ...params: (string | number | null)[]): Row | undefined {
    return this.#statement(sql).get(...params) as Row | undefined;
  }

  #all(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.#statement(sql).all(...params) as Row[];
  }

  #run(sql: string, ...params: (string | number | null)[]): void {
    this.#statement(sql).run(...params);
  }

  uiPrefRows(): { key: string; json: string }[] {
    return this.#all("SELECT key, value_json FROM ui_pref ORDER BY key").map((r) => ({ key: str(r.key), json: str(r.value_json) }));
  }

  setUiPrefs(rows: readonly [key: string, value: unknown][]): void {
    this.tx(() => {
      for (const [key, value] of rows) {
        this.#run("INSERT INTO ui_pref(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json", key, JSON.stringify(value));
      }
    });
  }

  schemaVersion(): number {
    return num(this.#get("PRAGMA user_version")?.user_version);
  }

  ensureProject(id: ProjectId, repoPath: string | null, at: string): void {
    this.#run("INSERT OR IGNORE INTO project(id, repo_path, created_at) VALUES (?, ?, ?)", id, repoPath, at);
  }

  nameProject(id: ProjectId, name: string): void {
    this.#run("UPDATE project SET name = ? WHERE id = ?", name, id);
  }

  createSession(session: SessionSummary, thread: ThreadId, system: SessionSystem | null = null): void {
    this.tx(() => {
      this.#run(
        "INSERT INTO session(id, project_id, title, brief, created_at, system_id, system_n) VALUES (?, ?, ?, ?, ?, ?, ?)",
        session.id,
        session.projectId,
        session.title,
        session.brief,
        session.createdAt,
        system?.id ?? null,
        system?.n ?? null,
      );
      this.#run("INSERT INTO attachment(session_id, thread_id, attached_at) VALUES (?, ?, ?)", session.id, thread, session.createdAt);
    });
  }

  session(id: SessionId): SessionSummary | null {
    const row = this.#get("SELECT * FROM session WHERE id = ? AND archived_at IS NULL", id);
    return row === undefined ? null : toSession(row);
  }

  /** `project: null` lists every project's sessions. */
  sessions(project: ProjectId | null): StoredListing[] {
    return this.#all(
      `SELECT s.id, s.project_id, p.name AS project_name, s.title, s.brief, s.created_at, a.thread_id, a.lost_at,
        (SELECT MAX(n) FROM iteration WHERE session_id = s.id) AS latest_n,
        (SELECT MAX(created_at) FROM iteration WHERE session_id = s.id) AS latest_at,
        (SELECT MAX(created_at) FROM request WHERE session_id = s.id) AS request_at,
        EXISTS (SELECT 1 FROM request WHERE session_id = s.id AND ${OPEN_REQUEST}) AS open_request,
        s.settled_at, s.unsettled_at,
        s.settled_at IS NOT NULL AND (
          EXISTS (SELECT 1 FROM request WHERE session_id = s.id AND created_at > s.settled_at)
          OR EXISTS (
            SELECT 1 FROM iteration i WHERE i.session_id = s.id AND i.created_at > s.settled_at
              AND NOT EXISTS (SELECT 1 FROM request r WHERE r.session_id = s.id AND r.fulfilled_in = i.n AND r.created_at <= s.settled_at)
          )
        ) AS woken,
        f.parent_n AS fork_from, (SELECT title FROM session WHERE id = f.parent_id) AS fork_parent_title
      FROM session s JOIN project p ON p.id = s.project_id JOIN attachment a ON a.session_id = s.id AND a.detached_at IS NULL
        LEFT JOIN fork f ON f.session_id = s.id
      WHERE s.archived_at IS NULL AND (? IS NULL OR s.project_id = ?)
      ORDER BY s.created_at, s.id`,
      project,
      project,
    ).map(toListing);
  }

  /** The fork, its iteration 1 with carried feedback, then request 1, so the iteration can't fulfil the request. */
  createFork(input: NewFork, thread: ThreadId): void {
    const { session, fork, iteration } = input;
    this.tx(() => {
      this.createSession(session, thread, input.system);
      for (const t of input.theme) this.setSessionTheme(session.id, t.key, t.value, fork.createdAt);
      this.#run(
        "INSERT INTO fork(session_id, parent_id, parent_n, baked_json, created_at) VALUES (?, ?, ?, ?, ?)",
        session.id,
        fork.parent,
        fork.from,
        JSON.stringify(fork.baked),
        fork.createdAt,
      );
      this.insertIteration({
        session: session.id,
        iteration,
        blocks: input.blocks,
        contents: input.contents,
        proposed: input.proposed,
        proposedContents: [],
        addresses: [],
      });
      const ids = input.feedback.map((f) => this.insertFeedback(session.id, { pin: f.pin, text: f.text, createdIn: iteration.n, at: fork.createdAt }));
      this.insertRequest(session.id, { body: input.request.body, feedbackIds: ids, base: iteration.n, threadId: thread, at: input.request.at });
    });
  }

  fork(session: SessionId): StoredFork | null {
    const r = this.#get("SELECT * FROM fork WHERE session_id = ?", session);
    if (r === undefined) return null;
    return {
      parent: str(r.parent_id) as SessionId,
      from: num(r.parent_n) as IterationN,
      baked: JSON.parse(str(r.baked_json)) as BakedSetting[],
      createdAt: str(r.created_at),
    };
  }

  /** Forks made from `parent` that still exist, oldest first. */
  forksOf(parent: SessionId): { id: SessionId; title: string; from: IterationN }[] {
    return this.#all(
      `SELECT s.id, s.title, f.parent_n FROM fork f JOIN session s ON s.id = f.session_id
       WHERE f.parent_id = ? AND s.archived_at IS NULL ORDER BY f.created_at, s.id`,
      parent,
    ).map((r) => ({ id: str(r.id) as SessionId, title: str(r.title), from: num(r.parent_n) as IterationN }));
  }

  /** A session's title and whether it is gone, read even once archived, so a fork can still name its parent. */
  sessionName(id: SessionId): { title: string; gone: boolean } | null {
    const r = this.#get("SELECT title, archived_at FROM session WHERE id = ?", id);
    return r === undefined ? null : { title: str(r.title), gone: r.archived_at !== null };
  }

  archive(session: SessionId, at: string): void {
    this.#run("UPDATE session SET archived_at = ? WHERE id = ?", at, session);
  }

  /** Each block id's first iteration, for whether it is new. */
  introducedIn(session: SessionId): Map<BlockId, IterationN> {
    return new Map(
      this.#all("SELECT block_id, MIN(n) AS n FROM iteration_block WHERE session_id = ? GROUP BY block_id", session).map((r) => [
        str(r.block_id) as BlockId,
        num(r.n) as IterationN,
      ]),
    );
  }

  seen(session: SessionId): Set<BlockId> {
    return new Set(this.#all("SELECT block_id FROM variant_seen WHERE session_id = ?", session).map((r) => str(r.block_id) as BlockId));
  }

  markSeen(session: SessionId, blocks: readonly BlockId[]): void {
    this.tx(() => {
      for (const b of blocks) this.#run("INSERT OR IGNORE INTO variant_seen(session_id, block_id) VALUES (?, ?)", session, b);
    });
  }

  /** Every iteration's metadata, oldest first. */
  iterations(session: SessionId): StoredIteration[] {
    return this.#all("SELECT * FROM iteration WHERE session_id = ? ORDER BY n", session).map(toIteration);
  }

  requests(session: SessionId): Request[] {
    return this.#all("SELECT * FROM request WHERE session_id = ? ORDER BY n", session).map(toRequest);
  }

  settle(session: SessionId, at: string): void {
    this.#run("UPDATE session SET settled_at = ? WHERE id = ?", at, session);
  }

  unsettle(session: SessionId, at: string): void {
    this.#run("UPDATE session SET settled_at = NULL, unsettled_at = ? WHERE id = ?", at, session);
  }

  attachment(session: SessionId): Attachment {
    const row = this.#get("SELECT * FROM attachment WHERE session_id = ? AND detached_at IS NULL", session);
    if (row === undefined) throw new Error(`session ${session} has no open attachment`);
    return toAttachment(row);
  }

  reattach(session: SessionId, thread: ThreadId, at: string): void {
    this.tx(() => {
      this.#run("UPDATE attachment SET detached_at = ? WHERE session_id = ? AND detached_at IS NULL", at, session);
      this.#run("INSERT INTO attachment(session_id, thread_id, attached_at) VALUES (?, ?, ?)", session, thread, at);
    });
  }

  setLost(session: SessionId, lostAt: string | null): void {
    this.#run("UPDATE attachment SET lost_at = ? WHERE session_id = ? AND detached_at IS NULL", lostAt, session);
  }

  latestIteration(session: SessionId): StoredIteration | null {
    const row = this.#get("SELECT * FROM iteration WHERE session_id = ? ORDER BY n DESC LIMIT 1", session);
    return row === undefined ? null : toIteration(row);
  }

  iteration(session: SessionId, n: IterationN): StoredIteration | null {
    const row = this.#get("SELECT * FROM iteration WHERE session_id = ? AND n = ?", session, n);
    return row === undefined ? null : toIteration(row);
  }

  iterationBlocks(session: SessionId, n: IterationN): IterationBlock[] {
    return this.#all("SELECT block_id, hash FROM iteration_block WHERE session_id = ? AND n = ? ORDER BY block_id", session, n).map(
      (r) => ({ id: str(r.block_id) as BlockId, hash: str(r.hash) as ContentHash }),
    );
  }

  hasContent(hash: ContentHash): boolean {
    return this.#get("SELECT 1 AS found FROM block_content WHERE hash = ?", hash) !== undefined;
  }

  content(hash: ContentHash): StoredContent {
    const r = this.#get("SELECT * FROM block_content WHERE hash = ?", hash);
    if (r === undefined) throw new Error(`no block content ${hash}`);
    return {
      hash,
      files: {
        tsx: str(r.source),
        json: str(r.block_json),
        css: strOrNull(r.css),
        controls: num(r.controls_derived) === 1 ? null : strOrNull(r.controls_json),
      },
      compiled: str(r.compiled),
      parts: JSON.parse(str(r.parts_json)) as PartName[],
    };
  }

  insertIteration(input: {
    session: SessionId;
    iteration: StoredIteration;
    blocks: readonly IterationBlock[];
    contents: readonly StoredContent[];
    proposed: readonly IterationProposed[];
    proposedContents: readonly StoredProposedContent[];
    addresses: readonly FeedbackId[];
  }): void {
    const { session, iteration } = input;
    this.tx(() => {
      for (const c of input.proposedContents) {
        this.#run(
          "INSERT OR IGNORE INTO proposed_content(hash, source, css, json, compiled) VALUES (?, ?, ?, ?, ?)",
          c.hash,
          c.files.tsx,
          c.files.css,
          c.files.json,
          c.compiled,
        );
      }
      for (const c of input.contents) {
        this.#run(
          `INSERT OR IGNORE INTO block_content(hash, source, css, block_json, controls_json, controls_derived, compiled, parts_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          c.hash,
          c.files.tsx,
          c.files.css,
          c.files.json,
          c.files.controls,
          c.files.controls === null ? 1 : 0,
          c.compiled,
          JSON.stringify(c.parts),
        );
      }
      this.#run(
        "INSERT INTO iteration(session_id, n, thread_id, note, slots_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        session,
        iteration.n,
        iteration.threadId,
        iteration.note,
        JSON.stringify(iteration.slots),
        iteration.createdAt,
      );
      for (const b of input.blocks) {
        this.#run("INSERT INTO iteration_block(session_id, n, block_id, hash) VALUES (?, ?, ?, ?)", session, iteration.n, b.id, b.hash);
      }
      for (const p of input.proposed) {
        this.#run("INSERT INTO iteration_proposed(session_id, n, name, hash) VALUES (?, ?, ?, ?)", session, iteration.n, p.name, p.hash);
      }
      for (const id of input.addresses) {
        this.appendFeedbackEvent(session, id, { kind: "address", iteration: iteration.n, at: iteration.createdAt });
      }
      this.#run(
        `UPDATE request SET state = 'fulfilled', fulfilled_in = ?, error = NULL WHERE session_id = ? AND ${OPEN_REQUEST}`,
        iteration.n,
        session,
      );
    });
  }

  overrides(session: SessionId): Override[] {
    return this.#all("SELECT * FROM override WHERE session_id = ? ORDER BY block_id, prop", session).map((r) => ({
      blockId: str(r.block_id) as BlockId,
      prop: str(r.prop) as PropName,
      value: JSON.parse(str(r.value_json)) as AppearanceValue,
      setAt: str(r.set_at),
    }));
  }

  setOverride(session: SessionId, override: Override): void {
    this.#run(
      `INSERT INTO override(session_id, block_id, prop, value_json, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, block_id, prop) DO UPDATE SET value_json = excluded.value_json, set_at = excluded.set_at`,
      session,
      override.blockId,
      override.prop,
      JSON.stringify(override.value),
      override.setAt,
    );
  }

  deleteOverride(session: SessionId, blockId: BlockId, prop: PropName): void {
    this.#run("DELETE FROM override WHERE session_id = ? AND block_id = ? AND prop = ?", session, blockId, prop);
  }

  slotChoices(session: SessionId): Map<SlotId, VariantKey> {
    return new Map(
      this.#all("SELECT slot, variant FROM slot_choice WHERE session_id = ?", session).map((r) => [
        str(r.slot) as SlotId,
        str(r.variant) as VariantKey,
      ]),
    );
  }

  setSlotChoice(session: SessionId, slot: SlotId, variant: VariantKey): void {
    this.#run(
      `INSERT INTO slot_choice(session_id, slot, variant) VALUES (?, ?, ?)
       ON CONFLICT(session_id, slot) DO UPDATE SET variant = excluded.variant`,
      session,
      slot,
      variant,
    );
  }

  /** Includes deleted rows, so callers can tell deleted from unknown. */
  feedback(session: SessionId): FeedbackRecord[] {
    const events = new Map<number, FeedbackEvent[]>();
    for (const r of this.#all("SELECT * FROM feedback_event WHERE session_id = ? ORDER BY feedback_id, seq", session)) {
      const id = num(r.feedback_id);
      events.set(id, [...(events.get(id) ?? []), toEvent(r)]);
    }
    return this.#all("SELECT * FROM feedback WHERE session_id = ? ORDER BY id", session).map((r) => ({
      id: num(r.id) as FeedbackId,
      pin: { blockId: str(r.block_id) as BlockId, part: strOrNull(r.part) as PartName | null },
      text: str(r.text),
      createdIn: num(r.created_in) as IterationN,
      createdAt: str(r.created_at),
      deletedAt: strOrNull(r.deleted_at),
      history: events.get(num(r.id)) ?? [],
    }));
  }

  insertFeedback(session: SessionId, input: { pin: Pin; text: string; createdIn: IterationN; at: string }): FeedbackId {
    return this.tx(() => {
      const next = num(this.#get("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM feedback WHERE session_id = ?", session)?.next);
      this.#run(
        "INSERT INTO feedback(session_id, id, block_id, part, text, created_in, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        session,
        next,
        input.pin.blockId,
        input.pin.part,
        input.text,
        input.createdIn,
        input.at,
      );
      return next as FeedbackId;
    });
  }

  editFeedback(session: SessionId, id: FeedbackId, text: string): void {
    this.#run("UPDATE feedback SET text = ? WHERE session_id = ? AND id = ?", text, session, id);
  }

  deleteFeedback(session: SessionId, id: FeedbackId, at: string): void {
    this.#run("UPDATE feedback SET deleted_at = ? WHERE session_id = ? AND id = ?", at, session, id);
  }

  appendFeedbackEvent(session: SessionId, id: FeedbackId, event: FeedbackEvent): void {
    this.tx(() => {
      const seq = num(
        this.#get("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM feedback_event WHERE session_id = ? AND feedback_id = ?", session, id)?.seq,
      );
      this.#run(
        "INSERT INTO feedback_event(session_id, feedback_id, seq, kind, iteration, at) VALUES (?, ?, ?, ?, ?, ?)",
        session,
        id,
        seq,
        event.kind,
        event.kind === "address" ? event.iteration : null,
        event.at,
      );
    });
  }

  openRequest(session: SessionId): Request | null {
    const row = this.#get(`SELECT * FROM request WHERE session_id = ? AND ${OPEN_REQUEST}`, session);
    return row === undefined ? null : toRequest(row);
  }

  latestRequest(session: SessionId): Request | null {
    const row = this.#get("SELECT * FROM request WHERE session_id = ? ORDER BY n DESC LIMIT 1", session);
    return row === undefined ? null : toRequest(row);
  }

  requestsIn(states: readonly RequestState["state"][]): Request[] {
    const marks = states.map(() => "?").join(", ");
    return this.#all(`SELECT * FROM request WHERE state IN (${marks}) ORDER BY session_id, n`, ...states).map(toRequest);
  }

  /** Inserts the next request in state `sending`. The one_open_request index refuses a second open one. */
  insertRequest(
    session: SessionId,
    input: { body: RequestBody; feedbackIds: readonly FeedbackId[]; base: IterationN | null; threadId: ThreadId; at: string },
  ): RequestN {
    return this.tx(() => {
      const next = num(this.#get("SELECT COALESCE(MAX(n), 0) + 1 AS next FROM request WHERE session_id = ?", session)?.next);
      this.#run(
        `INSERT INTO request(session_id, n, body_json, feedback_ids_json, base, thread_id, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'sending', ?)`,
        session,
        next,
        JSON.stringify({ scope: input.body.scope, freetext: input.body.freetext }),
        JSON.stringify(input.feedbackIds),
        input.base,
        input.threadId,
        input.at,
      );
      return next as RequestN;
    });
  }

  setRequestState(
    session: SessionId,
    n: RequestN,
    state: Exclude<RequestState, { state: "fulfilled" }>,
    extra: { threadId?: ThreadId; sentAt?: string } = {},
  ): void {
    this.#run(
      `UPDATE request SET state = ?, error = ?, thread_id = COALESCE(?, thread_id), sent_at = COALESCE(?, sent_at)
       WHERE session_id = ? AND n = ?`,
      state.state,
      state.state === "send_failed" ? state.error : null,
      extra.threadId ?? null,
      extra.sentAt ?? null,
      session,
      n,
    );
  }

  // --- Design systems (ADR 007) ---------------------------------------------------------------------------------------

  iterationProposed(session: SessionId, n: IterationN): IterationProposed[] {
    return this.#all("SELECT name, hash FROM iteration_proposed WHERE session_id = ? AND n = ? ORDER BY name", session, n).map((r) => ({
      name: str(r.name) as ProposedName,
      hash: str(r.hash) as ContentHash,
    }));
  }

  proposedContent(hash: ContentHash): StoredProposedContent {
    const r = this.#get("SELECT * FROM proposed_content WHERE hash = ?", hash);
    if (r === undefined) throw new Error(`no proposed content ${hash}`);
    return { hash, files: { tsx: str(r.source), json: str(r.json), css: strOrNull(r.css) }, compiled: str(r.compiled) };
  }

  insertSystem(system: StoredSystem): void {
    this.#run(
      "INSERT INTO design_system(id, name, source_json, project_id, created_at) VALUES (?, ?, ?, ?, ?)",
      system.id,
      system.name,
      JSON.stringify(system.source),
      system.projectId,
      system.createdAt,
    );
  }

  updateSystem(id: SystemId, change: { source: SystemSource; name: string; projectId: ProjectId | null }): void {
    this.#run("UPDATE design_system SET source_json = ?, name = ?, project_id = COALESCE(?, project_id) WHERE id = ?", JSON.stringify(change.source), change.name, change.projectId, id);
  }

  setSystemInputs(id: SystemId, inputs: SystemInputs): void {
    this.#run("UPDATE design_system SET inputs_json = ? WHERE id = ?", JSON.stringify(inputs), id);
  }

  setReview(id: SystemId, review: SystemReview | null): void {
    this.#run("UPDATE design_system SET review_json = ? WHERE id = ?", review === null ? null : JSON.stringify(review), id);
  }

  setSyncError(id: SystemId, error: SyncError | null): void {
    this.#run("UPDATE design_system SET sync_error_json = ? WHERE id = ?", error === null ? null : JSON.stringify(error), id);
  }

  imports(): StoredImport[] {
    return this.#all("SELECT * FROM system_import ORDER BY at").map((r) => {
      const base = { root: str(r.root), projectId: str(r.project_id) as ProjectId, at: str(r.at) };
      const state = str(r.state);
      return state === "started"
        ? { ...base, state, thread: str(r.thread_id) as ThreadId, link: r.link === null ? null : str(r.link) }
        : state === "failed"
          ? { ...base, state, error: str(r.error) }
          : { ...base, state: "starting" as const };
    });
  }

  setImport(root: string, projectId: ProjectId, state: PromotionState, at: string): void {
    this.#run(
      `INSERT INTO system_import(root, project_id, state, thread_id, link, error, at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(root) DO UPDATE SET project_id = excluded.project_id, state = excluded.state, thread_id = excluded.thread_id, link = excluded.link, error = excluded.error, at = excluded.at`,
      root,
      projectId,
      state.state,
      state.state === "started" ? state.thread : null,
      state.state === "started" ? state.link : null,
      state.state === "failed" ? state.error : null,
      at,
    );
  }

  deleteImport(root: string): void {
    this.#run("DELETE FROM system_import WHERE root = ?", root);
  }

  systems(): StoredSystem[] {
    return this.#all("SELECT * FROM design_system ORDER BY created_at, id").map(toSystem);
  }

  system(id: SystemId): StoredSystem | null {
    const r = this.#get("SELECT * FROM design_system WHERE id = ?", id);
    return r === undefined ? null : toSystem(r);
  }

  latestSystemVersion(id: SystemId): StoredSystemVersion | null {
    const r = this.#get("SELECT system_id, n, hash, manifest_json, warnings_json, synced_at FROM design_system_version WHERE system_id = ? ORDER BY n DESC LIMIT 1", id);
    return r === undefined ? null : toSystemVersion(r);
  }

  systemVersion(id: SystemId, n: SystemVersionN): StoredSystemVersion | null {
    const r = this.#get("SELECT system_id, n, hash, manifest_json, warnings_json, synced_at FROM design_system_version WHERE system_id = ? AND n = ?", id, n);
    return r === undefined ? null : toSystemVersion(r);
  }

  /** Every version, newest first, without the bundle, CSS or manifest. */
  systemVersions(id: SystemId): { n: SystemVersionN; hash: string; syncedAt: string; manifest: SystemManifest }[] {
    return this.#all("SELECT n, hash, synced_at, manifest_json FROM design_system_version WHERE system_id = ? ORDER BY n DESC", id).map((r) => ({
      n: num(r.n) as SystemVersionN,
      hash: str(r.hash),
      syncedAt: str(r.synced_at),
      manifest: JSON.parse(str(r.manifest_json)) as SystemManifest,
    }));
  }

  kitFiles(id: SystemId, n: SystemVersionN): { bundle: string; css: string } | null {
    const r = this.#get("SELECT bundle, css FROM design_system_version WHERE system_id = ? AND n = ?", id, n);
    return r === undefined ? null : { bundle: str(r.bundle), css: str(r.css) };
  }

  insertSystemVersion(v: StoredSystemVersion & { bundle: string; css: string }): void {
    this.#run(
      `INSERT INTO design_system_version(system_id, n, hash, bundle, css, manifest_json, warnings_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      v.system,
      v.n,
      v.hash,
      v.bundle,
      v.css,
      JSON.stringify(v.manifest),
      JSON.stringify(v.warnings),
      v.syncedAt,
    );
  }

  sessionsUsing(id: SystemId): number {
    return num(this.#get("SELECT COUNT(*) AS c FROM session WHERE system_id = ? AND archived_at IS NULL", id)?.c);
  }

  /** The active brainstorms on each of a system's versions, by version. */
  sessionsByVersion(id: SystemId): Map<number, { id: SessionId; title: string }[]> {
    const out = new Map<number, { id: SessionId; title: string }[]>();
    for (const r of this.#all("SELECT id, title, system_n FROM session WHERE system_id = ? AND archived_at IS NULL ORDER BY created_at", id)) {
      const n = num(r.system_n);
      out.set(n, [...(out.get(n) ?? []), { id: str(r.id) as SessionId, title: str(r.title) }]);
    }
    return out;
  }

  sessionsOn(id: SystemId): SessionId[] {
    return this.#all("SELECT id FROM session WHERE system_id = ? AND archived_at IS NULL", id).map((r) => str(r.id) as SessionId);
  }

  sessionSystem(session: SessionId): SessionSystem | null {
    const r = this.#get("SELECT system_id, system_n FROM session WHERE id = ?", session);
    return r === undefined || r.system_id === null ? null : { id: str(r.system_id) as SystemId, n: num(r.system_n) as SystemVersionN };
  }

  setSessionSystemVersion(session: SessionId, n: SystemVersionN): void {
    this.#run("UPDATE session SET system_n = ? WHERE id = ?", n, session);
  }

  themes(system: SystemId): SavedTheme[] {
    return this.#all("SELECT * FROM design_system_theme WHERE system_id = ? ORDER BY created_at, name", system).map((r) => ({
      name: str(r.name),
      axes: JSON.parse(str(r.axes_json)) as Record<string, string>,
      tokens: JSON.parse(str(r.tokens_json)) as Record<string, string>,
      createdAt: str(r.created_at),
    }));
  }

  saveTheme(system: SystemId, theme: SavedTheme): void {
    this.#run(
      `INSERT INTO design_system_theme(system_id, name, axes_json, tokens_json, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(system_id, name) DO UPDATE SET axes_json = excluded.axes_json, tokens_json = excluded.tokens_json, created_at = excluded.created_at`,
      system,
      theme.name,
      JSON.stringify(theme.axes),
      JSON.stringify(theme.tokens),
      theme.createdAt,
    );
  }

  /** Keys are `axis:<attribute>` and `token:<name>`. */
  sessionTheme(session: SessionId): { key: string; value: string }[] {
    return this.#all("SELECT key, value FROM session_theme WHERE session_id = ? ORDER BY key", session).map((r) => ({ key: str(r.key), value: str(r.value) }));
  }

  setSessionTheme(session: SessionId, key: string, value: string | null, at: string): void {
    if (value === null) this.#run("DELETE FROM session_theme WHERE session_id = ? AND key = ?", session, key);
    else {
      this.#run(
        "INSERT INTO session_theme(session_id, key, value, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value, set_at = excluded.set_at",
        session,
        key,
        value,
        at,
      );
    }
  }

  clearSessionTheme(session: SessionId): void {
    this.#run("DELETE FROM session_theme WHERE session_id = ?", session);
  }

  promotions(session: SessionId): StoredPromotion[] {
    return this.#all("SELECT * FROM promotion WHERE session_id = ? ORDER BY name", session).map((r) => {
      const base = { name: str(r.name) as ProposedName, at: str(r.at) };
      const state = str(r.state);
      return state === "started"
        ? { ...base, state, thread: str(r.thread_id) as ThreadId, link: r.link === null ? null : str(r.link) }
        : state === "failed"
          ? { ...base, state, error: str(r.error) }
          : { ...base, state: "starting" as const };
    });
  }

  setPromotion(session: SessionId, name: ProposedName, state: PromotionState, at: string): void {
    this.#run(
      `INSERT INTO promotion(session_id, name, state, thread_id, link, error, at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, name) DO UPDATE SET state = excluded.state, thread_id = excluded.thread_id, link = excluded.link, error = excluded.error, at = excluded.at`,
      session,
      name,
      state.state,
      state.state === "started" ? state.thread : null,
      state.state === "started" ? state.link : null,
      state.state === "failed" ? state.error : null,
      at,
    );
  }

  /** Projects whose stored repo path holds `path`, longest first, to find the T3 project a library lives in. */
  projectsHolding(path: string): ProjectId[] {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const target = norm(path);
    return this.#all("SELECT id, repo_path FROM project WHERE repo_path IS NOT NULL")
      .filter((r) => {
        const root = norm(str(r.repo_path));
        return target === root || target.startsWith(`${root}/`);
      })
      .sort((a, b) => str(b.repo_path).length - str(a.repo_path).length)
      .map((r) => str(r.id) as ProjectId);
  }
}
