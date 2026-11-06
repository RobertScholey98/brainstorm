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
  /** Keyed by SessionId. A brainstorm with no entry opens on the stage at its first slot. */
  readonly canvas: Readonly<Record<string, CanvasLayout>>;
  /** How home is filtered and sorted. The search text isn't kept: it answers one question, not a standing view. */
  readonly home: HomeQuery;
};

/** Which brainstorms home shows. `attention` is any that needs Rob: a lost thread, or a request that stopped for him. */
export type HomeStatus = "active" | "attention" | "settled" | "all";
export type HomeSort = "recent" | "created" | "title";
/** `projects` empty is every project. */
export type HomeQuery = { readonly status: HomeStatus; readonly projects: readonly ProjectId[]; readonly sort: HomeSort };
export const DEFAULT_HOME: HomeQuery = { status: "active", projects: [], sort: "recent" };

/** The stage shows one slot at a time; the board shows every slot side by side. */
export type CanvasLayout = { readonly view: "stage" | "board"; readonly slot: SlotId | null };

export type UiPrefsPatch = {
  readonly panes?: { readonly sidebar?: number; readonly inspector?: number };
  readonly inspectorRail?: boolean;
  readonly canvas?: { readonly session: SessionId; readonly layout: CanvasLayout };
  readonly home?: HomeQuery;
};

export const NO_PREFS: UiPrefs = { panes: { sidebar: null, inspector: null }, inspectorRail: false, canvas: {}, home: DEFAULT_HOME };

const width = z.number().int().min(120).max(1200);
const layout = z.strictObject({ view: z.enum(["stage", "board"]), slot: zBranded(z.string(), parseSlotId, "slot id").nullable() });
const home: z.ZodType<HomeQuery> = z.strictObject({
  status: z.enum(["active", "attention", "settled", "all"]),
  projects: z.array(z.string().min(1).max(200).transform((p) => p as ProjectId)).max(500),
  sort: z.enum(["recent", "created", "title"]),
});

export const uiPrefsPatch: z.ZodType<UiPrefsPatch> = z.strictObject({
  panes: z.strictObject({ sidebar: width.optional(), inspector: width.optional() }).optional(),
  inspectorRail: z.boolean().optional(),
  canvas: z.strictObject({ session: zBranded(z.string(), parseSessionId, "session id"), layout }).optional(),
  home: home.optional(),
});

/** One stored row per preference, so changing one never rewrites another. */
export function prefRows(patch: UiPrefsPatch): [key: string, value: unknown][] {
  const rows: [string, unknown][] = [];
  if (patch.panes?.sidebar !== undefined) rows.push(["pane.sidebar", patch.panes.sidebar]);
  if (patch.panes?.inspector !== undefined) rows.push(["pane.inspector", patch.panes.inspector]);
  if (patch.inspectorRail !== undefined) rows.push(["inspector.rail", patch.inspectorRail]);
  if (patch.canvas !== undefined) rows.push([`canvas.${patch.canvas.session}`, patch.canvas.layout]);
  if (patch.home !== undefined) rows.push(["home.query", patch.home]);
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
    } else if (key === "home.query") {
      const h = home.safeParse(value);
      if (h.success) prefs = { ...prefs, home: h.data };
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
    canvas: patch.canvas === undefined ? prefs.canvas : { ...prefs.canvas, [patch.canvas.session]: patch.canvas.layout },
    home: patch.home ?? prefs.home,
  };
}
