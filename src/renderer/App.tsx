import { Lightbulb, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  blockIdOf,
  framesOf,
  type AppearanceValue,
  type BlockId,
  type BlockView,
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
import { Inspector } from "./Inspector";
import { PendingOverrides } from "./overrides";
import { AppSidebar, HomePanel, SessionPanel } from "./Sidebar";
import { SessionBar, TopBar } from "./TopBar";

const NOTICE_MS = 6000;

type CanvasInteraction =
  | { readonly kind: "view" }
  | { readonly kind: "picking" }
  | { readonly kind: "composing"; readonly pin: Pin; readonly at: { readonly x: number; readonly y: number } };

const NO_PLACEMENT: Placement = { placed: new Set(), detached: new Set() };

export function App({ api }: { api: Api }) {
  const [sessions, setSessions] = useState<readonly SessionListing[]>([]);
  const [sessionId, setSessionId] = useState<SessionId | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const current = useRef<SessionId | null>(null);
  current.current = sessionId;

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const refreshList = useCallback(async () => {
    const list = await api.sessions();
    if (list.ok) setSessions(list.data);
    else setNotice(list.error.message);
  }, [api]);

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

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden" style={{ "--sidebar-width": "18rem" } as CSSProperties}>
        {sessionId === null ? (
          <Shell
            sidebar={<HomePanel sessions={sessions} onSession={setSessionId} />}
            bar={
              <TopBar notice={notice}>
                <h1 className="pl-1 text-sm font-medium">All brainstorms</h1>
              </TopBar>
            }
          >
            <section className="relative min-w-0 flex-1 overflow-hidden bg-canvas" aria-label="Canvas" data-canvas-region>
              <HomeEmpty hasSessions={sessions.length > 0} />
            </section>
          </Shell>
        ) : (
          <SessionWorkspace
            key={sessionId}
            api={api}
            sessionId={sessionId}
            title={sessions.find((s) => s.id === sessionId)?.title ?? ""}
            revision={revision}
            notice={notice}
            showNotice={setNotice}
            onHome={() => setSessionId(null)}
          />
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}

function Shell({ sidebar, bar, children }: { sidebar: ReactNode; bar: ReactNode; children: ReactNode }) {
  return (
    <>
      <AppSidebar>{sidebar}</AppSidebar>
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden ring-1 ring-border/70">
        {bar}
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
  revision,
  notice,
  showNotice,
  onHome,
}: {
  api: Api;
  sessionId: SessionId;
  title: string;
  revision: number;
  notice: string | null;
  showNotice: (message: string) => void;
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

  useEffect(() => {
    void api.view(sessionId).then((next) => (next.ok ? setView(next.data) : showNotice(next.error.message)));
  }, [api, sessionId, revision, showNotice]);

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
    (pin: Pin, at: { x: number; y: number }) => {
      onSelectBlock(pin.blockId);
      setInteraction({ kind: "composing", pin, at });
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
      sidebar={
        <SessionPanel
          title={view?.session.title ?? title}
          view={view}
          slots={slots}
          blocks={blocks}
          onHome={onHome}
          selectedSlot={slot?.id ?? null}
          onSlot={setSelectedSlot}
          onVariant={onVariant}
        />
      }
      bar={<SessionBar view={view} notice={notice} selected={selectedBlock?.id ?? null} send={send} exportHtml={exportHtml} />}
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
            pulse={pulse}
            onSelect={onSelectBlock}
            onBlockError={onBlockError}
            onPicked={onPicked}
            onPinClicked={onPinClicked}
            onPlacement={setPlacement}
          />
        )}
        {interaction.kind === "picking" && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center" data-pick-hint>
            <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-primary py-1.5 pr-1.5 pl-3.5 text-xs text-primary-foreground shadow-lg">
              Click an element to pin a comment
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setInteraction({ kind: "view" })}
                className="rounded-full bg-primary-foreground/15 px-2.5 text-primary-foreground hover:bg-primary-foreground/25 hover:text-primary-foreground dark:hover:bg-primary-foreground/25"
              >
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
            block={blocks.find((b) => b.id === interaction.pin.blockId) ?? null}
            bounds={{ width: canvasArea.current?.clientWidth ?? 0, height: canvasArea.current?.clientHeight ?? 0 }}
            onSave={(text) => saveComment(interaction.pin, text)}
            onCancel={() => setInteraction({ kind: "view" })}
          />
        )}
      </section>
      {view !== null && (
        <Inspector
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

function HomeEmpty({ hasSessions }: { hasSessions: boolean }) {
  return (
    <Empty className="size-full rounded-none bg-background" data-home-empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lightbulb aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{hasSessions ? "Pick a brainstorm" : "No brainstorms yet"}</EmptyTitle>
        <EmptyDescription>
          {hasSessions ? "Open one from the sidebar. To start a new one, run " : "To start one, run "}
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">/ux-brainstorm</code> in a T3 thread on your
          project. It appears in the sidebar as soon as the agent creates it.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function WaitingEmpty({ loading }: { loading: boolean }) {
  return (
    <Empty className="size-full rounded-none bg-background">
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
