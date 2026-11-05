import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  AppearanceValue,
  Attachment,
  BlockFiles,
  BlockId,
  ContentHash,
  FeedbackEvent,
  FeedbackId,
  IterationN,
  Override,
  PartName,
  Pin,
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
} from "./types";

const MIGRATIONS: readonly string[] = [
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
];

const OPEN_REQUEST = `state IN ('sending','sent','send_failed')`;

type Row = Record<string, unknown>;

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

const str = (v: unknown): string => v as string;
const strOrNull = (v: unknown): string | null => (v === null ? null : (v as string));
const num = (v: unknown): number => Number(v);

const toSession = (r: Row): SessionSummary => ({
  id: str(r.id) as SessionId,
  projectId: str(r.project_id) as ProjectId,
  title: str(r.title),
  brief: str(r.brief),
  createdAt: str(r.created_at),
});

const toListing = (r: Row): SessionListing => {
  const createdAt = str(r.created_at);
  return {
    ...toSession(r),
    projectName: strOrNull(r.project_name),
    attachedThread: str(r.thread_id) as ThreadId,
    lost: r.lost_at !== null,
    latest: r.latest_n === null ? null : (num(r.latest_n) as IterationN),
    activeAt: [strOrNull(r.latest_at), strOrNull(r.request_at)].reduce<string>((max, t) => (t !== null && t > max ? t : max), createdAt),
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
    MIGRATIONS.slice(version).forEach((sql, i) =>
      this.tx(() => {
        this.#db.exec(sql);
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

  schemaVersion(): number {
    return num(this.#get("PRAGMA user_version")?.user_version);
  }

  ensureProject(id: ProjectId, repoPath: string | null, at: string): void {
    this.#run("INSERT OR IGNORE INTO project(id, repo_path, created_at) VALUES (?, ?, ?)", id, repoPath, at);
  }

  nameProject(id: ProjectId, name: string): void {
    this.#run("UPDATE project SET name = ? WHERE id = ?", name, id);
  }

  createSession(session: SessionSummary, thread: ThreadId): void {
    this.tx(() => {
      this.#run(
        "INSERT INTO session(id, project_id, title, brief, created_at) VALUES (?, ?, ?, ?, ?)",
        session.id,
        session.projectId,
        session.title,
        session.brief,
        session.createdAt,
      );
      this.#run("INSERT INTO attachment(session_id, thread_id, attached_at) VALUES (?, ?, ?)", session.id, thread, session.createdAt);
    });
  }

  session(id: SessionId): SessionSummary | null {
    const row = this.#get("SELECT * FROM session WHERE id = ? AND archived_at IS NULL", id);
    return row === undefined ? null : toSession(row);
  }

  /** `project: null` lists every project's sessions. */
  sessions(project: ProjectId | null): SessionListing[] {
    return this.#all(
      `SELECT s.id, s.project_id, p.name AS project_name, s.title, s.brief, s.created_at, a.thread_id, a.lost_at,
        (SELECT MAX(n) FROM iteration WHERE session_id = s.id) AS latest_n,
        (SELECT MAX(created_at) FROM iteration WHERE session_id = s.id) AS latest_at,
        (SELECT MAX(created_at) FROM request WHERE session_id = s.id) AS request_at
      FROM session s JOIN project p ON p.id = s.project_id JOIN attachment a ON a.session_id = s.id AND a.detached_at IS NULL
      WHERE s.archived_at IS NULL AND (? IS NULL OR s.project_id = ?)
      ORDER BY s.created_at, s.id`,
      project,
      project,
    ).map(toListing);
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
        about: strOrNull(r.about),
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
    addresses: readonly FeedbackId[];
  }): void {
    const { session, iteration } = input;
    this.tx(() => {
      for (const c of input.contents) {
        this.#run(
          `INSERT OR IGNORE INTO block_content(hash, source, css, block_json, controls_json, controls_derived, about, compiled, parts_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          c.hash,
          c.files.tsx,
          c.files.css,
          c.files.json,
          c.files.controls,
          c.files.controls === null ? 1 : 0,
          c.files.about,
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
}
