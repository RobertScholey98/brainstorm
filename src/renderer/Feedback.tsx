import { MessageSquarePlus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { BlockId, BlockView, Feedback, FeedbackId, FeedbackStatus, Pin, RobAction } from "../core/types";
import type { Placement } from "./CanvasHost";

/** Where a pin is on the canvas. Only the frame can tell placed from detached; the rest the view knows. */
export type PinPlace = "placed" | "detached" | "hidden" | "removed";

export function pinPlace(f: Feedback, blocks: readonly BlockView[], active: ReadonlySet<BlockId>, placement: Placement): PinPlace {
  if (!blocks.some((b) => b.id === f.pin.blockId)) return "removed";
  if (!active.has(f.pin.blockId)) return "hidden";
  return placement.detached.has(f.id) ? "detached" : "placed";
}

const GROUPS: readonly { state: FeedbackStatus["state"]; title: string }[] = [
  { state: "open", title: "Open" },
  { state: "addressed", title: "Addressed" },
  { state: "confirmed", title: "Confirmed" },
];

const STATUS_DOT: Record<FeedbackStatus["state"], string> = {
  open: "bg-primary",
  addressed: "bg-addressed",
  confirmed: "bg-confirmed",
};

function statusLine(status: FeedbackStatus): string | null {
  switch (status.state) {
    case "open":
      return status.previouslyAddressedIn === null ? null : `Previously addressed in ${status.previouslyAddressedIn}`;
    case "addressed":
      return `Addressed in ${status.in}`;
    case "confirmed":
      return `Confirmed · addressed in ${status.addressedIn}`;
  }
}

const PLACE_NOTE: Record<Exclude<PinPlace, "placed">, string> = {
  detached: "Detached: its element is gone",
  hidden: "On a variant that isn't showing",
  removed: "Its block was removed",
};

export function FeedbackPanel({
  feedback,
  blocks,
  place,
  picking,
  focused,
  onPickToggle,
  onOpen,
  send,
}: {
  feedback: readonly Feedback[];
  blocks: readonly BlockView[];
  place: (f: Feedback) => PinPlace;
  picking: boolean;
  focused: FeedbackId | null;
  onPickToggle: () => void;
  onOpen: (f: Feedback) => void;
  send: (action: RobAction) => Promise<unknown>;
}) {
  return (
    <section className="border-t border-border" aria-label="Feedback" data-feedback-panel>
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="text-[12px] font-semibold">Feedback</h2>
        <span className="text-[12px] tabular-nums text-muted-foreground">{feedback.length > 0 ? feedback.length : ""}</span>
        <button
          type="button"
          aria-pressed={picking}
          data-pick-toggle
          onClick={onPickToggle}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-foreground hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
          {picking ? "Picking…" : "Pin comment"}
        </button>
      </header>
      {feedback.length === 0 ? (
        <p className="px-4 pb-4 text-[12px] leading-relaxed text-muted-foreground">
          Pin a comment to an element in the canvas. The agent sees it with your next Regenerate.
        </p>
      ) : (
        GROUPS.map(({ state, title }) => {
          const items = feedback.filter((f) => f.status.state === state);
          if (items.length === 0) return null;
          return (
            <div key={state} className="pb-2" data-group={state}>
              <h3 className="px-4 pt-1 pb-1 text-[11px] font-medium text-muted-foreground">
                {title} <span className="tabular-nums">{items.length}</span>
              </h3>
              <ul className="grid">
                {items.map((f) => (
                  <FeedbackItem
                    key={f.id}
                    feedback={f}
                    block={blocks.find((b) => b.id === f.pin.blockId) ?? null}
                    place={place(f)}
                    focused={focused === f.id}
                    onOpen={() => onOpen(f)}
                    send={send}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function FeedbackItem({
  feedback: f,
  block,
  place,
  focused,
  onOpen,
  send,
}: {
  feedback: Feedback;
  block: BlockView | null;
  place: PinPlace;
  focused: boolean;
  onOpen: () => void;
  send: (action: RobAction) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) item.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);
  const line = statusLine(f.status);
  const act = (action: RobAction) => () => void send(action);

  return (
    <li
      ref={item}
      data-feedback={f.id}
      data-status={f.status.state}
      data-place={place}
      data-focused={focused || undefined}
      className="group relative mx-2 rounded-md px-2 py-2 hover:bg-accent/60 data-[focused]:bg-accent"
    >
      <div className="flex gap-2.5">
        <span
          aria-hidden
          className={`mt-px grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-[9px_9px_9px_3px] px-1 text-[10px] font-bold tabular-nums text-white ${STATUS_DOT[f.status.state]}`}
        >
          {f.id}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <TextEditor
              initial={f.text}
              submitLabel="Save"
              onCancel={() => setEditing(false)}
              onSubmit={async (text) => {
                await send({ kind: "edit_feedback", id: f.id, text });
                setEditing(false);
              }}
            />
          ) : (
            <button type="button" onClick={onOpen} className="block w-full text-left text-[12.5px] leading-snug whitespace-pre-wrap" data-feedback-text>
              {f.text}
            </button>
          )}
          <p className="pt-1 text-[11.5px] leading-snug text-muted-foreground" data-feedback-meta>
            {block?.title ?? f.pin.blockId} · {f.pin.part ?? "whole block"}
            {line !== null && <span data-feedback-status> · {line}</span>}
          </p>
          {place !== "placed" && (
            <p className="pt-0.5 text-[11.5px] leading-snug text-warning" data-feedback-place>
              {PLACE_NOTE[place]}
            </p>
          )}
          {!editing && (
            <div className="flex gap-1 pt-1.5 empty:hidden">
              {f.status.state === "addressed" && (
                <>
                  <ItemButton primary onClick={act({ kind: "confirm_feedback", id: f.id })}>
                    Confirm
                  </ItemButton>
                  <ItemButton onClick={act({ kind: "reopen_feedback", id: f.id })}>Reopen</ItemButton>
                </>
              )}
              {f.status.state === "confirmed" && <ItemButton onClick={act({ kind: "reopen_feedback", id: f.id })}>Reopen</ItemButton>}
              {f.status.state === "open" && (
                <>
                  <ItemButton onClick={() => setEditing(true)}>Edit</ItemButton>
                  <ItemButton onClick={act({ kind: "delete_feedback", id: f.id })}>Delete</ItemButton>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function ItemButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "h-6 rounded-[5px] bg-primary px-2 text-[11.5px] font-medium text-primary-foreground hover:opacity-90"
          : "h-6 rounded-[5px] px-2 text-[11.5px] font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-background hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

/** A textarea that submits on Ctrl+Enter and cancels on Escape. */
export function TextEditor({
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    area.current?.focus();
    area.current?.setSelectionRange(text.length, text.length);
  }, []);
  const submit = async () => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
  };
  return (
    <div className="grid gap-2">
      <textarea
        ref={area}
        rows={3}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-[12.5px] leading-snug outline-none placeholder:text-muted-foreground focus:border-primary"
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Ctrl+Enter</span>
        <button type="button" onClick={onCancel} className="ml-auto h-7 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
          Cancel
        </button>
        <button
          type="button"
          disabled={text.trim() === "" || busy}
          onClick={() => void submit()}
          className="h-7 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-45"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

const COMPOSER_WIDTH = 280;
const COMPOSER_HEIGHT = 150;

/** Anchored where Rob clicked in the canvas, kept inside the canvas area. */
export function PinComposer({
  pin,
  at,
  block,
  bounds,
  onSave,
  onCancel,
}: {
  pin: Pin;
  at: { x: number; y: number };
  block: BlockView | null;
  bounds: { width: number; height: number };
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const left = Math.max(8, Math.min(at.x + 14, bounds.width - COMPOSER_WIDTH - 8));
  const top = Math.max(8, Math.min(at.y + 14, bounds.height - COMPOSER_HEIGHT - 8));
  return (
    <div
      role="dialog"
      aria-label="New comment"
      data-composer
      className="absolute z-10 grid gap-2 rounded-lg border border-border bg-background p-3 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]"
      style={{ left, top, width: COMPOSER_WIDTH }}
    >
      <span aria-hidden className="absolute size-2 rounded-full bg-primary ring-2 ring-background" style={{ left: at.x - left - 4, top: at.y - top - 4 }} />
      <p className="truncate text-[11.5px] text-muted-foreground">
        <span className="font-medium text-foreground">{pin.part ?? "Whole block"}</span> in {block?.title ?? pin.blockId}
      </p>
      <TextEditor initial="" placeholder="What should change here?" submitLabel="Pin comment" onSubmit={onSave} onCancel={onCancel} />
    </div>
  );
}
