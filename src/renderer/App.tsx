import { AppWindow, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toast } from "@/components/ui/toast";
import { TooltipAction, TooltipLabel, TooltipProvider } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import {
  blockIdOf,
  framesOf,
  type AppearanceValue,
  type BlockId,
  type BlockView,
  type CanvasRect,
  type CanvasPin,
  type ContentHash,
  type Feedback,
  type FeedbackId,
  type ForkInput,
  type InapplicableOverride,
  type IterationN,
  type IterationView,
  type Pin,
  type PropName,
  type Props,
  type RobAction,
  type SessionId,
  type SessionListing,
  type SessionView,
  type SlotId,
  type SlotView,
  type VariantKey,
} from "../core/types";
import { applyPrefs, NO_PREFS, stripOpen, type CanvasLayout, type PreviewPrefs, type UiPrefs, type UiPrefsPatch } from "../core/prefs";
import type { Api } from "./api";
import { CanvasBar } from "./CanvasBar";
import { CanvasHost, type FeedbackCue, type Placement } from "./CanvasHost";
import { FeedbackPanel, PinComposer, pinPlace } from "./Feedback";
import { Filmstrip, FilmstripSkeleton, PastBar } from "./History";
import { HeldBar } from "./HeldBar";
import { PICK_HINTS } from "./headerAction";
import { HomeOverview } from "./Home";
import { useWiderThan, useWindowWidth } from "./hooks/use-mobile";
import { fitPanes, usePaneWidth, type PaneLimits } from "./hooks/use-pane-width";
import { Inspector, InspectorRail, InspectorSkeleton } from "./Inspector";
import { previewWindow, PreviewLink, type MirrorScene, type ToMain } from "./mirror";
import { failedTitle, type Notice } from "./notice";
import { PendingOverrides } from "./overrides";
import { PresentControls } from "./PresentControls";
import { WAITING } from "./Preview";
import { AppSidebar, HomePanel, SessionPanel } from "./Sidebar";
import { RequestDetail } from "./Regenerate";
import { settleUndoes, useSettleShortcut } from "./settle";
import { SessionBar, TopBar } from "./TopBar";
import { VaryComposer, VarySection } from "./Vary";
import { blockedMessage } from "../core/machines";
import type { AppUpdateState } from "../core/appUpdate";

/** How often an open brainstorm asks T3 whether its thread still exists, besides on window focus. */
const THREAD_CHECK_MS = 15_000;
/** How long a new variant shows before it counts as seen, so its mark doesn't vanish the moment Rob opens it. */
const SEEN_MS = 1500;

/** Below 1280 px the sidebar starts narrower, so the canvas keeps room for a second frame. */
const SIDEBAR_WIDE: PaneLimits = { fallback: 288, min: 200, max: 400 };
const SIDEBAR_NARROW: PaneLimits = { ...SIDEBAR_WIDE, fallback: 240 };
const INSPECTOR: PaneLimits = { fallback: 280, min: 240, max: 480 };
/** The collapsed Inspector, `InspectorRail`'s w-10. */
const RAIL = 40;

/**
 * What the window shows. An open brainstorm keeps its canvas while the sidebar shows the home list, so going back to
 * pick another one doesn't throw away the one on screen.
 */
type Nav = { readonly kind: "overview" } | { readonly kind: "brainstorm"; readonly id: SessionId; readonly panel: "session" | "home" };

type Picked = { readonly pin: Pin; readonly at: { readonly x: number; readonly y: number }; readonly rect: CanvasRect };

/** Pin comment and Vary share the canvas's pick mode; each opens its own popover where Rob picked. */
type CanvasInteraction =
  | { readonly kind: "view" }
  | { readonly kind: "picking"; readonly for: "comment" | "vary" }
  | ({ readonly kind: "composing" } & Picked)
  | ({ readonly kind: "varying" } & Picked);

/**
 * A past iteration on the canvas, read-only. Rob's picks there change only what shows, never the stored slot choice,
 * and the Fork popover forks what shows. `iteration` is null while it loads.
 */
type Past = { readonly n: IterationN; readonly iteration: IterationView | null; readonly picks: Readonly<Record<string, VariantKey>> };

const NO_PLACEMENT: Placement = { placed: new Set(), detached: new Set() };
const NO_SLOTS: readonly SlotView[] = [];
const NO_BLOCKS: readonly BlockView[] = [];
const NO_PINS: readonly CanvasPin[] = [];

/** The preview window as the open brainstorm sees it (ADR 007): the link to it, whether it is open, Hold, and its prefs. */
type PreviewHandle = {
  readonly link: PreviewLink;
  readonly open: boolean;
  readonly hold: boolean;
  /** What the preview window is held on, such as "The wheel · Slot reel", while it is held. */
  readonly heldOn: string | null;
  readonly prefs: PreviewPrefs;
  readonly onPrefs: (prefs: PreviewPrefs) => void;
};

/** The window waits for the stored layout before its first paint, so a remembered width never jumps into place. */
export function App({ api }: { api: Api }) {
  const [prefs, setPrefs] = useState<UiPrefs | null>(null);
  useEffect(() => void api.prefs().then((r) => setPrefs(r.ok ? r.data : NO_PREFS)), [api]);
  const savePrefs = useCallback(
    (patch: UiPrefsPatch) => {
      setPrefs((p) => applyPrefs(p ?? NO_PREFS, patch));
      // Not keeping a layout is no reason to interrupt Rob, so a failed save says nothing.
      void api.setPrefs(patch);
    },
    [api],
  );
  return prefs === null ? null : <Window api={api} prefs={prefs} savePrefs={savePrefs} />;
}

function Window({ api, prefs, savePrefs }: { api: Api; prefs: UiPrefs; savePrefs: (patch: UiPrefsPatch) => void }) {
  const [sessions, setSessions] = useState<readonly SessionListing[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [nav, setNav] = useState<Nav>({ kind: "overview" });
  const [revision, setRevision] = useState(0);
  // Each brainstorm's own count, so a change reloads that card's preview and no other.
  const [revisions, setRevisions] = useState<ReadonlyMap<SessionId, number>>(new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const sidebarLimits = useWiderThan(1280) ? SIDEBAR_WIDE : SIDEBAR_NARROW;
  const [sidebarWidth, setSidebarWidth] = usePaneWidth(prefs.panes.sidebar, sidebarLimits, (sidebar) => savePrefs({ panes: { sidebar } }));
  const [inspectorWidth, setInspectorWidth] = usePaneWidth(prefs.panes.inspector, INSPECTOR, (inspector) => savePrefs({ panes: { inspector } }));
  const rail = prefs.inspectorRail;
  const fitted = fitPanes(
    { sidebar: sidebarWidth, inspector: rail ? RAIL : inspectorWidth },
    { sidebar: sidebarLimits.min, inspector: rail ? RAIL : INSPECTOR.min },
    useWindowWidth(),
  );
  // A notice stays until Rob closes it or the next call he makes succeeds.
  const clearNotice = useCallback(() => setNotice(null), []);

  // One link for the window's life, so a preview window keeps its place across brainstorms.
  const [link] = useState(() => new PreviewLink(prefs.preview.look));
  useEffect(() => () => link.close(), [link]);
  useEffect(() => link.setLook(prefs.preview.look), [link, prefs.preview.look]);
  const linked = useSyncExternalStore(link.subscribe, link.state);

  const sessionId = nav.kind === "brainstorm" ? nav.id : null;
  const current = useRef<SessionId | null>(null);
  current.current = sessionId;
  const loaded = useRef(false);

  const refreshList = useCallback(async () => {
    const list = await api.sessions();
    if (list.ok) {
      loaded.current = true;
      setSessions(list.data);
      setListError(null);
      // A refresh runs on every server event, so it clears only the notice it raised itself.
      setNotice((n) => (n?.title === failedTitle("list") ? null : n));
    } else if (loaded.current) setNotice({ title: failedTitle("list"), detail: list.error.message });
    else setListError(list.error.message);
  }, [api]);

  useEffect(() => void refreshList(), [refreshList]);

  const [update, setUpdate] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api.events(
      {
        onSession: (id) => {
          void refreshList();
          setRevisions((m) => new Map(m).set(id, (m.get(id) ?? 0) + 1));
          if (id === current.current) setRevision((r) => r + 1);
        },
        onUpdate: setUpdate,
        onOpen: () => {
          void refreshList();
          setRevisions((m) => new Map([...m].map(([id, n]) => [id, n + 1])));
          setRevision((r) => r + 1);
          // The stream only carries changes, so a (re)connect reads where the update is.
          void api.update().then((r) => r.ok && setUpdate(r.data));
        },
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [api, refreshList]);
  const installUpdate = useCallback(async () => {
    const result = await api.installUpdate();
    if (result.ok) setUpdate(result.data);
    else setNotice({ title: failedTitle("update"), detail: result.error.message });
  }, [api]);

  const toggleSettled = useCallback(
    async (s: SessionListing) => {
      const settle = !settleUndoes(s);
      const result = await api.settle(s.id, settle);
      if (!result.ok) {
        setNotice({ title: failedTitle(settle ? "settle" : "unsettle"), detail: result.error.message });
        return;
      }
      setNotice(null);
      setSessions((list) => list?.map((x) => (x.id === s.id ? result.data : x)) ?? list);
    },
    [api],
  );
  useSettleShortcut(sessions, sessionId, (s) => void toggleSettled(s));

  const openSession = (id: SessionId) => setNav({ kind: "brainstorm", id, panel: "session" });
  const homePanel = (
    <HomePanel
      sessions={sessions}
      failed={listError !== null}
      current={sessionId}
      overview={nav.kind === "overview"}
      onOverview={() => setNav({ kind: "overview" })}
      onSession={openSession}
      onSettle={(s) => void toggleSettled(s)}
    />
  );
  const sidebar = (panel: ReactNode) => (
    <AppSidebar width={fitted.sidebar} limits={sidebarLimits} onWidth={setSidebarWidth} update={update} onInstallUpdate={() => void installUpdate()}>
      {panel}
    </AppSidebar>
  );
  const listing = sessions?.find((s) => s.id === sessionId);
  const toast = notice !== null && <Toast heading={notice.title} message={notice.detail} onClose={clearNotice} />;

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden" style={{ "--sidebar-width": `${fitted.sidebar}px` } as CSSProperties}>
        {nav.kind === "overview" ? (
          <Shell
            sidebar={sidebar(homePanel)}
            // The overview carries its own page heading, so the header holds only the window's controls.
            bar={<TopBar />}
          >
            <section className="relative min-w-0 flex-1 overflow-hidden bg-canvas" aria-label="Brainstorms" data-canvas-region>
              <HomeOverview
                sessions={sessions}
                error={listError}
                onRetry={() => void refreshList()}
                onSession={openSession}
                onSettle={(s) => void toggleSettled(s)}
                revisions={revisions}
                loadPreview={api.preview}
                query={prefs.home}
                onQuery={(home) => savePrefs({ home })}
              />
              {toast}
            </section>
          </Shell>
        ) : (
          <SessionWorkspace
            key={nav.id}
            api={api}
            sessionId={nav.id}
            title={listing?.title ?? ""}
            project={listing === undefined ? null : (listing.projectName ?? "Other project")}
            revision={revision}
            showNotice={setNotice}
            clearNotice={clearNotice}
            toast={toast}
            layout={prefs.canvas[nav.id]}
            onLayout={(layout) => savePrefs({ canvas: { session: nav.id, layout } })}
            inspector={{ width: fitted.inspector, onWidth: setInspectorWidth, rail, onRail: (inspectorRail) => savePrefs({ inspectorRail }) }}
            history={{
              choice: prefs.historyStrip[nav.id],
              latest: listing?.latest ?? null,
              onChoose: (open) => savePrefs({ historyStrip: { session: nav.id, open } }),
            }}
            sidebar={sidebar}
            preview={{ link, open: linked.open, hold: linked.hold, heldOn: linked.heldOn, prefs: prefs.preview, onPrefs: (preview) => savePrefs({ preview }) }}
            homePanel={nav.panel === "home" ? homePanel : null}
            onHome={() => setNav({ kind: "brainstorm", id: nav.id, panel: "home" })}
            onOpen={(id) => (id === null ? setNav({ kind: "overview" }) : openSession(id))}
          />
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}

function Shell({ sidebar, bar, strip, children }: { sidebar: ReactNode; bar: ReactNode; strip?: ReactNode; children: ReactNode }) {
  return (
    <>
      {sidebar}
      <SidebarInset header={bar}>
        {strip}
        <div className="flex min-h-0 flex-1">{children}</div>
      </SidebarInset>
    </>
  );
}

/** One open brainstorm. It is keyed by session, so everything here starts fresh when another one opens. */
function SessionWorkspace({
  api,
  sessionId,
  title,
  project,
  revision,
  showNotice,
  clearNotice,
  toast,
  layout,
  onLayout,
  inspector,
  history,
  sidebar,
  preview,
  homePanel,
  onHome,
  onOpen,
}: {
  api: Api;
  sessionId: SessionId;
  title: string;
  project: string | null;
  revision: number;
  showNotice: (notice: Notice) => void;
  clearNotice: () => void;
  /** The failure notice, drawn in the canvas region so it stays off the Inspector. */
  toast: ReactNode;
  /** How Rob left this brainstorm's canvas, if he has opened it before. */
  layout: CanvasLayout | undefined;
  onLayout: (layout: CanvasLayout) => void;
  inspector: { width: number; onWidth: (width: number) => void; rail: boolean; onRail: (rail: boolean) => void };
  /**
   * Whether Rob last opened or shut this brainstorm's history strip, kept in `ui_pref`. `latest` is the listing's newest
   * iteration, which counts its iterations while the view loads.
   */
  history: { choice: boolean | undefined; latest: IterationN | null; onChoose: (open: boolean) => void };
  sidebar: (panel: ReactNode) => ReactNode;
  preview: PreviewHandle;
  /** Shown in place of the session panel while Rob looks for another brainstorm. */
  homePanel: ReactNode | null;
  onHome: () => void;
  /** Opens another brainstorm, or home with null: a fork, its parent, or home after a discard. */
  onOpen: (id: SessionId | null) => void;
}) {
  const [view, setView] = useState<SessionView | null>(null);
  // A failed setting is named by its control's label, read when the failure comes back.
  const blocksNow = useRef<readonly BlockView[]>([]);
  // Selection is a slot, so switching variants keeps the controls on the slot's new block.
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(layout?.slot ?? null);
  const [canvasView, setCanvasView] = useState<CanvasLayout["view"]>(layout?.view ?? "stage");
  // Keyed by content, since a past iteration's block has the latest one's id and maybe other code.
  const [blockErrors, setBlockErrors] = useState<ReadonlyMap<ContentHash, string>>(new Map());
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: "view" });
  const [past, setPast] = useState<Past | null>(null);
  const [placement, setPlacement] = useState<Placement>(NO_PLACEMENT);
  const [focus, setFocus] = useState<FeedbackCue | null>(null);
  const focusedFeedback = focus?.id ?? null;
  const [hoveredFeedback, setHoveredFeedback] = useState<FeedbackId | null>(null);
  const [hoveredPin, setHoveredPin] = useState<FeedbackId | null>(null);
  const [zooms, setZooms] = useState<Readonly<Record<string, number>>>({});
  const [pulse, setPulse] = useState<FeedbackCue | null>(null);
  const canvasArea = useRef<HTMLElement>(null);
  // Present (ADR 007): the canvas region fills the screen, and the slot on the stage fills it.
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    void api.view(sessionId).then((next) => (next.ok ? setView(next.data) : showNotice({ title: failedTitle("load"), detail: next.error.message })));
  }, [api, sessionId, revision, showNotice]);

  // A thread can vanish while nothing is in flight, so the open brainstorm asks T3 now and then. A failed check
  // changes nothing on screen, so it shows no notice.
  useEffect(() => {
    const check = () => void api.act(sessionId, { kind: "check_thread" }).then((r) => r.ok && setView(r.data));
    const timer = setInterval(check, THREAD_CHECK_MS);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [api, sessionId]);

  const send = useCallback(
    async (action: RobAction): Promise<SessionView | null> => {
      const result = await api.act(sessionId, action);
      if (!result.ok) {
        showNotice({ title: failedTitle(action, blocksNow.current), detail: result.error.message });
        return null;
      }
      clearNotice();
      setView(result.data);
      return result.data;
    },
    [api, sessionId, showNotice, clearNotice],
  );
  const pending = useMemo(() => new PendingOverrides(send), [send]);
  const pendingVersion = useSyncExternalStore(pending.subscribe, pending.version);
  useEffect(() => () => pending.flush(), [pending]);
  useEffect(() => {
    if (view !== null) pending.settle(view);
  }, [pending, view]);

  const latest = view?.iteration ?? null;
  const showLatest = useCallback(() => setPast(null), []);
  // A stored iteration never changes, so each is fetched once.
  const fetched = useRef(new Map<IterationN, IterationView>());
  const showIteration = useCallback(
    (n: IterationN) => {
      setInteraction({ kind: "view" });
      if (n === latest?.n) return setPast(null);
      const known = fetched.current.get(n) ?? null;
      setPast((p) => (p?.n === n ? p : { n, iteration: known, picks: {} }));
      if (known !== null) return;
      void api.iteration(sessionId, n).then((r) => {
        if (!r.ok) {
          setPast(null);
          return showNotice({ title: failedTitle("history"), detail: r.error.message });
        }
        fetched.current.set(n, r.data);
        setPast((p) => (p?.n === n ? { ...p, iteration: r.data } : p));
      });
    },
    [api, sessionId, latest?.n, showNotice],
  );
  // While a past iteration loads, the canvas keeps what it showed, so its frame isn't torn down and built again.
  const shown = useRef<IterationView | null>(null);
  // The past is read-only, so what shows there is the stored iteration with Rob's picks laid over its slots.
  const iteration = useMemo<IterationView | null>(() => {
    if (past === null) return latest;
    if (past.iteration === null) return shown.current;
    return { ...past.iteration, slots: past.iteration.slots.map((s) => ({ ...s, active: past.picks[s.id] ?? s.active })) };
  }, [past, latest]);
  useEffect(() => {
    shown.current = iteration;
  }, [iteration]);
  const readOnly = past === null ? null : past.n;
  const slots = iteration?.slots ?? NO_SLOTS;
  const blocks = iteration?.blocks ?? NO_BLOCKS;
  blocksNow.current = blocks;
  const slot = slots.find((s) => s.id === selectedSlot) ?? slots[0] ?? null;
  const selectedBlock = slot === null ? null : (blocks.find((b) => b.id === blockIdOf(slot.id, slot.active)) ?? null);
  // With one slot the board and the stage are the same, so the bar offers no switch and the canvas shows the stage.
  const shownView = slots.length > 1 ? canvasView : "stage";
  const stage = shownView === "stage" ? (slot?.id ?? null) : null;
  const saved = useRef(onLayout);
  saved.current = onLayout;
  useEffect(() => {
    if (slot !== null) saved.current({ view: canvasView, slot: slot.id });
  }, [canvasView, slot?.id]);

  const frames = useMemo(() => framesOf(slots), [slots]);
  const frameProps = useMemo(() => {
    const out: Record<string, Props> = {};
    for (const f of frames) {
      const b = blocks.find((x) => x.id === f.blockId);
      if (b !== undefined) out[b.id] = past === null ? pending.effective(b.id, b.effectiveProps) : b.effectiveProps;
    }
    return out;
  }, [frames, blocks, pending, pendingVersion, past]);

  const onSet = useCallback((block: BlockView, prop: PropName, value: AppearanceValue) => pending.set(block.id, prop, value), [pending]);
  const onReset = useCallback((block: BlockView, prop: PropName) => pending.reset(block.id, prop), [pending]);
  const onDismiss = (o: InapplicableOverride) => void send({ kind: "dismiss_inapplicable", blockId: o.override.blockId, prop: o.override.prop });
  const onVariant = (slotId: SlotId, variant: VariantKey) => {
    setSelectedSlot(slotId);
    if (past !== null) return setPast({ ...past, picks: { ...past.picks, [slotId]: variant } });
    void send({ kind: "select_variant", slot: slotId, variant });
  };
  const onSelectBlock = useCallback(
    (blockId: BlockId) => setSelectedSlot((blocks.find((b) => b.id === blockId)?.slot ?? null) as SlotId | null),
    [blocks],
  );
  const onBlockError = useCallback((blockId: BlockId, message: string) => {
    const hash = blocksNow.current.find((b) => b.id === blockId)?.hash;
    if (hash !== undefined) setBlockErrors((m) => new Map(m).set(hash, message));
  }, []);

  const feedback = view?.feedback ?? [];
  // Pins belong to the latest iteration; the past shows its blocks as they were, unpinned.
  const pins = useMemo<readonly CanvasPin[]>(() => (past !== null ? NO_PINS : feedback.map((f) => ({ id: f.id, pin: f.pin, status: f.status.state }))), [feedback, past]);
  const activeBlocks = useMemo(() => new Set(frames.map((f) => f.blockId)), [frames]);

  // A new variant counts as seen once it has been on the canvas for a moment: on the stage, or anywhere on the board.
  const unseen = past !== null ? [] : blocks.filter((b) => b.isNew && activeBlocks.has(b.id) && (stage === null || b.slot === stage)).map((b) => b.id);
  const unseenKey = unseen.join(" ");
  useEffect(() => {
    const [first, ...rest] = unseen;
    if (first === undefined) return;
    const timer = setTimeout(() => void send({ kind: "mark_seen", blocks: [first, ...rest] }), SEEN_MS);
    return () => clearTimeout(timer);
  }, [unseenKey, send]);

  const [stuckPick, setStuckPick] = useState<"comment" | "vary" | null>(null);
  const stepSlot = useCallback(
    (by: -1 | 1) => {
      const next = slots[slots.findIndex((s) => s.id === slot?.id) + by];
      if (next !== undefined) setSelectedSlot(next.id);
    },
    [slots, slot?.id],
  );

  const present = useCallback(() => {
    const area = canvasArea.current;
    if (area === null || iteration === null || document.fullscreenElement !== null) return;
    setInteraction({ kind: "view" });
    area.requestFullscreen().catch((e: unknown) =>
      showNotice({ title: "Couldn't present full screen", detail: e instanceof Error ? e.message : String(e) }),
    );
  }, [iteration, showNotice]);

  useEffect(() => {
    const onChange = () => setPresenting(document.fullscreenElement !== null && document.fullscreenElement === canvasArea.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // While presenting, Escape and F5 leave and left and right step through the slots, before any other key handler, since
  // nothing else on screen can take them. F5 presents from anywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (presenting) {
        if (e.key === "Escape" || e.key === "F5") {
          e.preventDefault();
          void document.exitFullscreen().catch(() => {});
        } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey) {
          e.preventDefault();
          stepSlot(e.key === "ArrowLeft" ? -1 : 1);
        }
      } else if (e.key === "F5") {
        e.preventDefault();
        present();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [presenting, stepSlot, present]);

  // Escape backs out one layer at a time: an open popover closes itself, then a pick or a popover on the canvas, then
  // the past.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-slot=popover-content]") !== null) return;
      if (stuckPick !== null) return setStuckPick(null);
      if (interaction.kind === "picking") return setInteraction({ kind: "view" });
      if (interaction.kind === "view" && past !== null) showLatest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interaction.kind, past, showLatest, stuckPick]);

  const onPicked = useCallback(
    (pin: Pin, at: { x: number; y: number }, rect: CanvasRect) => {
      onSelectBlock(pin.blockId);
      setInteraction((i) => ({ kind: i.kind === "picking" && i.for === "vary" ? "varying" : "composing", pin, at, rect }));
    },
    [onSelectBlock],
  );
  const onPinClicked = useCallback(
    (id: FeedbackId) => {
      const f = feedback.find((x) => x.id === id);
      if (f !== undefined) onSelectBlock(f.pin.blockId);
      setFocus((p) => ({ id, seq: (p?.seq ?? 0) + 1 }));
    },
    [feedback, onSelectBlock],
  );
  const openFeedback = (f: Feedback) => {
    const block = blocks.find((b) => b.id === f.pin.blockId);
    if (block !== undefined && !activeBlocks.has(block.id)) onVariant(block.slot, block.variant);
    else if (block !== undefined) setSelectedSlot(block.slot);
    setFocus((p) => ({ id: f.id, seq: (p?.seq ?? 0) + 1 }));
    setPulse((p) => ({ id: f.id, seq: (p?.seq ?? 0) + 1 }));
  };
  const saveComment = async (pin: Pin, text: string) => {
    if ((await send({ kind: "add_feedback", pin, text })) !== null) setInteraction({ kind: "view" });
  };
  const sendVary = async (pin: Pin, count: number, direction: string | null) => {
    if ((await send({ kind: "vary", target: pin, count, direction })) !== null) setInteraction({ kind: "view" });
  };
  // With the canvas away in a clean preview window, nothing can take a pick, so none starts: the canvas region says why
  // and offers the way on, and the bar and Pin comment stay as they were.
  const togglePick = (kind: "comment" | "vary") => {
    if (preview.open && !preview.prefs.here && preview.prefs.look === "clean") return setStuckPick((s) => (s === kind ? null : kind));
    setStuckPick(null);
    setInteraction((i) => (i.kind === "picking" && i.for === kind ? { kind: "view" } : { kind: "picking", for: kind }));
  };
  const unrendered = selectedBlock !== null && blockErrors.has(selectedBlock.hash) ? "The block didn't render, so there's nothing to pick" : null;
  const varyBlocked =
    iteration === null
      ? "There is nothing on the canvas to vary yet"
      : past !== null
        ? "Back to latest to vary an element"
        : unrendered !== null
          ? unrendered
          : view !== null && !view.regenerate.ok
          ? blockedMessage(view.regenerate.reason, view.request?.request.n)
          : null;

  // The preview window mirrors this canvas (ADR 007).
  const pinBlocked = iteration === null ? "There is nothing on the canvas to pin yet" : past !== null ? "Back to latest to pin a comment" : unrendered;
  const picking = interaction.kind === "picking" ? interaction.for : null;
  const scene = useMemo<MirrorScene>(
    () => ({
      session: sessionId,
      title: view?.session.title ?? title,
      slots,
      frames,
      props: frameProps,
      selected: selectedBlock?.id ?? null,
      slot: slot?.id ?? null,
      view: shownView,
      picking,
      pins,
      focused: focusedFeedback,
      hovered: hoveredFeedback,
      past: readOnly,
      pinBlocked,
    }),
    [sessionId, view?.session.title, title, slots, frames, frameProps, selectedBlock?.id, slot?.id, shownView, picking, pins, focusedFeedback, hoveredFeedback, readOnly, pinBlocked],
  );
  const { link } = preview;
  useEffect(() => link.blocks(blocks), [link, blocks]);
  useEffect(() => link.scene(scene), [link, scene]);
  useEffect(() => () => link.scene(null), [link]);
  useEffect(() => {
    if (pulse !== null) link.pulse(pulse.id, pulse.seq);
  }, [link, pulse]);
  const fromPreview = useRef<(m: ToMain) => void>(() => {});
  fromPreview.current = (m) => {
    switch (m.kind) {
      case "select_block":
        return onSelectBlock(m.blockId);
      case "pin_clicked":
        return onPinClicked(m.id);
      case "pin_hovered":
        return setHoveredPin(m.id);
      case "pick":
        if (m.for === null) return setInteraction((i) => (i.kind === "picking" ? { kind: "view" } : i));
        if (m.for === "comment" ? pinBlocked !== null : varyBlocked !== null) return;
        return setInteraction({ kind: "picking", for: m.for });
      case "picked":
        return setInteraction((i) => (i.kind === "picking" ? { kind: "view" } : i));
      case "slot":
        return setSelectedSlot(m.slot);
      case "step":
        return stepSlot(m.by);
      case "view":
        return setCanvasView(m.view);
      case "clean":
        return preview.onPrefs({ ...preview.prefs, look: "clean" });
    }
  };
  useEffect(() => link.onMessage((m) => fromPreview.current(m)), [link]);
  // With the canvas given to the preview window, this one keeps its frame under a cover, so pins still report placement.
  const away = preview.open && !preview.prefs.here && !presenting;
  useEffect(() => {
    if (!away || preview.prefs.look !== "clean") setStuckPick(null);
  }, [away, preview.prefs.look]);
  // The pointer moving in present shows how to leave again, as a video player shows its controls.
  const [presentPoke, setPresentPoke] = useState(0);
  const pokePresent = useCallback(() => setPresentPoke((n) => n + 1), []);

  const fork = async (input: ForkInput): Promise<boolean> => {
    const result = await api.fork(sessionId, input);
    if (!result.ok) {
      showNotice({ title: failedTitle("fork"), detail: result.error.message });
      return false;
    }
    clearNotice();
    onOpen(result.data.fork);
    return true;
  };

  const discard = async () => {
    const result = await api.discard(sessionId);
    if (!result.ok) return showNotice({ title: failedTitle("discard"), detail: result.error.message });
    clearNotice();
    onOpen(result.data.parent);
  };

  const exportHtml = async () => {
    const result = await api.exportHtml(sessionId);
    if (result.ok) clearNotice();
    else showNotice({ title: failedTitle("export"), detail: result.error.message });
    return result.ok ? result.data : null;
  };

  const loadStill = useCallback(
    (at: { n: IterationN; slot: SlotId | null }) => api.preview(sessionId, { n: at.n, ...(at.slot === null ? {} : { slot: at.slot }) }),
    [api, sessionId],
  );
  const showing = past?.n ?? latest?.n ?? null;
  const stripShown = stripOpen(history.choice, view?.history.iterations.length ?? history.latest ?? 0);
  const historyToggle = { open: stripShown, onToggle: () => history.onChoose(!stripShown) };
  const strip = stripShown && view !== null && showing !== null && view.history.iterations.length > 0;

  return (
    <Shell
      sidebar={sidebar(
        homePanel ?? (
          <SessionPanel
            view={view}
            slots={slots}
            blocks={blocks}
            blockErrors={blockErrors}
            onHome={onHome}
            onOpen={onOpen}
            selectedSlot={slot?.id ?? null}
            onSlot={setSelectedSlot}
            onVariant={onVariant}
          />
        ),
      )}
      bar={
        <SessionBar
          title={view?.session.title ?? title}
          project={project}
          view={view}
          iteration={iteration}
          past={readOnly}
          selected={selectedBlock?.id ?? null}
          blockErrors={blockErrors}
          send={send}
          fork={fork}
          exportHtml={exportHtml}
          panel={{ open: !inspector.rail, onToggle: () => inspector.onRail(!inspector.rail) }}
          // Pressed only while a strip shows: the loading strip, or the real one once there is an iteration to show.
          history={
            view !== null && view.history.iterations.length === 0
              ? { ...historyToggle, open: false, blocked: WAITING }
              : historyToggle
          }
          onDiscard={() => void discard()}
          onOpen={onOpen}
        />
      }
      strip={view !== null && <RequestDetail view={view} />}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {iteration !== null && (
          <CanvasBar
            slots={slots}
            current={slot?.id ?? null}
            view={shownView}
            zoom={slot === null ? null : (zooms[slot.id] ?? null)}
            picking={picking}
            onSlot={setSelectedSlot}
            onView={setCanvasView}
            onCancelPick={() => setInteraction({ kind: "view" })}
            {...(away ? { pickHint: PICK_HINTS.away } : {})}
            trailing={
              <PresentControls
                onPresent={present}
                open={preview.open}
                hold={preview.hold}
                heldOn={preview.heldOn}
                onHold={(hold) => link.setHold(hold)}
                prefs={preview.prefs}
                onPrefs={preview.onPrefs}
              />
            }
          />
        )}
        {past !== null && <PastBar n={past.n} onLatest={showLatest} />}
        <section
          ref={canvasArea}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas"
          aria-label="Canvas"
          data-canvas-region
          data-canvas-view={iteration === null ? undefined : shownView}
          data-canvas-iteration={iteration?.n}
          data-canvas-past={readOnly ?? undefined}
          data-presenting={presenting || undefined}
        >
        {iteration === null ? (
          <WaitingEmpty loading={view === null || past !== null} />
        ) : (
          <CanvasHost
            blocks={blocks}
            frames={frames}
            props={frameProps}
            selected={presenting ? null : (selectedBlock?.id ?? null)}
            stage={presenting ? (slot?.id ?? null) : stage}
            present={presenting}
            mode={interaction.kind === "picking" && !away ? "pin" : "view"}
            pins={presenting ? NO_PINS : pins}
            focused={focusedFeedback}
            hovered={hoveredFeedback}
            pulse={pulse}
            onSelect={onSelectBlock}
            onBlockError={onBlockError}
            onPicked={onPicked}
            onPinClicked={onPinClicked}
            onPinHovered={setHoveredPin}
            onPlacement={setPlacement}
            onZooms={setZooms}
            onPointer={pokePresent}
          />
        )}
        {away && iteration !== null && (
          <CanvasAway
            look={preview.prefs.look}
            hold={preview.hold}
            picking={picking !== null}
            stuck={stuckPick}
            onHere={() => {
              const kind = stuckPick;
              setStuckPick(null);
              preview.onPrefs({ ...preview.prefs, here: true });
              if (kind !== null) setInteraction({ kind: "picking", for: kind });
            }}
            onWorking={() => {
              const kind = stuckPick;
              setStuckPick(null);
              preview.onPrefs({ ...preview.prefs, look: "working" });
              if (kind !== null) setInteraction({ kind: "picking", for: kind });
            }}
            onDismiss={() => setStuckPick(null)}
          />
        )}
        {preview.open && preview.hold && !presenting && <HeldBar on={preview.heldOn} here="main" onRelease={() => link.setHold(false)} />}
        {presenting && <PresentHint several={slots.length > 1} poke={presentPoke} onLeave={() => void document.exitFullscreen().catch(() => {})} />}
        {interaction.kind === "composing" && (
          <PinComposer
            key={JSON.stringify(interaction)}
            pin={interaction.pin}
            at={interaction.at}
            rect={interaction.rect}
            block={blocks.find((b) => b.id === interaction.pin.blockId) ?? null}
            bounds={{ width: canvasArea.current?.clientWidth ?? 0, height: canvasArea.current?.clientHeight ?? 0 }}
            onSave={(text) => saveComment(interaction.pin, text)}
            onCancel={() => setInteraction({ kind: "view" })}
          />
        )}
        {interaction.kind === "varying" && (
          <VaryComposer
            key={JSON.stringify(interaction)}
            pin={interaction.pin}
            at={interaction.at}
            rect={interaction.rect}
            block={blocks.find((b) => b.id === interaction.pin.blockId) ?? null}
            slot={slots.find((s) => s.id === blocks.find((b) => b.id === interaction.pin.blockId)?.slot) ?? null}
            bounds={{ width: canvasArea.current?.clientWidth ?? 0, height: canvasArea.current?.clientHeight ?? 0 }}
            onSend={(count, direction) => sendVary(interaction.pin, count, direction)}
            onCancel={() => setInteraction({ kind: "view" })}
          />
        )}
        {toast}
        </section>
        {view === null && stripShown && <FilmstripSkeleton />}
        {strip && (
          <Filmstrip
            view={view}
            showing={showing}
            slot={slot?.id ?? null}
            revision={revision}
            loadStill={loadStill}
            onShow={showIteration}
            onOpen={onOpen}
          />
        )}
      </div>
      {view === null ? (
        <InspectorSkeleton width={inspector.width} />
      ) : inspector.rail ? (
        <InspectorRail open={feedback.filter((f) => f.status.state === "open").length} onExpand={() => inspector.onRail(false)} />
      ) : (
        <Inspector
          width={inspector.width}
          limits={INSPECTOR}
          onWidth={inspector.onWidth}
          view={view}
          blocks={blocks}
          readOnly={readOnly}
          block={selectedBlock}
          props={selectedBlock === null ? null : (frameProps[selectedBlock.id] ?? null)}
          error={selectedBlock === null ? null : (blockErrors.get(selectedBlock.hash) ?? null)}
          onSet={onSet}
          onReset={onReset}
          onDismiss={onDismiss}
        >
          <VarySection picking={picking === "vary"} open={interaction.kind === "varying"} blocked={varyBlocked} onPickToggle={() => togglePick("vary")} />
          <FeedbackPanel
            feedback={feedback}
            blocks={blocks}
            place={(f) => pinPlace(f, blocks, activeBlocks, placement)}
            canPin={iteration !== null && past === null && unrendered === null}
            past={past !== null}
            pinBlocked={past !== null ? "Back to latest to pin a comment" : (unrendered ?? undefined)}
            picking={picking === "comment"}
            composing={interaction.kind === "composing"}
            focused={focus}
            echoed={hoveredPin}
            onHover={setHoveredFeedback}
            onPickToggle={() => togglePick("comment")}
            onOpen={openFeedback}
            send={send}
          />
        </Inspector>
      )}
    </Shell>
  );
}

/**
 * The canvas region while the preview window has the canvas. The frame stays mounted under it, so pins still report
 * where they landed, and the slot bar above still chooses what the preview window shows.
 */
function CanvasAway({
  look,
  hold,
  picking,
  stuck,
  onHere,
  onWorking,
  onDismiss,
}: {
  look: PreviewPrefs["look"];
  hold: boolean;
  picking: boolean;
  /** A pick asked for while the preview window is clean, which never takes one since an audience may be watching it. */
  stuck: "comment" | "vary" | null;
  onHere: () => void;
  onWorking: () => void;
  onDismiss: () => void;
}) {
  const act = stuck === "vary" ? "vary" : "pin";
  const name = look === "clean" ? "Clean" : "Working";
  return (
    <div className="absolute inset-0 z-raised flex bg-canvas" data-canvas-away={stuck !== null ? "stuck" : picking ? "picking" : ""}>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AppWindow aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            {stuck !== null ? (act === "pin" ? "The Clean preview takes no pins" : "The Clean preview can't vary an element") : picking ? "Click an element in the preview" : "The canvas is in the preview window"}
          </EmptyTitle>
          <EmptyDescription>
            {stuck !== null
              ? `Clean keeps pins and tools hidden from your audience. Show the canvas here to ${act}, or switch the preview to Working, where your audience would see them too.`
              : picking
                ? "Esc or Cancel stops picking."
                : `It shows the ${name} look${hold ? ", held" : ", live"}. Choose slots and change settings here, and it follows.`}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          {stuck !== null ? (
            <>
              <Button variant="accent" onClick={onHere} data-away-here>
                Show canvas here
              </Button>
              <Button variant="outline" onClick={onWorking} data-away-working>
                Switch preview to Working
              </Button>
              <Button variant="ghost" onClick={onDismiss} data-away-dismiss>
                Not now
              </Button>
            </>
          ) : (
            <>
              {/* The canvas is in the other window, so that is the way on; bringing it back is the alternative. */}
              <Button variant="accent" onClick={() => previewWindow("open")} data-away-front>
                Bring preview to front
              </Button>
              <Button variant="outline" onClick={onHere} data-away-here>
                Show canvas here
              </Button>
            </>
          )}
        </EmptyContent>
      </Empty>
    </div>
  );
}

/** Whether present has shown its keys once since Brainstorm started: after that they wait for the pointer. */
let presentTaught = false;

/**
 * How to leave and step, at the top centre, clear of what a design keeps in its corners. It shows as present starts the
 * first time, and after that only while the pointer is near the top edge, as slideshow tools keep theirs, so pointing
 * at the design leaves the screen clean.
 */
function PresentHint({ several, poke, onLeave }: { several: boolean; poke: number; onLeave: () => void }) {
  const [shown, setShown] = useState(() => !presentTaught);
  const [over, setOver] = useState(false);
  useEffect(() => {
    presentTaught = true;
  }, []);
  useEffect(() => {
    if (poke > 0) setShown(true);
  }, [poke]);
  useEffect(() => {
    if (!shown || over) return;
    const timer = setTimeout(() => setShown(false), poke === 0 ? 3500 : 2000);
    return () => clearTimeout(timer);
  }, [shown, over, poke]);
  return (
    <div
      className="absolute top-6 left-1/2 z-toast flex -translate-x-1/2 items-center gap-1 transition-opacity duration-300 data-hidden:pointer-events-none data-hidden:opacity-0"
      data-hidden={shown ? undefined : ""}
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => setOver(false)}
      onPointerMove={() => setShown(true)}
      data-present-hint
    >
      <TooltipLabel>
        {several && (
          <span role="status" className="contents">
            <span className="font-medium" aria-label="Left and right arrow keys">
              ← →
            </span>
            change slot
          </span>
        )}
        <TooltipAction onClick={onLeave} aria-label="Exit present (Esc)" data-present-leave>
          Exit <Kbd tone="inverse">Esc</Kbd>
        </TooltipAction>
      </TooltipLabel>
    </div>
  );
}

/** While the brainstorm loads, the canvas shows the shape it will take: the slot bar, and one frame on the stage. */
function WaitingEmpty({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="flex size-full flex-col bg-canvas" aria-busy data-canvas-loading>
        {/* The bar as a brainstorm with slots lays it out: two arrows, the tabs, and the view switch at the end. */}
        <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2">
          <Skeleton className="size-6" />
          <Skeleton className="size-6" />
          <Skeleton className="ml-2 h-3.5 w-16" />
          <Skeleton className="ml-4 h-3.5 w-16" />
          <Skeleton className="ml-auto h-7 w-menu" />
        </div>
        {/* A frame as the stage draws one, at the phone width most brainstorms open with. */}
        <div className="flex min-h-0 flex-1 justify-center p-6">
          <div className="flex w-full max-w-frame flex-col gap-2">
            <Skeleton className="h-4.5 w-1/3" />
            <div className="grid flex-1 content-start gap-3 rounded-sm bg-card p-4 shadow-xs ring-1 ring-border">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex size-full flex-col bg-canvas">
      {/* The bar keeps the card's top rule, so the Inspector's header still meets it across the seam, and says why it is bare. */}
      <div className="flex h-10 shrink-0 items-center border-b bg-card px-4 text-sm text-fg-muted" data-canvas-bar>
        No slots yet
      </div>
      <Empty className="rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Loader2 aria-hidden className="animate-spin text-accent" />
          </EmptyMedia>
          <EmptyTitle>{WAITING}</EmptyTitle>
          <EmptyDescription>Blocks appear here as soon as it lands.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
