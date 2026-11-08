import type { AppAbout, SkillInstall } from "../core/about";
import type { AppUpdateState } from "../core/appUpdate";
import type { UiPrefs, UiPrefsPatch } from "../core/prefs";
import type {
  ExportResult,
  Issue,
  ForkInput,
  IterationN,
  IterationView,
  KitPayload,
  Result,
  RobAction,
  SessionId,
  SessionListing,
  SessionPreview,
  SessionView,
  SlotId,
  SystemId,
  SystemImport,
  SystemListing,
  SystemVersionN,
  SystemView,
  ThemeExport,
} from "../core/types";

/** What adding or syncing a design system answers: the system as it is now, whether a new version came of it, and its warnings. */
export type SyncOutcome = { readonly system: SystemView; readonly created: boolean; readonly warnings: readonly Issue[] };

export type Api = {
  sessions(): Promise<Result<SessionListing[]>>;
  view(id: SessionId): Promise<Result<SessionView>>;
  /** What the session's home card previews, or null before its first iteration. */
  preview(id: SessionId, at?: { readonly n?: IterationN; readonly slot?: SlotId }): Promise<Result<SessionPreview | null>>;
  /** A past iteration, read-only. */
  iteration(id: SessionId, n: IterationN): Promise<Result<IterationView>>;
  /** Makes a new brainstorm from one iteration and starts its thread. A failed start still makes the fork. */
  fork(id: SessionId, input: ForkInput): Promise<Result<{ readonly fork: SessionId }>>;
  /** Throws away a fork whose thread never started. */
  discard(id: SessionId): Promise<Result<{ readonly parent: SessionId | null }>>;
  act(id: SessionId, action: RobAction): Promise<Result<SessionView>>;
  /** Settles a brainstorm, or brings it back. */
  settle(id: SessionId, settled: boolean): Promise<Result<SessionListing>>;
  exportHtml(id: SessionId): Promise<Result<ExportResult>>;
  /** Writes the session's theme as CSS and design tokens to the exports folder. */
  exportTheme(id: SessionId): Promise<Result<ThemeExport>>;
  systems(): Promise<Result<SystemListing[]>>;
  system(id: SystemId): Promise<Result<SystemView>>;
  addSystem(path: string): Promise<Result<SyncOutcome>>;
  /** Opens the app's native folder dialog; `path` is null when Rob cancels it. */
  pickFolder(): Promise<Result<{ readonly path: string | null }>>;
  syncSystem(id: SystemId): Promise<Result<SyncOutcome>>;
  /** Imports the design system in a project with an agent, or repairs one that stopped syncing (ADR 008). */
  importSystem(path: string, repair?: SystemId | null): Promise<Result<SystemImport>>;
  systemImports(): Promise<Result<SystemImport[]>>;
  dismissImport(path: string): Promise<Result<null>>;
  kit(id: SystemId, n: SystemVersionN): Promise<Result<KitPayload>>;
  prefs(): Promise<Result<UiPrefs>>;
  setPrefs(patch: UiPrefsPatch): Promise<Result<UiPrefs>>;
  /** Where the installed app is in updating itself. */
  update(): Promise<Result<AppUpdateState>>;
  /** Quits into the downloaded update, which reopens the app. */
  installUpdate(): Promise<Result<AppUpdateState>>;
  /** Looks for a newer release now. */
  checkUpdate(): Promise<Result<AppUpdateState>>;
  /** Downloads the update a check offered while automatic updates are off. */
  downloadUpdate(): Promise<Result<AppUpdateState>>;
  /** The version, the folders and the skill Settings shows. */
  about(): Promise<Result<AppAbout>>;
  /** Copies the bundled /use-brainstorm skill to ~/.claude now. */
  installSkill(): Promise<Result<SkillInstall>>;
  /** Calls `onSession` with each changed session id, and `onUpdate` with each update state, until `signal` aborts, reconnecting after a drop. */
  events(
    on: { onSession: (id: SessionId) => void; onUpdate: (state: AppUpdateState) => void; onSystems?: () => void; onOpen: () => void },
    signal: AbortSignal,
  ): Promise<void>;
};

const RECONNECT_MS = 1000;

/** The UI token stays in this closure; nothing else in the renderer can read it. */
export function createApi(token: string): Api {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
    try {
      const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return (await res.json()) as Result<T>;
    } catch {
      return { ok: false, error: { code: "unavailable", message: "Brainstorm's server didn't answer. If it happens again, restart Brainstorm." } };
    }
  }

  async function events({ onSession, onUpdate, onSystems, onOpen }: Parameters<Api["events"]>[0], signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        // EventSource can't send the bearer header, so the stream is read with fetch.
        const res = await fetch("/v1/ui/events", { headers, signal });
        const reader = res.body?.getReader();
        if (!res.ok || reader === undefined) throw new Error(`events answered ${res.status}`);
        onOpen();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = /^data: (.*)$/m.exec(event)?.[1];
            if (data === undefined) continue;
            if (/^event: session$/m.test(event)) onSession((JSON.parse(data) as { session: SessionId }).session);
            else if (/^event: update$/m.test(event)) onUpdate(JSON.parse(data) as AppUpdateState);
            else if (/^event: systems$/m.test(event)) onSystems?.();
          }
        }
      } catch {
        if (signal.aborted) return;
      }
      await new Promise((r) => setTimeout(r, RECONNECT_MS));
    }
  }

  return {
    sessions: () => call("GET", "/v1/ui/sessions"),
    view: (id) => call("GET", `/v1/ui/sessions/${id}`),
    preview: (id, at = {}) => {
      const query = new URLSearchParams();
      if (at.n !== undefined) query.set("n", String(at.n));
      if (at.slot !== undefined) query.set("slot", at.slot);
      const q = query.toString();
      return call("GET", `/v1/ui/sessions/${id}/preview${q === "" ? "" : `?${q}`}`);
    },
    iteration: (id, n) => call("GET", `/v1/ui/sessions/${id}/iterations/${n}`),
    fork: (id, input) => call("POST", `/v1/ui/sessions/${id}/fork`, input),
    discard: (id) => call("POST", `/v1/ui/sessions/${id}/discard`),
    act: (id, action) => call("POST", `/v1/ui/sessions/${id}/actions`, action),
    settle: (id, settled) => call("POST", `/v1/ui/sessions/${id}/settle`, { settled }),
    exportHtml: (id) => call("POST", `/v1/ui/sessions/${id}/export`),
    exportTheme: (id) => call("POST", `/v1/ui/sessions/${id}/theme-export`),
    systems: () => call("GET", "/v1/ui/systems"),
    system: (id) => call("GET", `/v1/ui/systems/${id}`),
    addSystem: (path) => call("POST", "/v1/ui/systems", { path }),
    pickFolder: () => call("POST", "/v1/ui/pick-folder"),
    syncSystem: (id) => call("POST", `/v1/ui/systems/${id}/sync`),
    importSystem: (path, repair = null) => call("POST", "/v1/ui/system-imports", { path, repair }),
    systemImports: () => call("GET", "/v1/ui/system-imports"),
    dismissImport: (path) => call("POST", "/v1/ui/system-imports/dismiss", { path }),
    kit: (id, n) => call("GET", `/v1/ui/systems/${id}/kit/${n}`),
    prefs: () => call("GET", "/v1/ui/prefs"),
    setPrefs: (patch) => call("POST", "/v1/ui/prefs", patch),
    update: () => call("GET", "/v1/ui/update"),
    installUpdate: () => call("POST", "/v1/ui/update/install"),
    checkUpdate: () => call("POST", "/v1/ui/update/check"),
    downloadUpdate: () => call("POST", "/v1/ui/update/download"),
    about: () => call("GET", "/v1/ui/about"),
    installSkill: () => call("POST", "/v1/ui/skill/install"),
    events,
  };
}
