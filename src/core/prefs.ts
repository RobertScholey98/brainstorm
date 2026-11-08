import { z } from "zod";
import { zBranded } from "./parse";
import { parseSessionId, parseSlotId, type ProjectId, type SessionId, type SlotId } from "./types";

/**
 * How Rob left the window: pane widths, whether the Inspector is a rail, and each brainstorm's canvas view. The
 * window's origin changes with each launch's port, so its own storage forgets these; the server keeps them.
 */
export type UiPrefs = {
  readonly panes: { readonly sidebar: number | null; readonly inspector: number | null };
  readonly inspectorRail: boolean;
  /** Keyed by SessionId: whether Rob last opened or shut that brainstorm's history strip. With no entry, `stripOpen` decides. */
  readonly historyStrip: Readonly<Record<string, boolean>>;
  /** Keyed by SessionId. A brainstorm with no entry opens on the stage at its first slot. */
  readonly canvas: Readonly<Record<string, CanvasLayout>>;
  /** How home is filtered and sorted. The search text isn't kept: it answers one question, not a standing view. */
  readonly home: HomeQuery;
  /** How the preview window shows the canvas, and whether the main window keeps its own while it is open (ADR 007). */
  readonly preview: PreviewPrefs;
  /** What Rob chose in Settings. */
  readonly settings: AppSettings;
};

/**
 * `clean` shows the design alone, filling the window, for an audience; `working` is the canvas as the main window draws
 * it, pins and all. `here` keeps the main window's canvas while the preview window is open.
 */
export type PreviewPrefs = { readonly look: "clean" | "working"; readonly here: boolean };
export const DEFAULT_PREVIEW: PreviewPrefs = { look: "clean", here: true };

/** Which brainstorms home shows. `attention` is any that needs Rob: a lost thread, or a request that stopped for him. */
export type HomeStatus = "active" | "attention" | "settled" | "all";
export type HomeSort = "recent" | "created" | "title";
/** `projects` empty is every project. */
export type HomeQuery = { readonly status: HomeStatus; readonly projects: readonly ProjectId[]; readonly sort: HomeSort };
export const DEFAULT_HOME: HomeQuery = { status: "active", projects: [], sort: "recent" };

/** The stage shows one slot at a time; the board shows every slot side by side. */
export type CanvasLayout = { readonly view: "stage" | "board"; readonly slot: SlotId | null };

/** `system` follows the OS, as the app did before it had a choice. */
export type ThemeChoice = "system" | "light" | "dark";
/** System alerts for a brainstorm that moved while the window was in the background, as T3 Code's thread notifications are. */
export type NotifyChoice = "off" | "silent" | "sound";
/** `auto` is the strip's first rule: shut until a second iteration lands. */
export type StripChoice = "auto" | "open" | "closed";

/**
 * The choices Settings holds. The main process acts on `theme`, `autoUpdate` and `skillUpdate`, since it owns the
 * native theme, the updater and the skill copy; the window acts on the rest.
 */
export type AppSettings = {
  readonly theme: ThemeChoice;
  readonly notifications: NotifyChoice;
  /** The canvas view a brainstorm opens on before Rob has picked one in it. */
  readonly canvasView: CanvasLayout["view"];
  /** Whether a brainstorm's history strip starts open before Rob has opened or shut it there. */
  readonly historyStrip: StripChoice;
  /** How many variants Vary asks for until Rob changes it in the popover. */
  readonly varyCount: number;
  /** Download a newer release as soon as a check finds one. Off, a check only says there is one. */
  readonly autoUpdate: boolean;
  /** Copy the bundled /use-brainstorm skill to ~/.claude each time the app starts. */
  readonly skillUpdate: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  notifications: "sound",
  canvasView: "stage",
  historyStrip: "auto",
  varyCount: 3,
  autoUpdate: true,
  skillUpdate: true,
};

export type UiPrefsPatch = {
  readonly panes?: { readonly sidebar?: number; readonly inspector?: number };
  readonly inspectorRail?: boolean;
  readonly historyStrip?: { readonly session: SessionId; readonly open: boolean };
  readonly canvas?: { readonly session: SessionId; readonly layout: CanvasLayout };
  readonly home?: HomeQuery;
  readonly preview?: PreviewPrefs;
  readonly settings?: Partial<AppSettings>;
};

export const NO_PREFS: UiPrefs = {
  panes: { sidebar: null, inspector: null },
  inspectorRail: false,
  historyStrip: {},
  canvas: {},
  home: DEFAULT_HOME,
  preview: DEFAULT_PREVIEW,
  settings: DEFAULT_SETTINGS,
};

/** What Restore defaults puts back: Settings, and the window choices Settings shows. Pane widths and each brainstorm's own views stay. */
export const RESTORE_DEFAULTS: UiPrefsPatch = { settings: DEFAULT_SETTINGS, preview: DEFAULT_PREVIEW, inspectorRail: false };

/**
 * Whether a brainstorm's history strip shows. Rob's choice in that brainstorm wins; without one, Settings decides, and
 * its `auto` keeps the strip shut while there is one iteration and opens it once a second lands.
 */
export function stripOpen(choice: boolean | undefined, iterations: number, fallback: StripChoice = "auto"): boolean {
  return choice ?? (fallback === "auto" ? iterations >= 2 : fallback === "open");
}

const sessionId = zBranded(z.string(), parseSessionId, "session id");

const width = z.number().int().min(120).max(1200);
const layout = z.strictObject({ view: z.enum(["stage", "board"]), slot: zBranded(z.string(), parseSlotId, "slot id").nullable() });
const home: z.ZodType<HomeQuery> = z.strictObject({
  status: z.enum(["active", "attention", "settled", "all"]),
  projects: z.array(z.string().min(1).max(200).transform((p) => p as ProjectId)).max(500),
  sort: z.enum(["recent", "created", "title"]),
});
const preview: z.ZodType<PreviewPrefs> = z.strictObject({ look: z.enum(["clean", "working"]), here: z.boolean() });

/** One schema per setting, so each stored row reads back on its own and a bad one costs only itself. */
const SETTING = {
  theme: z.enum(["system", "light", "dark"]),
  notifications: z.enum(["off", "silent", "sound"]),
  canvasView: z.enum(["stage", "board"]),
  historyStrip: z.enum(["auto", "open", "closed"]),
  varyCount: z.number().int().min(1).max(6),
  autoUpdate: z.boolean(),
  skillUpdate: z.boolean(),
} satisfies { [K in keyof AppSettings]: z.ZodType<AppSettings[K]> };
const isSetting = (name: string): name is keyof AppSettings => Object.hasOwn(SETTING, name);

export const uiPrefsPatch: z.ZodType<UiPrefsPatch> = z.strictObject({
  panes: z.strictObject({ sidebar: width.optional(), inspector: width.optional() }).optional(),
  inspectorRail: z.boolean().optional(),
  historyStrip: z.strictObject({ session: sessionId, open: z.boolean() }).optional(),
  canvas: z.strictObject({ session: sessionId, layout }).optional(),
  home: home.optional(),
  preview: preview.optional(),
  settings: z.strictObject(SETTING).partial().optional(),
});

/** The settings `patch` names, without the ones it leaves out. */
const namedSettings = (patch: Partial<AppSettings> | undefined): [keyof AppSettings, unknown][] =>
  Object.entries(patch ?? {}).filter(([name, value]) => isSetting(name) && value !== undefined) as [keyof AppSettings, unknown][];

/** One stored row per preference, so changing one never rewrites another. */
export function prefRows(patch: UiPrefsPatch): [key: string, value: unknown][] {
  const rows: [string, unknown][] = [];
  if (patch.panes?.sidebar !== undefined) rows.push(["pane.sidebar", patch.panes.sidebar]);
  if (patch.panes?.inspector !== undefined) rows.push(["pane.inspector", patch.panes.inspector]);
  if (patch.inspectorRail !== undefined) rows.push(["inspector.rail", patch.inspectorRail]);
  if (patch.historyStrip !== undefined) rows.push([`strip.${patch.historyStrip.session}`, patch.historyStrip.open]);
  if (patch.canvas !== undefined) rows.push([`canvas.${patch.canvas.session}`, patch.canvas.layout]);
  if (patch.home !== undefined) rows.push(["home.query", patch.home]);
  if (patch.preview !== undefined) rows.push(["preview.window", patch.preview]);
  for (const [name, value] of namedSettings(patch.settings)) rows.push([`setting.${name}`, value]);
  return rows;
}

/** The stored rows read back. A row an older or newer build wrote in another shape is skipped, not trusted. */
export function readPrefs(rows: readonly { readonly key: string; readonly json: string }[]): UiPrefs {
  let prefs: UiPrefs = NO_PREFS;
  for (const { key, json } of rows) {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      continue;
    }
    if (key === "pane.sidebar" || key === "pane.inspector") {
      const w = width.safeParse(value);
      if (w.success) prefs = { ...prefs, panes: { ...prefs.panes, [key.slice(5)]: w.data } };
    } else if (key === "inspector.rail" && typeof value === "boolean") {
      prefs = { ...prefs, inspectorRail: value };
    } else if (key.startsWith("strip.") && typeof value === "boolean") {
      prefs = { ...prefs, historyStrip: { ...prefs.historyStrip, [key.slice(6)]: value } };
    } else if (key === "home.query") {
      const h = home.safeParse(value);
      if (h.success) prefs = { ...prefs, home: h.data };
    } else if (key === "preview.window") {
      const p = preview.safeParse(value);
      if (p.success) prefs = { ...prefs, preview: p.data };
    } else if (key.startsWith("setting.")) {
      const name = key.slice(8);
      const s = isSetting(name) ? SETTING[name].safeParse(value) : null;
      if (s?.success) prefs = { ...prefs, settings: { ...prefs.settings, [name]: s.data } };
    } else if (key.startsWith("canvas.")) {
      const l = layout.safeParse(value);
      if (l.success) prefs = { ...prefs, canvas: { ...prefs.canvas, [key.slice(7)]: l.data } };
    }
  }
  return prefs;
}

/** `prefs` with `patch` applied, as the server will store it, so the window needn't wait for the answer. */
export function applyPrefs(prefs: UiPrefs, patch: UiPrefsPatch): UiPrefs {
  return {
    panes: { ...prefs.panes, ...patch.panes },
    inspectorRail: patch.inspectorRail ?? prefs.inspectorRail,
    historyStrip: patch.historyStrip === undefined ? prefs.historyStrip : { ...prefs.historyStrip, [patch.historyStrip.session]: patch.historyStrip.open },
    canvas: patch.canvas === undefined ? prefs.canvas : { ...prefs.canvas, [patch.canvas.session]: patch.canvas.layout },
    home: patch.home ?? prefs.home,
    preview: patch.preview ?? prefs.preview,
    settings: { ...prefs.settings, ...Object.fromEntries(namedSettings(patch.settings)) },
  };
}
