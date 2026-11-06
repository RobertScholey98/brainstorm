import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  blockIdOf,
  framesOf,
  type AppearanceValue,
  type BlockId,
  type BlockView,
  type CanvasRect,
  type CanvasPin,
  type Feedback,
  type FeedbackId,
  type InapplicableOverride,
  type Pin,
  type PropName,
  type Props,
  type RobAction,
  type SessionId,
  type SessionListing,
  type SessionView,
  type SlotId,
  type VariantKey,
} from "../core/types";
import { applyPrefs, NO_PREFS, type CanvasLayout, type UiPrefs, type UiPrefsPatch } from "../core/prefs";
import type { Api } from "./api";
import { CanvasBar } from "./CanvasBar";
import { CanvasHost, type Placement } from "./CanvasHost";
import { FeedbackPanel, PinComposer, pinPlace } from "./Feedback";
import { HomeOverview } from "./Home";
import { useWiderThan, useWindowWidth } from "./hooks/use-mobile";
import { fitPanes, usePaneWidth, type PaneLimits } from "./hooks/use-pane-width";
import { Inspector, InspectorRail, InspectorSkeleton } from "./Inspector";
import { failedTitle, type Notice } from "./notice";
import { PendingOverrides } from "./overrides";
import { AppSidebar, HomePanel, SessionPanel } from "./Sidebar";
import { RequestDetail } from "./Regenerate";
import { SessionBar, TopBar } from "./TopBar";

/** How often an open brainstorm asks T3 whether its thread still exists, besides on window focus. */
const THREAD_CHECK_MS = 15_000;

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

type CanvasInteraction =
  | { readonly kind: "view" }
  | { readonly kind: "picking" }
  | { readonly kind: "composing"; readonly pin: Pin; readonly at: { readonly x: number; readonly y: number }; readonly rect: CanvasRect };

const NO_PLACEMENT: Placement = { placed: new Set(), detached: new Set() };

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
      setNotice(null);
    } else if (loaded.current) setNotice({ title: failedTitle("list"), detail: list.error.message });
    else setListError(list.error.message);
  }, [api]);

  useEffect(() => void refreshList(), [refreshList]);

  useEffect(() => {
    const controller = new AbortController();
    void api.events(
      (id) => {
        void refreshList();
        if (id === current.current) setRevision((r) => r + 1);
      },
      () => {
        void refreshList();
        setRevision((r) => r + 1);
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [api, refreshList]);

  const openSession = (id: SessionId) => setNav({ kind: "brainstorm", id, panel: "session" });
  const homePanel = (
    <HomePanel
      sessions={sessions}
      failed={listError !== null}
      current={sessionId}
      overview={nav.kind === "overview"}
      onOverview={() => setNav({ kind: "overview" })}
      onSession={openSession}
    />
  );
  const sidebar = (panel: ReactNode) => (
    <AppSidebar width={fitted.sidebar} limits={sidebarLimits} onWidth={setSidebarWidth}>
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
              <HomeOverview sessions={sessions} error={listError} onRetry={() => void refreshList()} onSession={openSession} />
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
            sidebar={sidebar}
            homePanel={nav.panel === "home" ? homePanel : null}
            onHome={() => setNav({ kind: "brainstorm", id: nav.id, panel: "home" })}
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
  sidebar,
  homePanel,
  onHome,
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
  sidebar: (panel: ReactNode) => ReactNode;
  /** Shown in place of the session panel while Rob looks for another brainstorm. */
  homePanel: ReactNode | null;
  onHome: () => void;
}) {
  const [view, setView] = useState<SessionView | null>(null);
  // A failed setting is named by its control's label, read when the failure comes back.
  const blocksNow = useRef<readonly BlockView[]>([]);
  blocksNow.current = view?.iteration?.blocks ?? [];
  // Selection is a slot, so switching variants keeps the controls on the slot's new block.
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(layout?.slot ?? null);
  const [canvasView, setCanvasView] = useState<CanvasLayout["view"]>(layout?.view ?? "stage");
  const [blockErrors, setBlockErrors] = useState<ReadonlyMap<BlockId, string>>(new Map());
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: "view" });
  const [placement, setPlacement] = useState<Placement>(NO_PLACEMENT);
  const [focusedFeedback, setFocusedFeedback] = useState<FeedbackId | null>(null);
  const [hoveredFeedback, setHoveredFeedback] = useState<FeedbackId | null>(null);
  const [zooms, setZooms] = useState<Readonly<Record<string, number>>>({});
  const [pulse, setPulse] = useState<{ id: FeedbackId; seq: number } | null>(null);
  const canvasArea = useRef<HTMLElement>(null);

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

  const iteration = view?.iteration ?? null;
  const slots = iteration?.slots ?? [];
  const blocks = iteration?.blocks ?? [];
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
      if (b !== undefined) out[b.id] = pending.effective(b.id, b.effectiveProps);
    }
    return out;
  }, [frames, blocks, pending, pendingVersion]);

  const onSet = useCallback((block: BlockView, prop: PropName, value: AppearanceValue) => pending.set(block.id, prop, value), [pending]);
  const onReset = useCallback((block: BlockView, prop: PropName) => pending.reset(block.id, prop), [pending]);
  const onDismiss = (o: InapplicableOverride) => void send({ kind: "dismiss_inapplicable", blockId: o.override.blockId, prop: o.override.prop });
  const onVariant = (slotId: SlotId, variant: VariantKey) => {
    setSelectedSlot(slotId);
    void send({ kind: "select_variant", slot: slotId, variant });
  };
  const onSelectBlock = useCallback(
    (blockId: BlockId) => setSelectedSlot((blocks.find((b) => b.id === blockId)?.slot ?? null) as SlotId | null),
    [blocks],
  );
  const onBlockError = useCallback((blockId: BlockId, message: string) => setBlockErrors((m) => new Map(m).set(blockId, message)), []);

  const feedback = view?.feedback ?? [];
  const pins = useMemo<CanvasPin[]>(() => feedback.map((f) => ({ id: f.id, pin: f.pin, status: f.status.state })), [feedback]);
  const activeBlocks = useMemo(() => new Set(frames.map((f) => f.blockId)), [frames]);

  useEffect(() => {
    if (interaction.kind !== "picking") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setInteraction({ kind: "view" });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interaction.kind]);

  const onPicked = useCallback(
    (pin: Pin, at: { x: number; y: number }, rect: CanvasRect) => {
      onSelectBlock(pin.blockId);
      setInteraction({ kind: "composing", pin, at, rect });
    },
    [onSelectBlock],
  );
  const onPinClicked = useCallback(
    (id: FeedbackId) => {
      const f = feedback.find((x) => x.id === id);
      if (f !== undefined) onSelectBlock(f.pin.blockId);
      setFocusedFeedback(id);
    },
    [feedback, onSelectBlock],
  );
  const openFeedback = (f: Feedback) => {
    const block = blocks.find((b) => b.id === f.pin.blockId);
    if (block !== undefined && !activeBlocks.has(block.id)) onVariant(block.slot, block.variant);
    else if (block !== undefined) setSelectedSlot(block.slot);
    setFocusedFeedback(f.id);
    setPulse((p) => ({ id: f.id, seq: (p?.seq ?? 0) + 1 }));
  };
  const saveComment = async (pin: Pin, text: string) => {
    if ((await send({ kind: "add_feedback", pin, text })) !== null) setInteraction({ kind: "view" });
  };

  const exportHtml = async () => {
    const result = await api.exportHtml(sessionId);
    if (result.ok) clearNotice();
    else showNotice({ title: failedTitle("export"), detail: result.error.message });
    return result.ok ? result.data : null;
  };

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
          selected={selectedBlock?.id ?? null}
          send={send}
          exportHtml={exportHtml}
          panel={{ open: !inspector.rail, onToggle: () => inspector.onRail(!inspector.rail) }}
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
            picking={interaction.kind === "picking"}
            onSlot={setSelectedSlot}
            onView={setCanvasView}
            onCancelPick={() => setInteraction({ kind: "view" })}
          />
        )}
        <section
          ref={canvasArea}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas"
          aria-label="Canvas"
          data-canvas-region
          data-canvas-view={iteration === null ? undefined : shownView}
        >
        {iteration === null ? (
          <WaitingEmpty loading={view === null} />
        ) : (
          <CanvasHost
            blocks={blocks}
            frames={frames}
            props={frameProps}
            selected={selectedBlock?.id ?? null}
            stage={stage}
            mode={interaction.kind === "picking" ? "pin" : "view"}
            pins={pins}
            focused={focusedFeedback}
            hovered={hoveredFeedback}
            pulse={pulse}
            onSelect={onSelectBlock}
            onBlockError={onBlockError}
            onPicked={onPicked}
            onPinClicked={onPinClicked}
            onPlacement={setPlacement}
            onZooms={setZooms}
          />
        )}
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
        {toast}
        </section>
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
          block={selectedBlock}
          props={selectedBlock === null ? null : (frameProps[selectedBlock.id] ?? null)}
          error={selectedBlock === null ? null : (blockErrors.get(selectedBlock.id) ?? null)}
          onSet={onSet}
          onReset={onReset}
          onDismiss={onDismiss}
        >
          <FeedbackPanel
            feedback={feedback}
            blocks={blocks}
            place={(f) => pinPlace(f, blocks, activeBlocks, placement)}
            canPin={iteration !== null}
            picking={interaction.kind === "picking"}
            focused={focusedFeedback}
            onHover={setHoveredFeedback}
            onPickToggle={() => setInteraction((i) => (i.kind === "picking" ? { kind: "view" } : { kind: "picking" }))}
            onOpen={openFeedback}
            send={send}
          />
        </Inspector>
      )}
    </Shell>
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
      {/* An empty bar, so the card keeps its top rule and the Inspector's header still meets it across the seam. */}
      <div className="h-10 shrink-0 border-b bg-card" data-canvas-bar />
      <Empty className="rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Loader2 aria-hidden className="animate-spin text-accent" />
          </EmptyMedia>
          <EmptyTitle>Waiting for the agent's first commit</EmptyTitle>
          <EmptyDescription>Blocks appear here as soon as it lands.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
