import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  blockIdOf,
  framesOf,
  type AppearanceValue,
  type BlockId,
  type BlockView,
  type CanvasPin,
  type ExportResult,
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
import { takeoverPhrase } from "../core/machines";
import type { Api } from "./api";
import { CanvasHost, type Placement } from "./CanvasHost";
import { ExportButton } from "./Export";
import { FeedbackPanel, PinComposer, pinPlace } from "./Feedback";
import { Inspector } from "./Inspector";
import { PendingOverrides } from "./overrides";
import { CopyPhrase, RegenerateMenu, RequestStatus } from "./Regenerate";
import { Sidebar } from "./Sidebar";

const NOTICE_MS = 6000;

/** What a click in the canvas does: select, pick an element to pin, or nothing while a comment is being written. */
type CanvasInteraction =
  | { readonly kind: "view" }
  | { readonly kind: "picking" }
  | { readonly kind: "composing"; readonly pin: Pin; readonly at: { readonly x: number; readonly y: number } };

const NO_PLACEMENT: Placement = { placed: new Set(), detached: new Set() };

export function App({ api }: { api: Api }) {
  const [sessions, setSessions] = useState<readonly SessionListing[]>([]);
  const [sessionId, setSessionId] = useState<SessionId | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  // Selection is a slot, so switching variants keeps the controls on the slot's new block.
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  const [blockErrors, setBlockErrors] = useState<ReadonlyMap<BlockId, string>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: "view" });
  const [placement, setPlacement] = useState<Placement>(NO_PLACEMENT);
  const [focusedFeedback, setFocusedFeedback] = useState<FeedbackId | null>(null);
  const [pulse, setPulse] = useState<{ id: FeedbackId; seq: number } | null>(null);
  const canvasArea = useRef<HTMLElement>(null);

  const current = useRef<SessionId | null>(null);
  current.current = sessionId;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((n) => (n === message ? null : n)), NOTICE_MS);
  }, []);

  const send = useCallback(
    async (action: RobAction): Promise<SessionView | null> => {
      const id = current.current;
      if (id === null) return null;
      const result = await api.act(id, action);
      if (!result.ok) {
        showNotice(result.error.message);
        return null;
      }
      if (current.current === id) setView(result.data);
      return result.data;
    },
    [api, showNotice],
  );
  const pending = useMemo(() => new PendingOverrides(send), [send]);
  const pendingVersion = useSyncExternalStore(pending.subscribe, pending.version);
  useEffect(() => {
    if (view !== null) pending.settle(view);
  }, [pending, view]);

  const refresh = useCallback(async () => {
    const list = await api.sessions();
    if (!list.ok) return showNotice(list.error.message);
    setSessions(list.data);
    const id = current.current ?? list.data.at(-1)?.id ?? null;
    if (id === null) return;
    if (current.current === null) setSessionId(id);
    const next = await api.view(id);
    if (!next.ok) return showNotice(next.error.message);
    if ((current.current ?? id) === id) setView(next.data);
  }, [api, showNotice]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh();
    void api.events(
      (id) => {
        if (id === current.current || current.current === null) void refresh();
        else void api.sessions().then((list) => list.ok && setSessions(list.data));
      },
      () => void refresh(),
      controller.signal,
    );
    return () => controller.abort();
  }, [api, refresh]);

  const openSession = (id: SessionId) => {
    if (id === sessionId) return;
    pending.clear();
    setView(null);
    setSelectedSlot(null);
    setBlockErrors(new Map());
    setInteraction({ kind: "view" });
    setPlacement(NO_PLACEMENT);
    setFocusedFeedback(null);
    setSessionId(id);
    current.current = id;
    void refresh();
  };

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

  return (
    <div className="grid h-full grid-cols-[248px_minmax(0,1fr)_296px] grid-rows-[44px_minmax(0,1fr)]">
      <TopBar
        view={view}
        notice={notice}
        selected={selectedBlock?.id ?? null}
        send={send}
        exportHtml={async () => {
          const result = sessionId === null ? null : await api.exportHtml(sessionId);
          if (result?.ok === false) showNotice(result.error.message);
          return result?.ok ? result.data : null;
        }}
      />
      <Sidebar
        sessions={sessions}
        current={sessionId}
        onSession={openSession}
        slots={slots}
        blocks={blocks}
        selectedSlot={slot?.id ?? null}
        onSlot={setSelectedSlot}
        onVariant={onVariant}
      />
      <main ref={canvasArea} className="relative min-h-0 min-w-0" aria-label="Canvas">
        {iteration === null ? (
          <EmptyCanvas view={view} hasSessions={sessions.length > 0} />
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
            <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-foreground py-1.5 pr-1.5 pl-3.5 text-[12px] text-background shadow-lg">
              Click an element to pin a comment
              <button type="button" onClick={() => setInteraction({ kind: "view" })} className="h-6 rounded-full bg-background/15 px-2.5 font-medium hover:bg-background/25">
                Cancel
              </button>
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
      </main>
      {view === null ? (
        <aside className="border-l border-border bg-background" />
      ) : (
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
    </div>
  );
}

function TopBar({
  view,
  notice,
  selected,
  send,
  exportHtml,
}: {
  view: SessionView | null;
  notice: string | null;
  selected: BlockId | null;
  send: (action: RobAction) => Promise<SessionView | null>;
  exportHtml: () => Promise<ExportResult | null>;
}) {
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const lost = view?.attachment.lostAt != null;
  const threadName = view?.thread?.title ?? (view === null ? null : `thread ${view.attachment.threadId.slice(0, 8)}`);
  const regenerateBlocked = blockedReason(view);
  // A lost thread with a request in flight already says so, with the phrase, in the request status.
  const showTakeover = lost && view?.request?.phase.phase !== "thread_lost";
  return (
    <header className="col-span-3 flex min-w-0 items-center gap-3 border-b border-border bg-background px-3">
      <div className="flex w-[224px] shrink-0 items-center gap-2">
        <span aria-hidden className="grid size-5 place-items-center rounded-[5px] bg-primary text-[11px] font-bold text-primary-foreground">
          B
        </span>
        <span className="text-[13px] font-semibold">Brainstorm</span>
      </div>
      {view !== null && (
        <div className="flex min-w-0 flex-1 items-center gap-3 text-[12px]">
          <span className="shrink-0 truncate text-[13px] font-medium">{view.session.title}</span>
          {view.iteration !== null && <span className="shrink-0 tabular-nums text-muted-foreground">Iteration {view.iteration.n}</span>}
          {threadName !== null && (
            <span className="flex min-w-0 shrink items-center gap-1.5 text-muted-foreground" title={view.attachment.threadId} data-thread={lost ? "lost" : "attached"}>
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${lost ? "bg-warning" : "bg-[#2fa36b]"}`} />
              <span className="truncate">{lost ? "Unattached" : threadName}</span>
            </span>
          )}
          {showTakeover && (
            <span className="flex min-w-0 items-center gap-2" data-takeover>
              <span className="truncate text-muted-foreground" title={takeoverPhrase(view.session.title)}>
                In a T3 thread on this project, say: {takeoverPhrase(view.session.title)}
              </span>
              <CopyPhrase title={view.session.title} />
            </span>
          )}
          {view.request !== null && (
            <span className="flex min-w-0 items-center border-l border-border pl-3">
              <RequestStatus view={view} send={send} />
            </span>
          )}
        </div>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {notice !== null && (
          <span role="alert" className="max-w-[420px] truncate text-[12px] text-destructive" title={notice}>
            {notice}
          </span>
        )}
        <div className="relative">
          <button
            type="button"
            disabled={regenerateBlocked !== null}
            title={regenerateBlocked ?? "Send a request to the T3 thread"}
            aria-expanded={menu}
            data-regenerate-toggle
            onClick={() => setMenu((m) => !m)}
            className="h-7 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-45"
          >
            Regenerate
          </button>
          {menu && view !== null && regenerateBlocked === null && <RegenerateMenu view={view} selected={selected} onClose={closeMenu} send={send} />}
        </div>
        <ExportButton disabled={view?.iteration == null} exportHtml={exportHtml} />
      </div>
    </header>
  );
}

function blockedReason(view: SessionView | null): string | null {
  const gate = view?.regenerate ?? { ok: false, reason: "no_iteration" };
  if (gate.ok) return null;
  switch (gate.reason) {
    case "no_iteration":
      return "Regenerate needs a first iteration";
    case "request_open":
      return `Request ${view?.request?.request.n} is still open. Withdraw it to send another.`;
    case "thread_lost":
      return "This session's thread is gone. Take it over from a T3 thread first.";
  }
}

function EmptyCanvas({ view, hasSessions }: { view: SessionView | null; hasSessions: boolean }) {
  const text =
    view !== null
      ? "Waiting for the agent's first commit. Blocks appear here as soon as it lands."
      : hasSessions
        ? "Loading the session."
        : "No sessions yet. In a T3 thread on your project, run /ux-brainstorm.";
  return <div className="grid size-full place-items-center px-8 text-center text-[13px] text-muted-foreground">{text}</div>;
}
