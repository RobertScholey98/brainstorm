import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { buildCanvasDocument, CANVAS_CSP } from "../canvas/document";
import { packageRoot } from "../core/packageRoot";
import type { AppUpdates } from "../core/appUpdate";
import type { Brainstorm } from "../core/brainstorm";
import { zBranded } from "../core/parse";
import { TIERS } from "../core/system/model";
import { VARY_MAX } from "../core/fork";
import { uiPrefsPatch, type AppSettings } from "../core/prefs";
import type { AppAbout, SkillHost } from "../core/about";
import { exportsDir } from "./appData";
import {
  parseBlockId,
  parseFeedbackId,
  parseIterationN,
  parsePartName,
  parsePropName,
  parseProposedName,
  parseSessionId,
  parseSystemId,
  parseSlotId,
  parseThreadId,
  parseVariantKey,
  type Failure,
  type FailureCode,
  type IterationN,
  type Result,
  type RobAction,
  type SessionId,
  type SlotId,
  type SystemId,
  type SystemVersionN,
} from "../core/types";

const MAX_BODY_BYTES = 16 * 1024 * 1024;

const RENDERER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const ASSET_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  woff2: "font/woff2",
};
const HEARTBEAT_MS = 15_000;

const STATUS: Record<FailureCode, number> = {
  usage: 400,
  unauthorized: 401,
  not_found: 404,
  thread_missing: 404,
  stale_working_copy: 409,
  session_mismatch: 409,
  thread_not_attached: 409,
  wrong_project: 409,
  ambiguous_title: 409,
  request_open: 409,
  thread_lost: 409,
  validation_failed: 422,
  invalid_action: 422,
  unavailable: 503,
  internal: 500,
};

const threadId = zBranded(z.string(), parseThreadId, "T3 thread id");
const blockId = zBranded(z.string(), parseBlockId, "block id (<slot>/<variant>)");
const propName = zBranded(z.string(), parsePropName, "prop name");
const feedbackId = zBranded(z.number(), parseFeedbackId, "feedback id");

const newSessionBody = z.strictObject({
  title: z.string().trim().min(1),
  brief: z.string(),
  thread: threadId,
  project: z.string().nullable(),
  /** A design system's id or name. */
  system: z.string().trim().min(1).nullable().default(null),
});
const addSystemBody = z.strictObject({
  path: z.string().trim().min(1),
  name: z.string().trim().min(1).nullable().default(null),
  frame: z.string().trim().min(1).nullable().default(null),
  stubs: z.record(z.string(), z.string()).optional(),
  thread: threadId.nullable().default(null),
});
const folderBody = z.strictObject({ path: z.string().trim().min(1) });
const importBody = z.strictObject({ path: z.string().trim().min(1), repair: z.string().trim().min(1).nullable().default(null) });
const reviewBody = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("tier"), name: z.string().min(1), tier: z.enum(TIERS) }),
  z.strictObject({ kind: z.literal("issue"), name: z.string().min(1).nullable(), note: z.string().trim().min(1).max(2000) }),
  z.strictObject({ kind: z.literal("drop_issue"), issue: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal("send") }),
  z.strictObject({ kind: z.literal("confirm") }),
]);
const themeName = z.string().trim().min(1).max(60);
const cssName = z.string().regex(/^--[\w-]+$/, "a custom property, such as --primary");
const attachBody = z.strictObject({ ref: z.string().trim().min(1), thread: threadId });
const settleBody = z.strictObject({ settled: z.boolean() });
const iterationN = zBranded(z.number(), parseIterationN, "iteration number");
const forkBody = z.strictObject({
  from: iterationN,
  picks: z.record(z.string(), zBranded(z.string(), parseVariantKey, "variant key")).default({}),
  instruction: z.string().trim().min(1, "say what the fork should try"),
});
const workingCopyBody = z.strictObject({
  thread: threadId,
  files: z.record(z.string(), z.string()),
  addresses: z.array(feedbackId).default([]),
  note: z.string().nullable().default(null),
});

const pin = z.strictObject({ blockId, part: zBranded(z.string(), parsePartName, "part name").nullable() });
const scope = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("blocks"), blocks: z.tuple([blockId], blockId) }),
  z.strictObject({ kind: z.literal("described") }),
]);
const regenerate = z
  .strictObject({ kind: z.literal("regenerate"), scope, freetext: z.string().trim().min(1).nullable() })
  .transform((a, ctx): Extract<RobAction, { kind: "regenerate" }> => {
    if (a.scope.kind !== "described") return { kind: a.kind, scope: a.scope, freetext: a.freetext };
    if (a.freetext !== null) return { kind: a.kind, scope: a.scope, freetext: a.freetext };
    ctx.addIssue({ code: "custom", path: ["freetext"], message: "a described request needs freetext" });
    return z.NEVER;
  });

const ACTIONS: { readonly [K in RobAction["kind"]]: z.ZodType<Extract<RobAction, { kind: K }>> } = {
  set_override: z.strictObject({
    kind: z.literal("set_override"),
    blockId,
    prop: propName,
    value: z.union([z.number(), z.string(), z.boolean()]),
  }),
  clear_override: z.strictObject({ kind: z.literal("clear_override"), blockId, prop: propName }),
  dismiss_inapplicable: z.strictObject({ kind: z.literal("dismiss_inapplicable"), blockId, prop: propName }),
  select_variant: z.strictObject({
    kind: z.literal("select_variant"),
    slot: zBranded(z.string(), parseSlotId, "slot id"),
    variant: zBranded(z.string(), parseVariantKey, "variant key"),
  }),
  add_feedback: z.strictObject({ kind: z.literal("add_feedback"), pin, text: z.string().trim().min(1) }),
  edit_feedback: z.strictObject({ kind: z.literal("edit_feedback"), id: feedbackId, text: z.string().trim().min(1) }),
  delete_feedback: z.strictObject({ kind: z.literal("delete_feedback"), id: feedbackId }),
  confirm_feedback: z.strictObject({ kind: z.literal("confirm_feedback"), id: feedbackId }),
  reopen_feedback: z.strictObject({ kind: z.literal("reopen_feedback"), id: feedbackId }),
  regenerate,
  retry_request: z.strictObject({ kind: z.literal("retry_request") }),
  withdraw_request: z.strictObject({ kind: z.literal("withdraw_request") }),
  check_thread: z.strictObject({ kind: z.literal("check_thread") }),
  vary: z.strictObject({
    kind: z.literal("vary"),
    target: pin,
    count: z.number().int().min(1).max(VARY_MAX),
    direction: z
      .string()
      .nullable()
      .transform((d) => (d === null || d.trim() === "" ? null : d.trim())),
  }),
  mark_seen: z.strictObject({ kind: z.literal("mark_seen"), blocks: z.tuple([blockId], blockId) }),
  set_theme_axis: z.strictObject({ kind: z.literal("set_theme_axis"), axis: z.string().min(1), value: z.string().min(1).nullable() }),
  set_theme_token: z.strictObject({ kind: z.literal("set_theme_token"), token: cssName, value: z.string().min(1).max(200) }),
  clear_theme_token: z.strictObject({ kind: z.literal("clear_theme_token"), token: cssName }),
  reset_theme: z.strictObject({ kind: z.literal("reset_theme") }),
  apply_theme: z.strictObject({ kind: z.literal("apply_theme"), name: themeName }),
  save_theme: z.strictObject({ kind: z.literal("save_theme"), name: themeName }),
  upgrade_system: z.strictObject({ kind: z.literal("upgrade_system") }),
  promote: z.strictObject({ kind: z.literal("promote"), name: zBranded(z.string(), parseProposedName, "proposed component name") }),
};

const isActionKind = (k: unknown): k is RobAction["kind"] => typeof k === "string" && Object.hasOwn(ACTIONS, k);

function parseAction(raw: unknown): Result<RobAction> {
  const kind = typeof raw === "object" && raw !== null ? (raw as { kind?: unknown }).kind : undefined;
  if (!isActionKind(kind)) return usage(`kind must be one of ${Object.keys(ACTIONS).join(", ")}`);
  const schema: z.ZodType<RobAction> = ACTIONS[kind];
  return parseBody(schema, raw);
}

/** `?n=&slot=` picks a past iteration's still and the slot it shows; both are optional. */
function previewAt(query: URLSearchParams): Result<{ n?: IterationN; slot?: SlotId }> {
  const rawN = query.get("n");
  const rawSlot = query.get("slot");
  const n = rawN === null ? undefined : parseIterationN(Number(rawN));
  const slot = rawSlot === null ? undefined : parseSlotId(rawSlot);
  if (n === null) return usage(`"${rawN}" is not an iteration number`);
  if (slot === null) return usage(`"${rawSlot}" is not a slot id`);
  return { ok: true, data: { ...(n === undefined ? {} : { n }), ...(slot === undefined ? {} : { slot }) } };
}

const usage = (message: string): { ok: false; error: Failure } => ({ ok: false, error: { code: "usage", message } });

function parseBody<T>(schema: z.ZodType<T>, raw: unknown): Result<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return usage(parsed.error.issues.map((i) => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; "));
}

const decodeSegment = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};

type Auth = "agent" | "ui" | "none";
type Route = {
  readonly method: "GET" | "POST";
  readonly path: RegExp;
  readonly auth: Auth;
  readonly handle: (input: { params: string[]; query: URLSearchParams; body: unknown }) => Promise<Result<unknown>>;
};

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

export type HttpOptions = {
  readonly service: Brainstorm;
  readonly agentToken: string;
  readonly uiToken: string;
  readonly version: string;
  readonly updates: AppUpdates;
  /** The window's native folder dialog, or null where there's no window to show one. */
  readonly pickFolder: (() => Promise<string | null>) | null;
  /** Brainstorm's home folder, which Settings shows. */
  readonly home: string;
  /** The agent skill the installed app keeps, or null where it leaves the user's skills alone. */
  readonly skill?: SkillHost | null;
  /** Told the settings each time a save changes any, so the main process can act on its own. */
  readonly onSettings?: (settings: AppSettings) => void;
};

export function createHttpHandler(options: HttpOptions, port: () => number) {
  const { service, updates } = options;
  const streams = new Set<ServerResponse>();
  let closing = false;

  const withSession =
    (fn: (id: SessionId, input: { params: string[]; query: URLSearchParams; body: unknown }) => Promise<Result<unknown>>) =>
    async ({ params, query, body }: { params: string[]; query: URLSearchParams; body: unknown }) => {
      const raw = params[0] ?? "";
      const decoded = decodeSegment(raw);
      if (decoded === null) return usage(`"${raw}" is not a valid URL path segment`);
      const id = parseSessionId(decoded);
      return id === null
        ? ({ ok: false, error: { code: "not_found", entity: "session", message: `"${params[0]}" is not a session id` } } as const)
        : fn(id, { params, query, body });
    };

  const withSystem =
    (fn: (id: SystemId, input: { params: string[]; query: URLSearchParams; body: unknown }) => Promise<Result<unknown>>) =>
    async ({ params, query, body }: { params: string[]; query: URLSearchParams; body: unknown }) => {
      const raw = decodeSegment(params[0] ?? "");
      if (raw === null) return usage(`"${params[0]}" is not a valid URL path segment`);
      // The agent may name a system by its id or its name.
      const id = parseSystemId(raw) ?? (() => {
        const found = service.systems.find(raw);
        return found.ok ? found.data.id : null;
      })();
      return id === null
        ? ({ ok: false, error: { code: "not_found", entity: "system", message: `no design system has the id or name "${raw}"` } } as const)
        : fn(id, { params, query, body });
    };

  const queryThread = (query: URLSearchParams, required: boolean): Result<ReturnType<typeof parseThreadId>> => {
    const raw = query.get("thread");
    if (raw === null) return required ? usage("thread is required") : { ok: true, data: null };
    const thread = parseThreadId(raw);
    return thread === null ? usage(`"${raw}" is not a T3 thread id`) : { ok: true, data: thread };
  };

  const routes: readonly Route[] = [
    {
      method: "POST",
      path: /^\/v1\/agent\/sessions$/,
      auth: "agent",
      handle: async ({ body }) => {
        const b = parseBody(newSessionBody, body);
        return b.ok
          ? service.newSession({ title: b.data.title, brief: b.data.brief, thread: b.data.thread, projectPath: b.data.project, system: b.data.system })
          : b;
      },
    },
    {
      method: "GET",
      path: /^\/v1\/agent\/sessions$/,
      auth: "agent",
      handle: async ({ query }) => {
        const thread = queryThread(query, true);
        return thread.ok ? service.listSessions(thread.data) : thread;
      },
    },
    {
      method: "POST",
      path: /^\/v1\/agent\/attach$/,
      auth: "agent",
      handle: async ({ body }) => {
        const b = parseBody(attachBody, body);
        return b.ok ? service.attach(b.data) : b;
      },
    },
    {
      method: "GET",
      path: /^\/v1\/agent\/sessions\/([^/]+)\/context$/,
      auth: "agent",
      handle: withSession(async (id, { query }) => {
        const thread = queryThread(query, false);
        return thread.ok ? service.context(id, thread.data) : thread;
      }),
    },
    { method: "GET", path: /^\/v1\/agent\/sessions\/([^/]+)\/pull$/, auth: "agent", handle: withSession((id) => service.pull(id)) },
    {
      method: "POST",
      path: /^\/v1\/agent\/sessions\/([^/]+)\/validate$/,
      auth: "agent",
      handle: withSession(async (id, { body }) => {
        const b = parseBody(workingCopyBody, body);
        return b.ok ? service.validate({ session: id, thread: b.data.thread, files: b.data.files, addresses: b.data.addresses }) : b;
      }),
    },
    {
      method: "POST",
      path: /^\/v1\/agent\/sessions\/([^/]+)\/commit$/,
      auth: "agent",
      handle: withSession(async (id, { body }) => {
        const b = parseBody(workingCopyBody, body);
        return b.ok ? service.commit({ session: id, ...b.data }) : b;
      }),
    },
    ...(["agent", "ui"] as const).flatMap((auth): Route[] => [
      { method: "GET", path: new RegExp(`^/v1/${auth}/systems$`), auth, handle: async () => ({ ok: true, data: service.systems.list() }) },
      {
        method: "POST",
        path: new RegExp(`^/v1/${auth}/systems$`),
        auth,
        handle: async ({ body }) => {
          const b = parseBody(addSystemBody, body);
          return b.ok ? service.systems.add(b.data) : b;
        },
      },
      { method: "GET", path: new RegExp(`^/v1/${auth}/systems/([^/]+)$`), auth, handle: withSystem(async (id) => service.systems.view(id)) },
      { method: "POST", path: new RegExp(`^/v1/${auth}/systems/([^/]+)/sync$`), auth, handle: withSystem((id) => service.systems.sync(id)) },
      // Importing a project's system with an agent (ADR 008): the gates it loops on, and the imports under way.
      {
        method: "POST",
        path: new RegExp(`^/v1/${auth}/system-check$`),
        auth,
        handle: async ({ body }) => {
          const b = parseBody(folderBody, body);
          return b.ok ? service.systems.check(b.data.path) : b;
        },
      },
      { method: "GET", path: new RegExp(`^/v1/${auth}/system-imports$`), auth, handle: async () => ({ ok: true, data: service.systems.imports() }) },
      {
        method: "POST",
        path: new RegExp(`^/v1/${auth}/system-imports$`),
        auth,
        handle: async ({ body }) => {
          const b = parseBody(importBody, body);
          if (!b.ok) return b;
          const repair = b.data.repair === null ? null : parseSystemId(b.data.repair);
          if (b.data.repair !== null && repair === null) return usage(`"${b.data.repair}" is not a design system id`);
          return service.systems.importProject({ path: b.data.path, repair });
        },
      },
      {
        method: "POST",
        path: new RegExp(`^/v1/${auth}/system-imports/dismiss$`),
        auth,
        handle: async ({ body }) => {
          const b = parseBody(folderBody, body);
          return b.ok ? service.systems.dismissImport(b.data.path) : b;
        },
      },
    ]),
    {
      method: "GET",
      path: /^\/v1\/ui\/systems\/([^/]+)\/kit\/(\d+)$/,
      auth: "ui",
      handle: withSystem(async (id, { params }) => {
        const n = Number(params[1]);
        return Number.isInteger(n) && n >= 1 ? service.systems.kit(id, n as SystemVersionN) : usage(`"${params[1]}" is not a version number`);
      }),
    },
    // Rob's review of an imported system (ADR 008). Only the window reviews: an agent can't confirm a system for Rob.
    {
      method: "POST",
      path: /^\/v1\/ui\/systems\/([^/]+)\/review$/,
      auth: "ui",
      handle: withSystem(async (id, { body }) => {
        const b = parseBody(reviewBody, body);
        return b.ok ? service.systems.review(id, b.data) : b;
      }),
    },
    // What an agent Brainstorm handed work to is doing in its thread, for the cards that wait on it.
    {
      method: "GET",
      path: /^\/v1\/ui\/threads\/([^/]+)\/work$/,
      auth: "ui",
      handle: async ({ params }) => {
        const raw = decodeSegment(params[0] ?? "");
        const thread = raw === null ? null : parseThreadId(raw);
        return thread === null ? usage(`"${params[0]}" is not a T3 thread id`) : service.systems.work(thread);
      },
    },
    { method: "POST", path: /^\/v1\/ui\/sessions\/([^/]+)\/theme-export$/, auth: "ui", handle: withSession(async (id) => service.exportTheme(id)) },
    { method: "GET", path: /^\/v1\/ui\/sessions$/, auth: "ui", handle: () => service.listSessions(null) },
    { method: "GET", path: /^\/v1\/ui\/sessions\/([^/]+)$/, auth: "ui", handle: withSession((id) => service.view(id)) },
    {
      method: "POST",
      path: /^\/v1\/ui\/sessions\/([^/]+)\/actions$/,
      auth: "ui",
      handle: withSession(async (id, { body }) => {
        const action = parseAction(body);
        return action.ok ? service.act(id, action.data) : action;
      }),
    },
    {
      method: "POST",
      path: /^\/v1\/ui\/sessions\/([^/]+)\/settle$/,
      auth: "ui",
      handle: withSession(async (id, { body }) => {
        const b = parseBody(settleBody, body);
        return b.ok ? service.settle(id, b.data.settled) : b;
      }),
    },
    { method: "GET", path: /^\/v1\/ui\/prefs$/, auth: "ui", handle: async () => service.prefs() },
    {
      method: "POST",
      path: /^\/v1\/ui\/prefs$/,
      auth: "ui",
      handle: async ({ body }) => {
        const patch = parseBody(uiPrefsPatch, body);
        if (!patch.ok) return patch;
        const saved = service.setPrefs(patch.data);
        if (saved.ok && patch.data.settings !== undefined) options.onSettings?.(saved.data.settings);
        return saved;
      },
    },
    {
      method: "GET",
      path: /^\/v1\/ui\/about$/,
      auth: "ui",
      handle: async () => {
        const skill = options.skill ?? null;
        const about: AppAbout = {
          version: options.version,
          platform: process.platform,
          home: options.home,
          exports: exportsDir(options.home),
          skill: skill === null ? null : { target: skill.target, backups: skill.backups },
        };
        return { ok: true, data: about };
      },
    },
    {
      method: "POST",
      path: /^\/v1\/ui\/skill\/install$/,
      auth: "ui",
      handle: async () => {
        const skill = options.skill ?? null;
        if (skill === null) return { ok: false, error: { code: "unavailable", message: "Only the installed Brainstorm app on your own home manages the agent skill." } };
        try {
          return { ok: true, data: skill.install() };
        } catch (e) {
          return { ok: false, error: { code: "unavailable", message: `The skill didn't install: ${e instanceof Error ? e.message : String(e)}` } };
        }
      },
    },
    { method: "POST", path: /^\/v1\/ui\/sessions\/([^/]+)\/export$/, auth: "ui", handle: withSession((id) => service.exportHtml(id)) },
    {
      method: "GET",
      path: /^\/v1\/ui\/sessions\/([^/]+)\/preview$/,
      auth: "ui",
      handle: withSession(async (id, { query }) => {
        const at = previewAt(query);
        return at.ok ? service.preview(id, at.data) : at;
      }),
    },
    {
      method: "GET",
      path: /^\/v1\/ui\/sessions\/([^/]+)\/iterations\/(\d+)$/,
      auth: "ui",
      handle: withSession(async (id, { params }) => {
        const n = parseIterationN(Number(params[1]));
        return n === null ? usage(`"${params[1]}" is not an iteration number`) : service.iteration(id, n);
      }),
    },
    {
      method: "POST",
      path: /^\/v1\/ui\/sessions\/([^/]+)\/fork$/,
      auth: "ui",
      handle: withSession(async (id, { body }) => {
        const b = parseBody(forkBody, body);
        return b.ok ? service.fork(id, b.data) : b;
      }),
    },
    { method: "POST", path: /^\/v1\/ui\/sessions\/([^/]+)\/discard$/, auth: "ui", handle: withSession(async (id) => service.discard(id)) },
    {
      method: "POST",
      path: /^\/v1\/ui\/pick-folder$/,
      auth: "ui",
      handle: async () => {
        const pick = options.pickFolder;
        if (pick === null) return { ok: false, error: { code: "unavailable", message: "Only the Brainstorm app can open a folder dialog. Paste the folder's path instead." } };
        return { ok: true, data: { path: await pick() } };
      },
    },
    { method: "GET", path: /^\/v1\/ui\/update$/, auth: "ui", handle: async () => ({ ok: true, data: updates.state() }) },
    {
      method: "POST",
      path: /^\/v1\/ui\/update\/install$/,
      auth: "ui",
      handle: async () =>
        updates.install()
          ? { ok: true, data: updates.state() }
          : { ok: false, error: { code: "invalid_action", message: "There's no downloaded update to install." } },
    },
    {
      method: "POST",
      path: /^\/v1\/ui\/update\/check$/,
      auth: "ui",
      handle: async () => {
        if (updates.check()) return { ok: true, data: updates.state() };
        const state = updates.state();
        const message = state.kind === "off" ? state.reason : "Brainstorm is already checking for, downloading or installing an update.";
        return { ok: false, error: { code: "invalid_action", message } };
      },
    },
    {
      method: "POST",
      path: /^\/v1\/ui\/update\/download$/,
      auth: "ui",
      handle: async () =>
        updates.download()
          ? { ok: true, data: updates.state() }
          : { ok: false, error: { code: "invalid_action", message: "There's no update waiting to download." } },
    },
    {
      method: "GET",
      path: /^\/health$/,
      auth: "none",
      handle: async () => ({ ok: true, data: { pid: process.pid, version: options.version } }),
    },
  ];

  const send = (res: ServerResponse, result: Result<unknown>) => {
    res.writeHead(result.ok ? 200 : STATUS[result.error.code], { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(result));
  };

  const refuse = (res: ServerResponse, message: string) => send(res, { ok: false, error: { code: "unauthorized", message } });

  const allowedHosts = () => [`127.0.0.1:${port()}`, `localhost:${port()}`];

  const authorized = (req: IncomingMessage, auth: Auth): boolean => {
    if (auth === "none") return true;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    return sameToken(token, auth === "agent" ? options.agentToken : options.uiToken);
  };

  const openEvents = (req: IncomingMessage, res: ServerResponse) => {
    // The window reopens its stream as soon as one ends, and one that opens during shutdown would hold the server open.
    if (closing) {
      res.writeHead(503, { connection: "close" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": connected\n\n");
    streams.add(res);
    const unsubscribe = service.subscribe((session) => res.write(`event: session\ndata: ${JSON.stringify({ session })}\n\n`));
    const unsubscribeUpdates = updates.subscribe((state) => res.write(`event: update\ndata: ${JSON.stringify(state)}\n\n`));
    const unsubscribeSystems = service.systems.subscribe(() => res.write("event: systems\ndata: {}\n\n"));
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeUpdates();
      unsubscribeSystems();
      streams.delete(res);
    });
  };

  async function listener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!allowedHosts().includes(req.headers.host ?? "")) return refuse(res, "unexpected Host header");
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedHosts().some((h) => origin === `http://${h}`)) return refuse(res, "cross-origin requests are refused");

      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/v1/ui/events") {
        return authorized(req, "ui") ? openEvents(req, res) : refuse(res, "a UI token is required");
      }
      if (req.method === "GET" && (url.pathname === "/canvas" || url.pathname === "/canvas/preview")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CANVAS_CSP, "cache-control": "no-store" });
        res.end(buildCanvasDocument(null, url.pathname === "/canvas" ? "live" : "preview"));
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) return serveRenderer(res, url.pathname);

      for (const route of routes) {
        const match = route.path.exec(url.pathname);
        if (match === null || route.method !== req.method) continue;
        if (!authorized(req, route.auth)) return refuse(res, `${route.auth === "agent" ? "an agent" : "a UI"} token is required`);
        const body = route.method === "POST" ? await readJson(req) : undefined;
        if (body instanceof BodyError) return send(res, usage(body.message));
        return send(res, await route.handle({ params: match.slice(1), query: url.searchParams, body }));
      }
      send(res, usage(`no route ${req.method} ${url.pathname}`));
    } catch (e) {
      send(res, { ok: false, error: { code: "internal", message: e instanceof Error ? e.message : String(e) } });
    }
  }

  return {
    listener: (req: IncomingMessage, res: ServerResponse) => void listener(req, res),
    closeStreams: () => {
      closing = true;
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}

/** The built renderer: index.html at /, and Vite's hashed files under /assets/. Nothing else under dist/ is reachable. */
function serveRenderer(res: ServerResponse, pathname: string): void {
  const name = pathname === "/" ? "index.html" : /^\/assets\/([\w.-]+)$/.exec(pathname)?.[1];
  const type = name === "index.html" ? "text/html; charset=utf-8" : ASSET_TYPES[name?.split(".").pop() ?? ""];
  let body: Buffer;
  try {
    if (name === undefined || type === undefined) throw new Error("not a renderer file");
    body = readFileSync(new URL(`dist/renderer/${name === "index.html" ? "" : "assets/"}${name}`, packageRoot()));
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(pathname === "/" ? "The renderer isn't built; run npm run build." : "Not found.");
    return;
  }
  res.writeHead(200, {
    "content-type": type,
    "content-security-policy": RENDERER_CSP,
    "x-content-type-options": "nosniff",
    "cache-control": name === "index.html" ? "no-store" : "max-age=31536000, immutable",
  });
  res.end(body);
}

class BodyError extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return new BodyError(`the request body is over ${MAX_BODY_BYTES / 1024 / 1024} MB`);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return new BodyError("the request body is not JSON");
  }
}
