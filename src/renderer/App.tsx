import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  blockIdOf,
  type AppearanceValue,
  type BlockId,
  type BlockView,
  type CanvasFrame,
  type InapplicableOverride,
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
import { CanvasHost } from "./CanvasHost";
import { Inspector } from "./Inspector";
import { PendingOverrides } from "./overrides";
import { Sidebar } from "./Sidebar";

const NOTICE_MS = 6000;

export function App({ api }: { api: Api }) {
  const [sessions, setSessions] = useState<readonly SessionListing[]>([]);
  const [sessionId, setSessionId] = useState<SessionId | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  // Selection is a slot, so switching variants keeps the controls on the slot's new block.
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  const [blockErrors, setBlockErrors] = useState<ReadonlyMap<BlockId, string>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

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
    setSessionId(id);
    current.current = id;
    void refresh();
  };

  const iteration = view?.iteration ?? null;
  const slots = iteration?.slots ?? [];
  const blocks = iteration?.blocks ?? [];
  const slot = slots.find((s) => s.id === selectedSlot) ?? slots[0] ?? null;
  const selectedBlock = slot === null ? null : (blocks.find((b) => b.id === blockIdOf(slot.id, slot.active)) ?? null);

  const frames = useMemo<CanvasFrame[]>(
    () => slots.map((s) => ({ slot: s.id, title: s.title, frame: s.frame, blockId: blockIdOf(s.id, s.active) })),
    [slots],
  );
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

  return (
    <div className="grid h-full grid-cols-[248px_minmax(0,1fr)_296px] grid-rows-[44px_minmax(0,1fr)]">
      <TopBar view={view} notice={notice} />
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
      <main className="relative min-h-0 min-w-0" aria-label="Canvas">
        {iteration === null ? (
          <EmptyCanvas view={view} hasSessions={sessions.length > 0} />
        ) : (
          <CanvasHost
            blocks={blocks}
            frames={frames}
            props={frameProps}
            selected={selectedBlock?.id ?? null}
            onSelect={onSelectBlock}
            onBlockError={onBlockError}
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
        />
      )}
    </div>
  );
}

function TopBar({ view, notice }: { view: SessionView | null; notice: string | null }) {
  const lost = view?.attachment.lostAt != null;
  const threadName = view?.thread?.title ?? (view === null ? null : `thread ${view.attachment.threadId.slice(0, 8)}`);
  return (
    <header className="col-span-3 flex min-w-0 items-center gap-3 border-b border-border bg-background px-3">
      <div className="flex w-[224px] shrink-0 items-center gap-2">
        <span aria-hidden className="grid size-5 place-items-center rounded-[5px] bg-primary text-[11px] font-bold text-primary-foreground">
          B
        </span>
        <span className="text-[13px] font-semibold">Brainstorm</span>
      </div>
      {view !== null && (
        <div className="flex min-w-0 items-center gap-3 text-[12px]">
          <span className="truncate text-[13px] font-medium">{view.session.title}</span>
          {view.iteration !== null && <span className="shrink-0 tabular-nums text-muted-foreground">Iteration {view.iteration.n}</span>}
          {threadName !== null && (
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground" title={view.attachment.threadId}>
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${lost ? "bg-warning" : "bg-[#2fa36b]"}`} />
              <span className="truncate">{lost ? `Lost ${threadName}` : threadName}</span>
            </span>
          )}
          {view.request !== null && <span className="truncate text-muted-foreground">{view.request.message}</span>}
        </div>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {notice !== null && (
          <span role="alert" className="max-w-[420px] truncate text-[12px] text-destructive" title={notice}>
            {notice}
          </span>
        )}
        <button
          type="button"
          disabled
          title="Regenerate arrives with the feedback build"
          className="h-7 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-45"
        >
          Regenerate
        </button>
        <button
          type="button"
          disabled
          title="Export arrives in a later build"
          className="h-7 rounded-md border border-border px-3 text-[12px] font-medium disabled:opacity-45"
        >
          Export
        </button>
      </div>
    </header>
  );
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
