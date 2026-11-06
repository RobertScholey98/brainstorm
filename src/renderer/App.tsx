import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { overlaySurface } from "@/components/ui/overlay";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
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
import type { Api } from "./api";
import { CanvasHost, type Placement } from "./CanvasHost";
import { FeedbackPanel, PinComposer, pinPlace } from "./Feedback";
import { HomeOverview } from "./Home";
import { usePaneWidth, type PaneLimits } from "./hooks/use-pane-width";
import { Inspector, InspectorSkeleton } from "./Inspector";
import { PendingOverrides } from "./overrides";
import { AppSidebar, HomePanel, SessionPanel } from "./Sidebar";
import { RequestDetail } from "./Regenerate";
import { SessionBar, TopBar } from "./TopBar";

const NOTICE_MS = 6000;
/** How often an open brainstorm asks T3 whether its thread still exists, besides on window focus. */
const THREAD_CHECK_MS = 15_000;

const SIDEBAR: PaneLimits = { fallback: typeof innerWidth === "number" && innerWidth < 1280 ? 240 : 288, min: 200, max: 400 };
const INSPECTOR: PaneLimits = { fallback: 280, min: 240, max: 480 };

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

export function App({ api }: { api: Api }) {
  const [sessions, setSessions] = useState<readonly SessionListing[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [nav, setNav] = useState<Nav>({ kind: "overview" });
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = usePaneWidth("sidebar", SIDEBAR);

  const sessionId = nav.kind === "brainstorm" ? nav.id : null;
  const current = useRef<SessionId | null>(null);
  current.current = sessionId;
  const loaded = useRef(false);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const refreshList = useCallback(async () => {
    const list = await api.sessions();
    if (list.ok) {
      loaded.current = true;
      setSessions(list.data);
      setListError(null);
    } else if (loaded.current) setNotice(list.error.message);
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
      current={sessionId}
      overview={nav.kind === "overview"}
      onOverview={() => setNav({ kind: "overview" })}
      onSession={openSession}
    />
  );
  const sidebar = (panel: ReactNode) => (
    <AppSidebar width={sidebarWidth} limits={SIDEBAR} onWidth={setSidebarWidth}>
      {panel}
    </AppSidebar>
  );
  const listing = sessions?.find((s) => s.id === sessionId);

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
        {nav.kind === "overview" ? (
          <Shell
            sidebar={sidebar(homePanel)}
            bar={
              <TopBar>
                <h1 className="pl-1 text-sm font-semibold">All brainstorms</h1>
              </TopBar>
            }
          >
            <section className="relative min-w-0 flex-1 overflow-hidden bg-canvas" aria-label="Brainstorms" data-canvas-region>
              <HomeOverview sessions={sessions} error={listError} onRetry={() => void refreshList()} onSession={openSession} />
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
            sidebar={sidebar}
            homePanel={nav.panel === "home" ? homePanel : null}
            onHome={() => setNav({ kind: "brainstorm", id: nav.id, panel: "home" })}
          />
        )}
      </SidebarProvider>
      {notice !== null && <Toast message={notice} />}
    </TooltipProvider>
  );
}

function Shell({ sidebar, bar, strip, children }: { sidebar: ReactNode; bar: ReactNode; strip?: ReactNode; children: ReactNode }) {
  return (
    <>
      {sidebar}
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden ring-1 ring-border/70">
        {bar}
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
  sidebar,
  homePanel,
  onHome,
}: {
  api: Api;
  sessionId: SessionId;
  title: string;
  project: string | null;
  revision: number;
  showNotice: (message: string) => void;
  sidebar: (panel: ReactNode) => ReactNode;
  /** Shown in place of the session panel while Rob looks for another brainstorm. */
  homePanel: ReactNode | null;
  onHome: () => void;
}) {
  const [view, setView] = useState<SessionView | null>(null);
  // Selection is a slot, so switching variants keeps the controls on the slot's new block.
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  const [blockErrors, setBlockErrors] = useState<ReadonlyMap<BlockId, string>>(new Map());
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: "view" });
  const [placement, setPlacement] = useState<Placement>(NO_PLACEMENT);
  const [focusedFeedback, setFocusedFeedback] = useState<FeedbackId | null>(null);
  const [pulse, setPulse] = useState<{ id: FeedbackId; seq: number } | null>(null);
  const canvasArea = useRef<HTMLElement>(null);
  const [inspectorWidth, setInspectorWidth] = usePaneWidth("inspector", INSPECTOR);

  useEffect(() => {
    void api.view(sessionId).then((next) => (next.ok ? setView(next.data) : showNotice(next.error.message)));
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
        showNotice(result.error.message);
        return null;
      }
      setView(result.data);
      return result.data;
    },
    [api, sessionId, showNotice],
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
    if (!result.ok) showNotice(result.error.message);
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
        />
      }
      strip={view !== null && <RequestDetail view={view} />}
    >
      <section ref={canvasArea} className="relative min-w-0 flex-1 overflow-hidden bg-canvas" aria-label="Canvas" data-canvas-region>
        {iteration === null ? (
          <WaitingEmpty loading={view === null} />
        ) : (
          <CanvasHost
            blocks={blocks}
            frames={frames}
            props={frameProps}
            selected={selectedBlock?.id ?? null}
            mode={interaction.kind === "picking" ? "pin" : "view"}
            pins={pins}
            focused={focusedFeedback}
            pulse={pulse}
            onSelect={onSelectBlock}
            onBlockError={onBlockError}
            onPicked={onPicked}
            onPinClicked={onPinClicked}
            onPlacement={setPlacement}
          />
        )}
        {interaction.kind === "picking" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center" data-pick-hint>
            <div data-open="" className={cn(overlaySurface(), "pointer-events-auto flex items-center gap-2 py-1 pr-1 pl-3 text-sm")}>
              Click an element to pin a comment
              <Kbd>Esc</Kbd>
              <Button variant="ghost" size="xs" onClick={() => setInteraction({ kind: "view" })}>
                Cancel
              </Button>
            </div>
          </div>
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
      </section>
      {view === null ? (
        <InspectorSkeleton width={inspectorWidth} />
      ) : (
        <Inspector
          width={inspectorWidth}
          limits={INSPECTOR}
          onWidth={setInspectorWidth}
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
            picking={interaction.kind === "picking"}
            focused={focusedFeedback}
            onPickToggle={() => setInteraction((i) => (i.kind === "picking" ? { kind: "view" } : { kind: "picking" }))}
            onOpen={openFeedback}
            send={send}
          />
        </Inspector>
      )}
    </Shell>
  );
}

function WaitingEmpty({ loading }: { loading: boolean }) {
  return (
    <Empty className="size-full rounded-none bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Loader2 aria-hidden className="animate-spin" />
        </EmptyMedia>
        <EmptyTitle>{loading ? "Opening the brainstorm" : "Waiting for the agent's first commit"}</EmptyTitle>
        {!loading && <EmptyDescription>Blocks appear here as soon as it lands.</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}
