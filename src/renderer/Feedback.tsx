import { MessageSquarePlus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { FEEDBACK_ACTIONS } from "../core/machines";
import type { BlockId, BlockView, Feedback, FeedbackAction, FeedbackId, FeedbackStatus, Pin, RobAction } from "../core/types";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { overlaySurface } from "@/components/ui/overlay";
import { Textarea } from "@/components/ui/textarea";
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

/** Pins are the accent's; status shows by form, as on the canvas: filled, outlined, then neutral. */
const PIN_FORM: Record<FeedbackStatus["state"], string> = {
  open: "bg-accent text-accent-fg",
  addressed: "bg-card text-accent inset-ring-2 inset-ring-accent",
  confirmed: "bg-muted text-fg-muted",
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

const ACTION_LABEL: Record<FeedbackAction, string> = { confirm: "Confirm", reopen: "Reopen", edit: "Edit", delete: "Delete" };

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
    <section className="border-t" aria-label="Feedback" data-feedback-panel>
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold">Feedback</h2>
        <span className="text-xs tabular-nums text-fg-muted">{feedback.length > 0 ? feedback.length : ""}</span>
        <Button variant={picking ? "default" : "outline"} className="ml-auto" aria-pressed={picking} data-pick-toggle onClick={onPickToggle}>
          <MessageSquarePlus data-icon="inline-start" aria-hidden />
          {picking ? "Picking…" : "Pin comment"}
        </Button>
      </header>
      {feedback.length === 0 ? (
        <p className="px-4 pb-4 text-sm/relaxed text-fg-muted">
          Pin a comment to an element in the canvas. The agent sees it with your next Regenerate.
        </p>
      ) : (
        GROUPS.map(({ state, title }) => {
          const items = feedback.filter((f) => f.status.state === state);
          if (items.length === 0) return null;
          return (
            <div key={state} className="pb-2" data-group={state}>
              <h3 className="px-4 pt-1 pb-1 text-xs font-medium text-fg-muted">
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
  const run = (action: FeedbackAction) => {
    switch (action) {
      case "edit":
        return setEditing(true);
      case "delete":
        return void send({ kind: "delete_feedback", id: f.id });
      case "confirm":
        return void send({ kind: "confirm_feedback", id: f.id });
      case "reopen":
        return void send({ kind: "reopen_feedback", id: f.id });
    }
  };

  return (
    <li
      ref={item}
      data-feedback={f.id}
      data-status={f.status.state}
      data-place={place}
      data-focused={focused || undefined}
      className="group relative mx-2 rounded-lg px-2 py-2 hover:bg-hover/60 data-[focused]:bg-selected"
    >
      <div className="flex gap-2">
        <span
          aria-hidden
          className={`mt-px grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full rounded-bl-sm px-1 text-2xs font-semibold tabular-nums ${PIN_FORM[f.status.state]}`}
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
            <button type="button" onClick={onOpen} className="block w-full text-left text-sm/snug whitespace-pre-wrap" data-feedback-text>
              {f.text}
            </button>
          )}
          <p className="pt-1 text-xs/snug text-fg-muted" data-feedback-meta>
            {block?.title ?? f.pin.blockId} · {f.pin.part ?? "whole block"}
            {line !== null && <span data-feedback-status> · {line}</span>}
          </p>
          {place !== "placed" && (
            <p className="pt-0.5 text-xs/snug text-warning" data-feedback-place>
              {PLACE_NOTE[place]}
            </p>
          )}
          {!editing && (
            <div className="flex gap-1 pt-1.5 empty:hidden">
              {FEEDBACK_ACTIONS[f.status.state].map((action) => (
                <Button key={action} variant={action === "confirm" ? "default" : "outline"} size="xs" onClick={() => run(action)}>
                  {ACTION_LABEL[action]}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

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
      <Textarea ref={area} rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} className="resize-none" />
      <div className="flex items-center gap-1.5">
        <Kbd>Ctrl+Enter</Kbd>
        <Button variant="ghost" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={text.trim() === "" || busy} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

const COMPOSER_WIDTH = 300;
const COMPOSER_HEIGHT = 180;

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
      data-open=""
      className={cn(overlaySurface(), "absolute z-popover grid gap-2 p-3 text-sm")}
      style={{ left, top, width: COMPOSER_WIDTH }}
    >
      <span aria-hidden className="absolute size-2 rounded-full bg-accent ring-2 ring-card" style={{ left: at.x - left - 4, top: at.y - top - 4 }} />
      <p className="truncate text-xs text-fg-muted">
        <span className="font-medium text-fg">{pin.part ?? "Whole block"}</span> in {block?.title ?? pin.blockId}
      </p>
      <TextEditor initial="" placeholder="What should change here?" submitLabel="Pin comment" onSubmit={onSave} onCancel={onCancel} />
    </div>
  );
}
