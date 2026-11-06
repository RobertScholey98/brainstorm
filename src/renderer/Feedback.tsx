import { MessageSquarePlus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { FEEDBACK_ACTIONS } from "../core/machines";
import type { BlockId, BlockView, CanvasRect, Feedback, FeedbackAction, FeedbackId, FeedbackStatus, Pin, RobAction } from "../core/types";
import { composerPlace } from "./placement";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { overlaySurface } from "@/components/ui/overlay";
import { OverlayHeader, PopoverFooter } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Hint } from "@/components/ui/tooltip";
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

/** The item sits under a heading that names its status, so the line says only what the heading doesn't. */
function statusLine(status: FeedbackStatus): string | null {
  switch (status.state) {
    case "open":
      return status.previouslyAddressedIn === null ? null : `Previously addressed in iteration ${status.previouslyAddressedIn}`;
    case "addressed":
      return `In iteration ${status.in}`;
    case "confirmed":
      return `Addressed in iteration ${status.addressedIn}`;
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
  canPin,
  picking,
  focused,
  onHover,
  onPickToggle,
  onOpen,
  send,
}: {
  feedback: readonly Feedback[];
  blocks: readonly BlockView[];
  place: (f: Feedback) => PinPlace;
  /** False before the first iteration, when the canvas has nothing to pin to. */
  canPin: boolean;
  picking: boolean;
  focused: FeedbackId | null;
  /** The item under the pointer, so its pin can echo the hover on the canvas. */
  onHover: (id: FeedbackId | null) => void;
  onPickToggle: () => void;
  onOpen: (f: Feedback) => void;
  send: (action: RobAction) => Promise<unknown>;
}) {
  return (
    <section className="border-t" aria-label="Feedback" data-feedback-panel>
      <header className="flex items-center gap-2 pt-3 pb-2">
        <h2 className="text-base font-semibold">Feedback</h2>
        {feedback.length > 0 && <Badge>{feedback.length}</Badge>}
        {canPin ? (
          <Button variant="outline" className="ml-auto" aria-pressed={picking} data-pick-toggle onClick={onPickToggle}>
            <MessageSquarePlus data-icon="inline-start" aria-hidden />
            {picking ? "Picking…" : "Pin comment"}
          </Button>
        ) : (
          <Hint label="There is nothing on the canvas to pin to yet" side="left">
            <span tabIndex={0} className="ml-auto" data-pick-blocked>
              <Button variant="outline" disabled data-pick-toggle>
                <MessageSquarePlus data-icon="inline-start" aria-hidden />
                Pin comment
              </Button>
            </span>
          </Hint>
        )}
      </header>
      {feedback.length === 0 ? (
        <p className="pb-4 text-sm/relaxed text-fg-muted">
          {canPin
            ? "Pin a comment to an element in the canvas. The agent sees it with your next Regenerate."
            : "Once the first iteration is on the canvas, pin comments to its elements here."}
        </p>
      ) : (
        GROUPS.map(({ state, title }) => {
          const items = feedback.filter((f) => f.status.state === state);
          if (items.length === 0) return null;
          return (
            <div key={state} className="pb-2" data-group={state}>
              <h3 className="flex items-center gap-1.5 pt-1 pb-1 text-xs font-medium">
                {title}
                <Badge>{items.length}</Badge>
              </h3>
              <ul>
                {items.map((f) => (
                  <FeedbackItem
                    key={f.id}
                    feedback={f}
                    block={blocks.find((b) => b.id === f.pin.blockId) ?? null}
                    place={place(f)}
                    focused={focused === f.id}
                    onHover={onHover}
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
  onHover,
  onOpen,
  send,
}: {
  feedback: Feedback;
  block: BlockView | null;
  place: PinPlace;
  focused: boolean;
  onHover: (id: FeedbackId | null) => void;
  onOpen: () => void;
  send: (action: RobAction) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [metaCut, setMetaCut] = useState(false);
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) item.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);
  const line = statusLine(f.status);
  const where = pinWhere(f.pin, block);
  const run = (action: FeedbackAction) => {
    switch (action) {
      case "edit":
        return setEditing(true);
      case "delete":
        return setConfirming(true);
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
      onPointerEnter={() => onHover(f.id)}
      onPointerLeave={() => onHover(null)}
      className="group relative -mx-1 rounded-lg px-1 py-2 hover:bg-hover/60 data-[focused]:bg-selected"
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
          {!editing && (
            <>
              {/* Out into the canvas, off the item's status and actions, and only when the line is cut. */}
              <Hint label={where} side="left" disabled={!metaCut}>
                <p
                  className="truncate pt-1 text-xs/snug text-fg-muted"
                  onPointerEnter={(e) => setMetaCut(e.currentTarget.scrollWidth > e.currentTarget.clientWidth)}
                  data-feedback-meta
                >
                  {where}
                </p>
              </Hint>
              {line !== null && (
                <p className="text-xs/snug text-fg-muted" data-feedback-status>
                  {line}
                </p>
              )}
              {place !== "placed" && (
                <p className="pt-0.5 text-xs/snug text-warning" data-feedback-place>
                  {PLACE_NOTE[place]}
                </p>
              )}
              {confirming ? (
                <DeleteConfirm
                  onDelete={() => void send({ kind: "delete_feedback", id: f.id })}
                  onCancel={() => {
                    setConfirming(false);
                    requestAnimationFrame(() => item.current?.querySelector<HTMLElement>('[data-feedback-action="delete"]')?.focus());
                  }}
                />
              ) : (
                <div className="flex gap-1 pt-1.5 empty:hidden">
                  {FEEDBACK_ACTIONS[f.status.state].map((action) => (
                    <Button key={action} variant={action === "delete" ? "destructive" : "outline"} onClick={() => run(action)} data-feedback-action={action}>
                      {ACTION_LABEL[action]}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** Delete asks once, in place, with Cancel focused so a second Enter keeps the comment. */
function DeleteConfirm({ onDelete, onCancel }: { onDelete: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => cancel.current?.focus(), []);
  return (
    <div
      role="group"
      aria-label="Delete this comment?"
      className="flex items-center gap-1 pt-1.5"
      data-feedback-confirm
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <span className="mr-auto min-w-0 truncate text-xs text-fg" data-feedback-question>
        Delete it?
      </span>
      <Button ref={cancel} onClick={onCancel} data-feedback-cancel>
        Cancel
      </Button>
      <Button variant="destructive" onClick={onDelete} data-feedback-delete>
        Delete
      </Button>
    </div>
  );
}

/** Where a pin sits, block first, as the feedback list and the composer both name it. */
const pinWhere = (pin: Pin, block: BlockView | null | undefined) => `${block?.title ?? pin.blockId} · ${pin.part ?? "whole block"}`;

/** `overlay` puts the actions in the popover footer, for an editor that is a whole overlay rather than part of a row. */
export function TextEditor({
  initial,
  placeholder,
  submitLabel,
  overlay = false,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  submitLabel: string;
  overlay?: boolean;
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
  const actions = (
    <>
      <Kbd>Ctrl+Enter</Kbd>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="accent" disabled={text.trim() === "" || busy} onClick={() => void submit()} data-editor-submit>
        {submitLabel}
      </Button>
    </>
  );
  const field = (
    <Textarea ref={area} rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} className="resize-none" />
  );
  return overlay ? (
    <>
      {field}
      <PopoverFooter>{actions}</PopoverFooter>
    </>
  ) : (
    <div className="grid gap-2">
      {field}
      <div className="flex items-center justify-end gap-1.5">{actions}</div>
    </div>
  );
}

export function PinComposer({
  pin,
  at,
  rect,
  block,
  bounds,
  onSave,
  onCancel,
}: {
  pin: Pin;
  at: { x: number; y: number };
  rect: CanvasRect;
  block: BlockView | null;
  bounds: { width: number; height: number };
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { left, top } = composerPlace(at, rect, bounds);
  return (
    <>
      {/* The pin to be, where the saved pin will land: on the element's top right corner, not over its text. */}
      <span
        aria-hidden
        className="pointer-events-none absolute z-popover grid size-5 place-items-center rounded-full rounded-bl-sm bg-accent text-accent-fg ring-2 ring-card"
        style={{ left: rect.x + rect.width - 10, top: rect.y - 10 }}
        data-composer-pin
      >
        <Plus className="size-3" />
      </span>
      <div
        role="dialog"
        aria-labelledby="composer-title"
        data-composer
        data-open=""
        className={cn(overlaySurface(), "absolute z-popover grid w-popover-sm gap-3 p-3 text-sm")}
        style={{ left, top }}
      >
        <OverlayHeader id="composer-title" heading="New comment" description={pinWhere(pin, block)} />
        <TextEditor overlay initial="" placeholder="What should change here?" submitLabel="Pin comment" onSubmit={onSave} onCancel={onCancel} />
      </div>
    </>
  );
}
